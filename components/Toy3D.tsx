import React, { useRef, useState, useEffect, Suspense } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>;
}

// Cấu hình Draco Decoder từ CDN Google
const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

// Component xử lý chụp ảnh màn hình
const ScreenshotHandler = ({ captureRef }: { captureRef?: React.MutableRefObject<() => string | null> }) => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        if (captureRef) {
            captureRef.current = () => {
                try {
                    gl.render(scene, camera);
                    return gl.domElement.toDataURL('image/jpeg', 0.5);
                } catch (e) { return null; }
            };
        }
    }, [captureRef, gl, scene, camera]);
    return null;
};

// Component hiển thị Model
const Model = ({ url, textures, textureFlipY = false }: { url: string, textures?: TextureMaps, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
  // Tải model (lúc này URL đã được làm sạch thành blob:...)
  const { scene, animations } = useGLTF(url, true, true, (loader: any) => {
    if (loader.setDRACOLoader) {
        const draco = loader.dracoLoader || new THREE.DRACOLoader();
        draco.setDecoderPath(DRACO_URL);
        loader.setDRACOLoader(draco);
    }
  });

  const { actions } = useAnimations(animations, group);

  // Xử lý Animation và Texture
  useEffect(() => {
    // Play animations
    if (actions) {
        Object.values(actions).forEach((action: any) => {
            try { action?.reset().fadeIn(0.5).play(); } catch(e) {}
        });
    }

    // Apply textures
    if (textures) {
        const texLoader = new THREE.TextureLoader();
        const applyMap = async () => {
             const entries = Object.entries(textures).filter(([_, val]) => !!val);
             for (const [key, val] of entries) {
                 try {
                     const tex = await texLoader.loadAsync(val!);
                     tex.flipY = textureFlipY;
                     if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
                     
                     scene.traverse((child: any) => {
                         if (child.isMesh && child.material) {
                             const m = child.material;
                             if (key === 'map') m.map = tex;
                             if (key === 'normalMap') m.normalMap = tex;
                             if (key === 'roughnessMap') m.roughnessMap = tex;
                             if (key === 'metalnessMap') m.metalnessMap = tex;
                             if (key === 'aoMap') m.aoMap = tex;
                             if (key === 'emissiveMap') m.emissiveMap = tex;
                             m.needsUpdate = true;
                         }
                     });
                 } catch (e) { console.warn("Lỗi texture:", key); }
             }
        };
        applyMap();
    }
  }, [actions, scene, textures, textureFlipY]);
  
  return (
    // @ts-ignore
    <group ref={group} dispose={null}>
       {/* @ts-ignore */}
      <primitive object={scene} />
    </group>
  );
};

// Hook thông minh để xử lý URL dài thành URL ngắn (Blob)
const usePatchedModelUrl = (item: DiscoveryItem) => {
    const [patchedUrl, setPatchedUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        
        const process = async () => {
            if (!item.modelUrl) return;

            // 1. Nếu là file .glb hoặc không có resources rời -> Dùng luôn URL gốc
            if (!item.resources || Object.keys(item.resources).length === 0 || item.modelUrl.toLowerCase().includes('.glb')) {
                setPatchedUrl(item.modelUrl);
                return;
            }

            // 2. Nếu là file .gltf có resources (Cloud) -> Patch lại nội dung
            try {
                // Tải nội dung file .gltf text về
                const response = await fetch(item.modelUrl);
                const json = await response.json();

                // Thay thế đường dẫn buffers (file .bin)
                if (json.buffers) {
                    json.buffers.forEach((b: any) => {
                        const name = b.uri ? b.uri.split('/').pop().replace(/[\?#].*$/, '') : '';
                        // Tìm trong resources xem có file này không
                        const resKey = Object.keys(item.resources!).find(k => k.includes(name));
                        if (resKey && item.resources![resKey]) {
                            b.uri = item.resources![resKey]; // Thay thế bằng URL Cloud đầy đủ
                        }
                    });
                }

                // Thay thế đường dẫn images (nếu texture nhúng trong gltf)
                if (json.images) {
                    json.images.forEach((img: any) => {
                        if (img.uri && !img.uri.startsWith('data:')) {
                            const name = img.uri.split('/').pop().replace(/[\?#].*$/, '');
                            const resKey = Object.keys(item.resources!).find(k => k.includes(name));
                            if (resKey && item.resources![resKey]) {
                                img.uri = item.resources![resKey];
                            }
                        }
                    });
                }

                // Tạo file Blob mới từ JSON đã sửa
                const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
                const blobUrl = URL.createObjectURL(blob);
                
                if (isMounted) setPatchedUrl(blobUrl);

            } catch (err: any) {
                console.error("Lỗi patch GLTF:", err);
                if (isMounted) setError(err.message);
            }
        };

        process();
        return () => { isMounted = false; };
    }, [item.modelUrl, item.resources, item.id]);

    return { patchedUrl, error };
};

// Error Boundary đơn giản hóa
interface ErrorBoundaryProps {
    fallback: React.ReactNode;
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ModelErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() { return { hasError: true }; }
  
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef }) => {
  const { patchedUrl, error } = usePatchedModelUrl(item);

  if (!item.modelUrl) {
    return <div className="flex items-center justify-center w-full h-full"><span className="text-6xl">{item.icon}</span></div>;
  }

  if (error) {
     return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
             <span className="text-4xl mb-2">🤕</span>
             <p className="text-red-500 font-bold text-sm">Không tải được file</p>
             <button onClick={() => window.location.reload()} className="mt-2 text-xs bg-indigo-500 text-white px-3 py-1 rounded-lg">Tải lại</button>
        </div>
     )
  }

  if (!patchedUrl) {
      return (
          <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
          </div>
      )
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
             <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <span className="text-4xl mb-2">🤔</span>
                <p className="text-slate-500 font-bold text-sm">File mô hình bị lỗi rồi</p>
            </div>
        }>
          <Canvas 
            shadows 
            dpr={[1, 1.5]}
            camera={{ fov: 45, position: [0, 1, 6] }}
            gl={{ preserveDrawingBuffer: true }} 
          >
            <ScreenshotHandler captureRef={screenshotRef} />
            <Suspense fallback={null}>
              <Center>
                <Resize scale={4}>
                  <Model 
                      url={patchedUrl} 
                      textures={item.textures} 
                      textureFlipY={item.textureFlipY} 
                  />
                </Resize>
              </Center>
              <ContactShadows position={[0, -2.2, 0]} opacity={0.4} scale={10} blur={2.5} far={4} color="#000000" />
              <Environment preset="city" />
              {/* @ts-ignore */}
              <ambientLight intensity={1.5} />
              {/* @ts-ignore */}
              <directionalLight position={[5, 10, 5]} intensity={2} castShadow />
            </Suspense>
            <OrbitControls autoRotate autoRotateSpeed={1} makeDefault enableZoom={true} enablePan={true} minDistance={2} maxDistance={20} />
          </Canvas>
        </ModelErrorBoundary>
      </div>
  );
};

export default Toy3D;