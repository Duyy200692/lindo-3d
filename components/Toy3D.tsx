import React, { useRef, useState, useEffect, Suspense } from 'react';
import { DiscoveryItem } from '../types';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { ref, getBytes } from 'firebase/storage'; 
import { storage } from '../firebaseConfig'; 

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
                
                // 1. Nếu là file đang chọn từ máy (blob:...) -> Tải trực tiếp
                if (url.startsWith('blob:')) {
                    const res = await fetch(url);
                    blob = await res.blob();
                } 
                // 2. Nếu là file Cloud -> Dùng SDK GetBytes (Bỏ qua CORS, Bỏ qua 403)
                else if (storage && url.includes('firebasestorage')) {
                    console.log("🚀 Kích hoạt chế độ tải ưu tiên SDK...");
                    
                    // Thuật toán trích xuất Path chính xác từ URL
                    // URL mẫu: https://.../o/models%2Fitem-123%2Fmodel.glb?token=...
                    let targetPath = item.storagePath;

                    if (!targetPath) {
                        try {
                            const pathPart = url.split('/o/')[1]; // Lấy phần sau /o/
                            if (pathPart) {
                                const cleanPath = pathPart.split('?')[0]; // Bỏ phần ?token...
                                targetPath = decodeURIComponent(cleanPath); // Giải mã ký tự đặc biệt (%2F -> /)
                                console.log("🔍 Đã trích xuất path:", targetPath);
                            }
                        } catch (e) { console.warn("Không trích xuất được path từ URL"); }
                    }

                    if (targetPath) {
                        try {
                            const fileRef = ref(storage, targetPath);
                            // getBytes tải file vào bộ nhớ RAM, bỏ qua mọi rào cản trình duyệt
                            const buffer = await getBytes(fileRef);
                            blob = new Blob([buffer]);
                        } catch (sdkErr: any) {
                            console.error("SDK Error:", sdkErr);
                            // Nếu lỗi 'not-found', có thể do path sai, thử fallback ID
                            if (sdkErr.code === 'storage/object-not-found') {
                                try {
                                    console.warn("Thử đường dẫn dự phòng theo ID...");
                                    const backupPath = `models/${item.id}/model.glb`;
                                    const buffer = await getBytes(ref(storage, backupPath));
                                    blob = new Blob([buffer]);
                                } catch (backupErr) {
                                    throw new Error("Không tìm thấy file trên máy chủ (Lỗi 404)");
                                }
                            } else {
                                throw new Error(`Lỗi tải file bảo mật: ${sdkErr.code}`);
                            }
                        }
                    } else {
                        // Nếu không tìm được path, đành dùng fetch (hên xui)
                        const res = await fetch(url, { mode: 'cors' });
                        if (!res.ok) throw new Error("Link file bị hỏng hoặc hết hạn");
                        blob = await res.blob();
                    }
                } 
                // 3. Link ngoài
                else {
                    const res = await fetch(url, { mode: 'cors' });
                    blob = await res.blob();
                }

                if (!blob) throw new Error("Dữ liệu rỗng");

                // --- NẠP VÀO THREE.JS ---
                objectUrlToRevoke = URL.createObjectURL(blob);
                const manager = new THREE.LoadingManager();
                manager.setURLModifier((u) => {
                    const filename = decodeURIComponent(u.replace(/^.*[\\\/]/, ''));
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
                        if (isMounted) onError(err);
                    }
                );
            } catch (err: any) {
                if (isMounted) {
                    console.error("Lỗi Model:", err);
                    onError(err);
                }
            }
        };

        loadModel();

        return () => { 
            isMounted = false;
            if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
        };
    }, [item.modelUrl, item.id]); // Xóa item.storagePath khỏi deps để tránh reload thừa

    // Texture Logic (Giữ nguyên)
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
            <span className="text-5xl mb-4">🔧</span>
            <span className="text-slate-700 font-bold text-lg">Đang bảo trì mô hình này</span>
            <p className="text-xs text-slate-400 mt-2 bg-white border border-slate-200 p-3 rounded-xl max-w-[250px] shadow-sm">{error}</p>
            <div className="flex gap-2 mt-4">
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 active:scale-95 transition-all">Tải lại trang</button>
            </div>
        </div>
      );
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
          {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl flex flex-col items-center shadow-xl border border-white/50">
                    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                    <span className="text-xs text-indigo-600 font-bold mt-2">Đang tải dữ liệu...</span>
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