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
  
  // Tải model với đường dẫn Blob an toàn
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

    // Apply textures (xử lý texture ngoài nếu có)
    if (textures) {
        const texLoader = new THREE.TextureLoader();
        // Cho phép cross-origin
        texLoader.setCrossOrigin('anonymous');
        
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

// Hook "Vá Lỗi" Model: Tải toàn bộ file về Blob Local để tránh lỗi URL dài
const usePatchedModelUrl = (item: DiscoveryItem) => {
    const [patchedUrl, setPatchedUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        const generatedUrls: string[] = []; // Danh sách URL cần dọn dẹp

        const process = async () => {
            if (!item.modelUrl) return;

            try {
                // Bước 1: Tải file chính về Blob (Bắt buộc để tránh lỗi URL dài/lạ)
                const response = await fetch(item.modelUrl);
                if (!response.ok) throw new Error(`Không tải được file gốc (${response.status})`);
                
                const mainBlob = await response.blob();
                
                // Bước 2: Kiểm tra xem file này là GLB (Binary) hay GLTF (JSON)
                // Đọc 4 byte đầu tiên để xem magic number 'glTF'
                const headerBuffer = await mainBlob.slice(0, 4).arrayBuffer();
                const headerView = new DataView(headerBuffer);
                const isBinaryGLB = headerView.byteLength >= 4 && headerView.getUint32(0, true) === 0x46546C67; // Magic 0x46546C67 = 'glTF'

                // Nếu là GLB hoặc URL kết thúc bằng .glb, dùng luôn Blob này
                if (isBinaryGLB || item.modelUrl.toLowerCase().split('?')[0].endsWith('.glb')) {
                    const blobUrl = URL.createObjectURL(mainBlob);
                    generatedUrls.push(blobUrl);
                    if (isMounted) setPatchedUrl(blobUrl);
                    return;
                }

                // Bước 3: Nếu là GLTF (Text), cần parse và vá đường dẫn resources
                const text = await mainBlob.text();
                let json;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    // Nếu parse lỗi, có thể nó là binary nhưng check magic number thất bại
                    // Fallback: cứ thử dùng blob gốc
                    console.warn("Không parse được JSON, fallback sang Blob gốc");
                    const fallbackUrl = URL.createObjectURL(mainBlob);
                    generatedUrls.push(fallbackUrl);
                    if (isMounted) setPatchedUrl(fallbackUrl);
                    return;
                }

                // Hàm hỗ trợ: Tìm và tải file phụ
                const fetchToBlobUrl = async (originalUri: string) => {
                    // Giải mã URI (ví dụ: "scene%20(1).bin" -> "scene (1).bin")
                    const decodedUri = decodeURIComponent(originalUri);
                    const cleanName = decodedUri.split('/').pop()?.replace(/[\?#].*$/, '') || '';
                    
                    // Tìm trong resources (so sánh cả tên gốc và tên decode)
                    const resKey = Object.keys(item.resources || {}).find(k => {
                        const decodedKey = decodeURIComponent(k);
                        return decodedKey.endsWith(cleanName) || decodedKey === cleanName || k.endsWith(cleanName);
                    });
                    
                    if (resKey && item.resources![resKey]) {
                        const resResponse = await fetch(item.resources![resKey]);
                        const blob = await resResponse.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        generatedUrls.push(blobUrl);
                        return blobUrl;
                    }
                    return originalUri;
                };

                // Vá đường dẫn Buffers (.bin)
                if (json.buffers) {
                    await Promise.all(json.buffers.map(async (b: any) => {
                        if (b.uri) b.uri = await fetchToBlobUrl(b.uri);
                    }));
                }

                // Vá đường dẫn Images
                if (json.images) {
                    await Promise.all(json.images.map(async (img: any) => {
                        if (img.uri && !img.uri.startsWith('data:')) {
                            img.uri = await fetchToBlobUrl(img.uri);
                        }
                    }));
                }

                // Tạo file .gltf mới
                const gltfBlob = new Blob([JSON.stringify(json)], { type: 'application/json' });
                const gltfUrl = URL.createObjectURL(gltfBlob);
                generatedUrls.push(gltfUrl);

                if (isMounted) setPatchedUrl(gltfUrl);

            } catch (err: any) {
                console.error("Lỗi xử lý model:", err);
                if (isMounted) setError(err.message || "Lỗi không xác định");
            }
        };

        process();

        return () => {
            isMounted = false;
            generatedUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [item.modelUrl, item.resources, item.id]);

    return { patchedUrl, error };
};

// Error Boundary cho Model
interface ErrorBoundaryProps {
    fallback: React.ReactNode;
    children?: React.ReactNode;
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
  
  render() { 
    return this.state.hasError ? this.props.fallback : this.props.children; 
  }
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
             <p className="text-xs text-slate-400 mt-1 max-w-[200px] truncate">{error}</p>
             <button onClick={() => window.location.reload()} className="mt-3 text-xs bg-indigo-500 text-white px-4 py-2 rounded-xl font-bold shadow-lg hover:bg-indigo-600 transition-all">Thử tải lại</button>
        </div>
     )
  }

  if (!patchedUrl) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
              <span className="text-xs font-bold text-indigo-400 animate-pulse">Đang mở hộp quà...</span>
          </div>
      )
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
             <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <span className="text-4xl mb-2">🤔</span>
                <p className="text-slate-500 font-bold text-sm">Mô hình bị lỗi rồi</p>
                <button onClick={() => window.location.reload()} className="mt-2 text-xs text-indigo-500 underline">Tải lại trang</button>
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