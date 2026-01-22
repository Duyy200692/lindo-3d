import React, { useRef, useState, useEffect, Suspense } from 'react';
import { DiscoveryItem } from '../types';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { ref, getBlob } from 'firebase/storage'; // Import SDK Storage
import { storage } from '../firebaseConfig'; // Import instance storage

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>;
  exportRef?: React.MutableRefObject<() => Promise<Blob | null>>;
}

const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

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
                gl.render(scene, camera);
                return new Promise((resolve, reject) => {
                    const exporter = new GLTFExporter();
                    try {
                        exporter.parse(
                            scene,
                            (result) => {
                                if (result instanceof ArrayBuffer) {
                                    if (result.byteLength === 0) {
                                        reject(new Error("File export rỗng"));
                                        return;
                                    }
                                    resolve(new Blob([result], { type: 'model/gltf-binary' }));
                                } else {
                                    resolve(new Blob([JSON.stringify(result)], { type: 'application/json' }));
                                }
                            },
                            (error) => reject(error),
                            { 
                                binary: true, 
                                onlyVisible: true,
                                embedImages: true,
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

// Component Model thủ công với cơ chế "Fallback Kép" (Fetch -> Firebase SDK)
const ManualModel = ({ item, onLoad, onError }: { item: DiscoveryItem, onLoad: (scene: THREE.Group, animations: any[]) => void, onError: (err: any) => void }) => {
    const group = useRef<THREE.Group>(null);
    const [scene, setScene] = useState<THREE.Group | null>(null);
    const [animations, setAnimations] = useState<any[]>([]);
    const { actions } = useAnimations(animations, group);

    useEffect(() => {
        if (!item.modelUrl) return;
        let isMounted = true;
        let objectUrlToRevoke: string | null = null;

        const loadModel = async () => {
            try {
                let blob: Blob | null = null;
                const url = item.modelUrl!;

                // CHIẾN LƯỢC 1: Thử fetch bình thường (Nhanh nhất)
                try {
                    console.log("Đang thử tải bằng Fetch...");
                    const response = await fetch(url, { mode: 'cors' });
                    if (!response.ok) {
                         if (response.status === 403) throw new Error("403 Forbidden");
                         throw new Error(`HTTP Error ${response.status}`);
                    }
                    blob = await response.blob();
                } catch (fetchErr) {
                    // CHIẾN LƯỢC 2: Nếu lỗi 403 hoặc CORS, dùng Firebase SDK (Chậm hơn xíu nhưng chắc chắn được)
                    console.warn("Fetch thất bại, chuyển sang Firebase SDK...", fetchErr);
                    
                    if (storage && url.includes('firebasestorage')) {
                        try {
                            // Tạo reference từ URL đầy đủ
                            const fileRef = ref(storage, url);
                            // getBlob dùng giao thức riêng của Firebase, tự động kèm Auth Token chuẩn
                            blob = await getBlob(fileRef);
                            console.log("Đã tải thành công bằng Firebase SDK!");
                        } catch (sdkErr: any) {
                             console.error("Firebase SDK cũng bó tay:", sdkErr);
                             throw new Error(`Không thể tải file: ${sdkErr.message}`);
                        }
                    } else {
                        throw fetchErr; // Nếu không phải link firebase thì chịu thua
                    }
                }

                if (!blob) throw new Error("File tải về bị rỗng");

                // Tạo URL nội bộ từ Blob đã tải
                objectUrlToRevoke = URL.createObjectURL(blob);

                // Setup Loader để đọc URL nội bộ này
                const manager = new THREE.LoadingManager();
                manager.setURLModifier((u) => {
                    const filenameRaw = u.replace(/^.*[\\\/]/, '');
                    const filename = decodeURIComponent(filenameRaw);
                    if (item.resources && item.resources[filename]) return item.resources[filename];
                    return u;
                });

                const loader = new GLTFLoader(manager);
                loader.setCrossOrigin('anonymous');
                
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath(DRACO_URL);
                loader.setDRACOLoader(dracoLoader);

                loader.load(
                    objectUrlToRevoke,
                    (gltf) => {
                        if (!isMounted) return;
                        setScene(gltf.scene);
                        setAnimations(gltf.animations);
                        onLoad(gltf.scene, gltf.animations);
                    },
                    undefined,
                    (err) => {
                        if (isMounted) {
                            console.error("Lỗi parse GLB:", err);
                            onError(err);
                        }
                    }
                );
            } catch (err: any) {
                if (isMounted) {
                    console.error("Lỗi tải model nghiêm trọng:", err);
                    onError(err);
                }
            }
        };

        loadModel();

        return () => { 
            isMounted = false;
            if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
        };
    }, [item.modelUrl, item.resources]); 

    // Xử lý Textures (Giữ nguyên)
    useEffect(() => {
        if (!scene || !item.textures) return;
        if (actions) Object.values(actions).forEach((a:any) => a?.reset().fadeIn(0.5).play());

        const texLoader = new THREE.TextureLoader();
        texLoader.setCrossOrigin('anonymous');
        
        const applyTextures = async () => {
            for (const [key, val] of Object.entries(item.textures!)) {
                if (!val) continue;
                try {
                    const tex = await texLoader.loadAsync(val);
                    tex.flipY = !!item.textureFlipY;
                    tex.colorSpace = (key === 'map') ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                    scene.traverse((child: any) => {
                        if (child.isMesh && child.material) {
                            if (key === 'map') child.material.map = tex;
                            else if (key === 'normalMap') child.material.normalMap = tex;
                            else if (key === 'roughnessMap') child.material.roughnessMap = tex;
                            else if (key === 'metalnessMap') child.material.metalnessMap = tex;
                            else if (key === 'aoMap') child.material.aoMap = tex;
                            else if (key === 'emissiveMap') child.material.emissiveMap = tex;
                            child.material.needsUpdate = true;
                        }
                    });
                } catch(e) {}
            }
        };
        applyTextures();
    }, [scene, actions, item.textures, item.textureFlipY]);

    if (!scene) return null;
    // @ts-ignore
    return <group ref={group} dispose={null}><primitive object={scene} /></group>;
};

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef, exportRef }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setLoading(true); setError(null); }, [item.id]);

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
                    <span className="text-xs text-indigo-500 font-bold mt-2">Đang tải về máy...</span>
                  </div>
              </div>
          )}
          
          <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 45, position: [0, 1, 6] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <color attach="background" args={['#f1f5f9']} />
            <SceneHandler captureRef={screenshotRef} exportRef={exportRef} onReady={() => {}} />
            <Suspense fallback={null}>
              <Center onCentered={() => setLoading(false)}>
                <Resize scale={4}>
                  <ManualModel item={item} onLoad={() => setLoading(false)} onError={(e) => { setLoading(false); setError(e.message); }} />
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