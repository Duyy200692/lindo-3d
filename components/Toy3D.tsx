import React, { useRef, useState, useEffect, Suspense } from 'react';
import { DiscoveryItem } from '../types';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize, Html } from '@react-three/drei';
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
                scene.traverse((o) => {
                    if (o instanceof THREE.Mesh) o.updateMatrixWorld();
                });
                
                return new Promise((resolve, reject) => {
                    const exporter = new GLTFExporter();
                    try {
                        exporter.parse(
                            scene,
                            (result) => {
                                if (result instanceof ArrayBuffer) {
                                    resolve(new Blob([result], { type: 'model/gltf-binary' }));
                                } else {
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

const extractPathFromUrl = (url: string, fallbackId: string): string | null => {
    try {
        if (url.includes('/o/')) {
            const pathPart = url.split('/o/')[1].split('?')[0];
            return decodeURIComponent(pathPart);
        }
    } catch(e) {}
    if (fallbackId && !fallbackId.startsWith('temp')) {
        return `models/${fallbackId}/model.glb`;
    }
    return null;
}

const ManualModel = ({ item, onLoad, onError }: { item: DiscoveryItem, onLoad: (scene: THREE.Group, animations: any[]) => void, onError: (err: any) => void }) => {
    const group = useRef<THREE.Group>(null);
    const [scene, setScene] = useState<THREE.Group | null>(null);
    const [animations, setAnimations] = useState<any[]>([]);
    const { actions } = useAnimations(animations, group);

    useEffect(() => {
        if (!item.modelUrl) return;
        let isMounted = true;
        const cleanupUrls: string[] = [];

        const timeoutId = setTimeout(() => {
            if (isMounted) onError(new Error("Hết thời gian tải (Timeout). Vui lòng kiểm tra mạng."));
        }, 30000); 

        const loadModel = async () => {
            try {
                let mainUrlToLoad = item.modelUrl!;
                const resourceMap: { [key: string]: string } = { ...item.resources };
                let sdkSuccess = false;

                // --- CHIẾN THUẬT TẢI DỮ LIỆU ---
                // 1. Nếu là Firebase Storage, thử dùng SDK getBytes để có quyền truy cập sâu (quét file phụ)
                // 2. Nếu SDK fail (do rule chặn, unauthorized), fallback về dùng URL công khai (có token)
                
                if (storage && item.modelUrl?.includes('firebasestorage')) {
                    const storagePath = item.storagePath || extractPathFromUrl(item.modelUrl, item.id);
                    
                    if (storagePath) {
                        console.log("🚀 Thử tải qua SDK:", storagePath);
                        try {
                            const mainRef = ref(storage, storagePath);
                            const mainBuffer = await getBytes(mainRef);
                            sdkSuccess = true;
                            
                            const headerView = new DataView(mainBuffer.slice(0, 4));
                            const isGLB = headerView.getUint32(0, true) === 0x46546C67;

                            if (isGLB) {
                                const blob = new Blob([mainBuffer]);
                                mainUrlToLoad = URL.createObjectURL(blob);
                                cleanupUrls.push(mainUrlToLoad);
                            } else {
                                console.log("📂 File GLTF Text, bắt đầu quét tài nguyên...");
                                const textDecoder = new TextDecoder();
                                const jsonText = textDecoder.decode(mainBuffer);
                                const json = JSON.parse(jsonText);
                                
                                const mainBlob = new Blob([mainBuffer]);
                                mainUrlToLoad = URL.createObjectURL(mainBlob);
                                cleanupUrls.push(mainUrlToLoad);

                                const parentPath = storagePath.substring(0, storagePath.lastIndexOf('/'));
                                
                                // Tải buffers (.bin)
                                if (json.buffers) {
                                    for (const buffer of json.buffers) {
                                        if (buffer.uri && !buffer.uri.startsWith('data:')) {
                                            const binPath = `${parentPath}/${buffer.uri}`;
                                            try {
                                                const binBuffer = await getBytes(ref(storage, binPath));
                                                const binBlob = new Blob([binBuffer]);
                                                const binUrl = URL.createObjectURL(binBlob);
                                                resourceMap[buffer.uri] = binUrl;
                                                cleanupUrls.push(binUrl);
                                            } catch (binErr) { console.warn("⚠️ Thiếu bin:", buffer.uri); }
                                        }
                                    }
                                }
                                // Tải textures (ảnh)
                                if (json.images) {
                                    for (const image of json.images) {
                                        if (image.uri && !image.uri.startsWith('data:')) {
                                            const imgPath = `${parentPath}/${image.uri}`;
                                            try {
                                                const imgBuffer = await getBytes(ref(storage, imgPath));
                                                const type = image.uri.endsWith('.png') ? 'image/png' : 'image/jpeg';
                                                const imgBlob = new Blob([imgBuffer], { type });
                                                const imgUrl = URL.createObjectURL(imgBlob);
                                                resourceMap[image.uri] = imgUrl; 
                                                cleanupUrls.push(imgUrl);
                                            } catch (imgErr) { console.warn("⚠️ Thiếu ảnh:", image.uri); }
                                        }
                                    }
                                }
                            }
                        } catch (err: any) {
                            // --- ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT ---
                            // Nếu lỗi Unauthorized (403) hoặc bất kỳ lỗi SDK nào, ta KHÔNG throw lỗi chết app.
                            // Ta chuyển sang dùng mainUrlToLoad (chính là item.modelUrl ban đầu).
                            console.warn("⚠️ SDK thất bại (có thể do quyền truy cập). Đang chuyển sang URL công khai...", err.code);
                            // Giữ nguyên mainUrlToLoad là URL http ban đầu
                            sdkSuccess = false;
                        }
                    }
                }

                // --- SETUP THREE.JS LOADER ---
                const manager = new THREE.LoadingManager();
                
                manager.setURLModifier((url) => {
                    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
                    
                    // Nếu SDK chạy thành công và đã map resource, dùng nó
                    const filename = decodeURIComponent(url.replace(/^.*[\\\/]/, ''));
                    
                    // Logic tìm kiếm thông minh trong resourceMap
                    for (const key in resourceMap) {
                        if (url.endsWith(key) || key.endsWith(filename)) return resourceMap[key];
                    }
                    
                    // Nếu SDK thất bại, ta phải để ThreeJS tự giải quyết URL.
                    // Với file .glb load từ URL công khai, texture nhúng bên trong sẽ tự chạy.
                    // Với file .gltf load từ URL công khai, nó sẽ cố fetch file con relative theo URL đó.
                    // (Lưu ý: Với GLTF trên Firebase Storage, URL relative thường hỏng do thiếu token query param, 
                    // nhưng với GLB thì ok).
                    return url;
                });

                const loader = new GLTFLoader(manager);
                loader.setCrossOrigin('anonymous');
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath(DRACO_URL);
                loader.setDRACOLoader(dracoLoader);

                console.log("🚀 Đang nạp mô hình từ:", mainUrlToLoad.substring(0, 50) + "...");

                loader.load(
                    mainUrlToLoad,
                    (gltf) => {
                        if (!isMounted) return;
                        clearTimeout(timeoutId);
                        
                        gltf.scene.traverse((child: any) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                if (child.material) {
                                    child.material.side = THREE.DoubleSide; // Fix lỗi trong suốt
                                    child.material.needsUpdate = true;
                                }
                            }
                        });

                        setScene(gltf.scene);
                        setAnimations(gltf.animations);
                        onLoad(gltf.scene, gltf.animations);
                    },
                    undefined,
                    (err) => {
                        if (isMounted) {
                            clearTimeout(timeoutId);
                            console.error("Loader Error:", err);
                            onError(new Error("Không thể đọc file mô hình."));
                        }
                    }
                );
            } catch (err: any) {
                if (isMounted) {
                    clearTimeout(timeoutId);
                    console.error("Load Fatal:", err);
                    onError(err);
                }
            }
        };

        loadModel();

        return () => { 
            isMounted = false;
            clearTimeout(timeoutId);
            cleanupUrls.forEach(u => URL.revokeObjectURL(u));
        };
    }, [item.modelUrl, item.id]); 

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
                            child.material.side = THREE.DoubleSide; 
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
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-6 text-center bg-slate-50/90 backdrop-blur">
            <span className="text-5xl mb-4 animate-bounce">🤔</span>
            <span className="text-slate-700 font-bold text-lg">Hổng thấy mô hình đâu cả!</span>
            <p className="text-xs text-slate-500 mt-2 bg-white border border-slate-200 p-3 rounded-xl max-w-[280px] shadow-sm">
                {error.toString()}
            </p>
            <div className="flex gap-2 mt-4">
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 active:scale-95 transition-all">Tải lại trang</button>
            </div>
        </div>
      );
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
          {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
                  <div className="bg-white/90 backdrop-blur-md p-5 rounded-3xl flex flex-col items-center shadow-2xl border border-white/50 animate-pulse">
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                    <span className="text-xs text-indigo-600 font-bold mt-3 uppercase tracking-wider">Đang khảo cổ...</span>
                  </div>
              </div>
          )}
          
          <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 50, position: [0, 0, 8] }} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}>
            <color attach="background" args={['#f8fafc']} />
            <SceneHandler captureRef={screenshotRef} exportRef={exportRef} onReady={() => {}} />
            <Suspense fallback={null}>
              <Center onCentered={() => {
                   console.log("Model Loaded & Centered!");
                   setLoading(false);
              }}>
                <Resize scale={4}>
                  <ManualModel item={item} onLoad={() => {}} onError={(e) => { setLoading(false); setError(e.message); }} />
                </Resize>
              </Center>
              <ContactShadows position={[0, -2.5, 0]} opacity={0.4} scale={10} blur={2.5} far={4} color="#000000" />
              <Environment preset="city" />
              {/* @ts-ignore */}
              <ambientLight intensity={2} />
              {/* @ts-ignore */}
              <directionalLight position={[5, 10, 5]} intensity={3} castShadow shadow-bias={-0.0001} />
              {/* @ts-ignore */}
              <pointLight position={[-10, -10, -10]} intensity={1} color="#ffffff" />
            </Suspense>
            <OrbitControls autoRotate autoRotateSpeed={0.5} makeDefault enableZoom={true} enablePan={true} minDistance={2} maxDistance={50} />
          </Canvas>
      </div>
  );
};

export default Toy3D;