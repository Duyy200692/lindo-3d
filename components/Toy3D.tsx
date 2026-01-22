import React, { Component, useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>;
  exportRef?: React.MutableRefObject<() => Promise<Blob | null>>;
}

const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

const SceneHandler = ({ 
    captureRef, 
    exportRef 
}: { 
    captureRef?: React.MutableRefObject<() => string | null>,
    exportRef?: React.MutableRefObject<() => Promise<Blob | null>>
}) => {
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

        if (exportRef) {
            exportRef.current = async () => {
                // Đảm bảo scene đã render ít nhất 1 frame
                gl.render(scene, camera);
                
                return new Promise((resolve, reject) => {
                    const exporter = new GLTFExporter();
                    try {
                        exporter.parse(
                            scene,
                            (result) => {
                                if (result instanceof ArrayBuffer) {
                                    const blob = new Blob([result], { type: 'model/gltf-binary' });
                                    resolve(blob);
                                } else {
                                    const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
                                    resolve(blob);
                                }
                            },
                            (error) => { 
                                console.error("Export Error:", error);
                                reject(error); 
                            },
                            { 
                                binary: true, 
                                onlyVisible: true, 
                                maxTextureSize: 2048,
                                animations: scene.animations 
                            }
                        );
                    } catch (e) { 
                        reject(e); 
                    }
                });
            };
        }
    }, [captureRef, exportRef, gl, scene, camera]);

    return null;
};

const Model = ({ item }: { item: DiscoveryItem }) => {
  const group = useRef<THREE.Group>(null);
  const { modelUrl, resources, textures, textureFlipY } = item;

  // Sử dụng useGLTF với cấu hình LoadingManager thông minh
  // Mỗi khi modelUrl thay đổi (upload mới), hook này sẽ chạy lại
  const { scene, animations } = useGLTF(modelUrl!, true, true, (loader) => {
     const dracoLoader = new DRACOLoader();
     dracoLoader.setDecoderPath(DRACO_URL);
     (loader as unknown as GLTFLoader).setDRACOLoader(dracoLoader);
     
     // === QUAN TRỌNG: URL MODIFIER ===
     // Thay vì sửa file, ta chặn các request từ loader
     // Nếu loader đòi "scene.bin", ta đưa cho nó blob url của file bin đó
     const manager = new THREE.LoadingManager();
     manager.setURLModifier((url) => {
         // Lấy tên file từ đường dẫn (VD: blob:xxx/scene.bin -> scene.bin)
         const filenameRaw = url.replace(/^.*[\\\/]/, '');
         const filename = decodeURIComponent(filenameRaw);

         if (resources && resources[filename]) {
             return resources[filename];
         }
         
         // Nếu không tìm thấy trong resources, trả về url gốc
         return url;
     });
     
     // Chặn lỗi texture 404 để không crash app
     manager.onError = (url) => console.warn('Loading warning:', url);
     
     (loader as unknown as GLTFLoader).manager = manager;
  });
  
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    if (actions) Object.values(actions).forEach((action: any) => { try { action?.reset().fadeIn(0.5).play(); } catch(e) {} });

    // Texture Override (Giữ nguyên logic cũ)
    if (textures && Object.keys(textures).length > 0) {
        const texLoader = new THREE.TextureLoader();
        texLoader.setCrossOrigin('anonymous'); 
        const applyMap = async () => {
             const entries = Object.entries(textures).filter(([_, val]) => !!val);
             for (const [key, val] of entries) {
                 try {
                     const tex = await texLoader.loadAsync(val!);
                     tex.flipY = !!textureFlipY;
                     tex.colorSpace = (key === 'map') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                     
                     scene.traverse((child: any) => {
                         if (child.isMesh && child.material) {
                             if (key === 'map') child.material.map = tex;
                             if (key === 'normalMap') child.material.normalMap = tex;
                             if (key === 'roughnessMap') child.material.roughnessMap = tex;
                             if (key === 'metalnessMap') child.material.metalnessMap = tex;
                             if (key === 'aoMap') child.material.aoMap = tex;
                             if (key === 'emissiveMap') child.material.emissiveMap = tex;
                             child.material.needsUpdate = true;
                         }
                     });
                 } catch (e) { console.warn("Texture Load Error:", key, e); }
             }
        };
        applyMap();
    }
  }, [actions, scene, textures, textureFlipY]);
  
  // @ts-ignore
  return <group ref={group} dispose={null}><primitive object={scene} /></group>;
};

interface ErrorBoundaryProps { fallback: ReactNode; children?: ReactNode; }
class ModelErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  constructor(props: ErrorBoundaryProps) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef, exportRef }) => {
  if (!item.modelUrl) return <div className="flex items-center justify-center w-full h-full text-6xl">{item.icon}</div>;

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <span className="text-4xl mb-2">😵</span>
                <span className="text-red-500 font-bold">Không đọc được file này</span>
                <p className="text-xs text-slate-400 mt-1 max-w-[200px]">Có thể file bị lỗi hoặc thiếu file .bin đi kèm.</p>
                <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold">Thử lại</button>
            </div>
        }>
          <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 45, position: [0, 1, 6] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <color attach="background" args={['#f1f5f9']} />
            <SceneHandler captureRef={screenshotRef} exportRef={exportRef} />
            <Suspense fallback={<Loader />}>
              <Center>
                <Resize scale={4}>
                  <Model item={item} />
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

const Loader = () => (
    // @ts-ignore
    <mesh visible={false} />
)

export default Toy3D;