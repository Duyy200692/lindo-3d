import React, { useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize, Html } from '@react-three/drei';
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

// Component xử lý chụp ảnh và xuất file
const SceneHandler = ({ 
    captureRef, 
    exportRef,
    onReady 
}: { 
    captureRef?: React.MutableRefObject<() => string | null>,
    exportRef?: React.MutableRefObject<() => Promise<Blob | null>>,
    onReady: () => void
}) => {
    const { gl, scene, camera } = useThree();
    const readyTriggered = useRef(false);

    useFrame(() => {
        if (!readyTriggered.current) {
            readyTriggered.current = true;
            onReady();
        }
    });

    useEffect(() => {
        if (captureRef) {
            captureRef.current = () => {
                try {
                    gl.render(scene, camera);
                    return gl.domElement.toDataURL('image/jpeg', 0.6);
                } catch (e) { return null; }
            };
        }

        if (exportRef) {
            exportRef.current = async () => {
                gl.render(scene, camera); // Render một frame để đảm bảo texture được upload lên GPU (nếu cần)
                
                return new Promise((resolve, reject) => {
                    const exporter = new GLTFExporter();
                    try {
                        exporter.parse(
                            scene,
                            (result) => {
                                if (result instanceof ArrayBuffer) {
                                    resolve(new Blob([result], { type: 'model/gltf-binary' }));
                                } else {
                                    // Fallback: Chuyển JSON thành Blob nếu cần, nhưng ưu tiên Binary
                                    resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }));
                                }
                            },
                            (error) => reject(error),
                            { 
                                binary: true, 
                                onlyVisible: true, 
                                maxTextureSize: 2048,
                                animations: scene.animations 
                            }
                        );
                    } catch (e) { reject(e); }
                });
            };
        }
    }, [captureRef, exportRef, gl, scene, camera]);

    return null;
};

// Component Model thủ công để kiểm soát Loader tốt hơn
const ManualModel = ({ item, onLoad, onError }: { item: DiscoveryItem, onLoad: (scene: THREE.Group, animations: any[]) => void, onError: (err: any) => void }) => {
    const group = useRef<THREE.Group>(null);
    const [scene, setScene] = useState<THREE.Group | null>(null);
    const [animations, setAnimations] = useState<any[]>([]);
    
    // Animation Mixer
    const { actions } = useAnimations(animations, group);

    useEffect(() => {
        if (!item.modelUrl) return;

        let isMounted = true;
        
        // Setup Loading Manager
        const manager = new THREE.LoadingManager();
        
        // URL MODIFIER: Trái tim của việc fix lỗi loading
        manager.setURLModifier((url) => {
            // Chuẩn hóa tên file
            const filenameRaw = url.replace(/^.*[\\\/]/, '');
            const filename = decodeURIComponent(filenameRaw);
            
            // Nếu có trong danh sách resources (file .bin, texture user upload), dùng Blob URL đó
            if (item.resources && item.resources[filename]) {
                return item.resources[filename];
            }
            return url;
        });

        // Setup Loader
        const loader = new GLTFLoader(manager);
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath(DRACO_URL);
        loader.setDRACOLoader(dracoLoader);

        loader.load(
            item.modelUrl,
            (gltf) => {
                if (!isMounted) return;
                setScene(gltf.scene);
                setAnimations(gltf.animations);
                onLoad(gltf.scene, gltf.animations);
            },
            undefined,
            (err) => {
                if (isMounted) {
                    console.error("Lỗi GLTFLoader:", err);
                    onError(err);
                }
            }
        );

        return () => { isMounted = false; };
    }, [item.modelUrl, item.resources]); // Chạy lại khi URL hoặc resources thay đổi

    // Xử lý Textures & Animations khi Scene đã load
    useEffect(() => {
        if (!scene) return;

        // Play animations
        if (actions) {
             Object.values(actions).forEach((action: any) => {
                 try { action?.reset().fadeIn(0.5).play(); } catch(e) {}
             });
        }

        // Apply Custom Textures
        if (item.textures && Object.keys(item.textures).length > 0) {
            const texLoader = new THREE.TextureLoader();
            texLoader.setCrossOrigin('anonymous');
            
            const apply = async () => {
                const entries = Object.entries(item.textures!).filter(([_, v]) => !!v);
                for (const [key, val] of entries) {
                    try {
                        const tex = await texLoader.loadAsync(val!);
                        tex.flipY = !!item.textureFlipY;
                        tex.colorSpace = (key === 'map') ? THREE.SRGBColorSpace : THREE.NoColorSpace;

                        scene.traverse((child: any) => {
                            if (child.isMesh && child.material) {
                                // Clone material để tránh side-effect nếu dùng chung
                                // child.material = child.material.clone(); 
                                if (key === 'map') child.material.map = tex;
                                if (key === 'normalMap') child.material.normalMap = tex;
                                if (key === 'roughnessMap') child.material.roughnessMap = tex;
                                if (key === 'metalnessMap') child.material.metalnessMap = tex;
                                if (key === 'aoMap') child.material.aoMap = tex;
                                if (key === 'emissiveMap') child.material.emissiveMap = tex;
                                child.material.needsUpdate = true;
                            }
                        });
                    } catch (e) { console.warn("Lỗi texture:", key); }
                }
            };
            apply();
        }
    }, [scene, actions, item.textures, item.textureFlipY]);

    if (!scene) return null;

    // @ts-ignore
    return <group ref={group} dispose={null}><primitive object={scene} /></group>;
};

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef, exportRef }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state khi item thay đổi
  useEffect(() => {
      setLoading(true);
      setError(null);
  }, [item.id]);

  if (!item.modelUrl) return <div className="flex items-center justify-center w-full h-full text-6xl">{item.icon}</div>;

  if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-fadeIn">
            <span className="text-4xl mb-2">😵</span>
            <span className="text-red-500 font-bold">Không tải được mô hình</span>
            <p className="text-xs text-slate-400 mt-2 bg-slate-100 p-2 rounded max-w-[250px] break-words">{error}</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 transition">Thử lại</button>
        </div>
      );
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
          {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                    <span className="text-xs text-indigo-500 font-bold mt-2">Đang mở hộp...</span>
                  </div>
              </div>
          )}
          
          <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 45, position: [0, 1, 6] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <color attach="background" args={['#f1f5f9']} />
            <SceneHandler 
                captureRef={screenshotRef} 
                exportRef={exportRef} 
                onReady={() => console.log("Scene ready for capture")} 
            />
            
            <Suspense fallback={null}>
              <Center onCentered={() => setLoading(false)}>
                <Resize scale={4}>
                  <ManualModel 
                    item={item} 
                    onLoad={() => setLoading(false)} 
                    onError={(e) => {
                        setLoading(false);
                        setError(e.message || "Lỗi không xác định");
                    }} 
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
      </div>
  );
};

export default Toy3D;