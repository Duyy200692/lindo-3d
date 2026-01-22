import React, { Component, useRef, useState, useEffect, Suspense, ReactNode, useImperativeHandle } from 'react';
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

// Component xử lý chụp ảnh màn hình và Export GLB
const SceneHandler = ({ 
    captureRef, 
    exportRef 
}: { 
    captureRef?: React.MutableRefObject<() => string | null>,
    exportRef?: React.MutableRefObject<() => Promise<Blob | null>>
}) => {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
        // 1. Chức năng chụp ảnh thumbnail
        if (captureRef) {
            captureRef.current = () => {
                try {
                    gl.render(scene, camera);
                    return gl.domElement.toDataURL('image/jpeg', 0.5);
                } catch (e) { return null; }
            };
        }

        // 2. Chức năng Export GLB (CỐT LÕI MỚI)
        if (exportRef) {
            exportRef.current = async () => {
                return new Promise((resolve) => {
                    const exporter = new GLTFExporter();
                    // Tìm object chính trong scene (bỏ qua ánh sáng, môi trường nếu không cần thiết)
                    // Hoặc export cả scene
                    try {
                        exporter.parse(
                            scene,
                            (result) => {
                                if (result instanceof ArrayBuffer) {
                                    const blob = new Blob([result], { type: 'model/gltf-binary' });
                                    resolve(blob);
                                } else {
                                    // Trường hợp hiếm hoi trả về JSON nhưng ta ép binary: true
                                    const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
                                    resolve(blob);
                                }
                            },
                            (error) => {
                                console.error("Lỗi export:", error);
                                resolve(null);
                            },
                            { 
                                binary: true, // QUAN TRỌNG: Xuất ra .glb (1 file duy nhất)
                                onlyVisible: true,
                                maxTextureSize: 2048 // Giới hạn kích thước texture để file không quá nặng
                            }
                        );
                    } catch (e) {
                        console.error("Critical export error:", e);
                        resolve(null);
                    }
                });
            };
        }
    }, [captureRef, exportRef, gl, scene, camera]);

    return null;
};

// Hook tải tài nguyên tối giản
const usePatchedResources = (item: DiscoveryItem) => {
    const [state, setState] = useState<{
        patchedUrl: string | null;
        patchedTextures: TextureMaps | null;
        error: string | null;
    }>({ patchedUrl: null, patchedTextures: null, error: null });

    useEffect(() => {
        let isMounted = true;
        const generatedUrls: string[] = []; 

        const process = async () => {
            if (!item.modelUrl) return;

            // TRƯỜNG HỢP 1: File Cloud (http/https)
            // Đã là file đóng gói sẵn, dùng luôn
            if (!item.modelUrl.startsWith('blob:')) {
                if (isMounted) setState({ patchedUrl: item.modelUrl, patchedTextures: item.textures || null, error: null });
                return;
            }

            // TRƯỜNG HỢP 2: File Local (Preview Blob)
            // Cần patching để xem trước khi chưa upload
            try {
                let finalModelUrl = '';
                const response = await fetch(item.modelUrl);
                const mainBlob = await response.blob();
                
                const headerBuffer = await mainBlob.slice(0, 4).arrayBuffer();
                const headerView = new DataView(headerBuffer);
                const isBinaryGLB = headerView.byteLength >= 4 && headerView.getUint32(0, true) === 0x46546C67;

                if (isBinaryGLB) {
                    finalModelUrl = URL.createObjectURL(mainBlob);
                    generatedUrls.push(finalModelUrl);
                } else {
                    const text = await mainBlob.text();
                    let json;
                    try { json = JSON.parse(text); } catch (e) { 
                        finalModelUrl = URL.createObjectURL(mainBlob);
                        generatedUrls.push(finalModelUrl);
                    }

                    if (json) {
                        const fetchToBlobUrl = async (originalUri: string) => {
                            if (!item.resources) return originalUri;
                            const cleanName = decodeURIComponent(originalUri).split('/').pop()?.replace(/[\?#].*$/, '') || '';
                            const resKey = Object.keys(item.resources).find(k => {
                                const decodedKey = decodeURIComponent(k);
                                return decodedKey.endsWith(cleanName) || decodedKey === cleanName || k.endsWith(cleanName);
                            });
                            
                            if (resKey && item.resources[resKey]) {
                                try {
                                    const rRes = await fetch(item.resources[resKey]);
                                    const rBlob = await rRes.blob();
                                    const rUrl = URL.createObjectURL(rBlob);
                                    generatedUrls.push(rUrl);
                                    return rUrl;
                                } catch { return originalUri; }
                            }
                            return originalUri;
                        };

                        if (json.buffers) await Promise.all(json.buffers.map(async (b: any) => { if (b.uri) b.uri = await fetchToBlobUrl(b.uri); }));
                        if (json.images) await Promise.all(json.images.map(async (img: any) => { if (img.uri && !img.uri.startsWith('data:')) img.uri = await fetchToBlobUrl(img.uri); }));

                        const gltfBlob = new Blob([JSON.stringify(json)], { type: 'application/json' });
                        finalModelUrl = URL.createObjectURL(gltfBlob);
                        generatedUrls.push(finalModelUrl);
                    }
                }

                // Xử lý Textures Preview
                const finalTextures: TextureMaps = {};
                if (item.textures) {
                    Object.entries(item.textures).forEach(([key, url]) => {
                         // @ts-ignore
                         finalTextures[key] = url;
                    });
                }

                if (isMounted) {
                    setState({ patchedUrl: finalModelUrl, patchedTextures: finalTextures, error: null });
                }
            } catch (err: any) {
                console.warn("Lỗi preview:", err);
                if (isMounted) setState({ patchedUrl: null, patchedTextures: null, error: "Lỗi tải file" });
            }
        };

        process();
        return () => { isMounted = false; generatedUrls.forEach(u => URL.revokeObjectURL(u)); };
    }, [item.modelUrl, item.resources, item.textures]);

    return state;
};

const Model = ({ url, textures, textureFlipY = false }: { url: string, textures?: TextureMaps, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url, true, true, (loader) => {
     const dracoLoader = new DRACOLoader();
     dracoLoader.setDecoderPath(DRACO_URL);
     (loader as unknown as GLTFLoader).setDRACOLoader(dracoLoader);
  });
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    if (actions) Object.values(actions).forEach((action: any) => { try { action?.reset().fadeIn(0.5).play(); } catch(e) {} });

    if (textures && Object.keys(textures).length > 0) {
        const texLoader = new THREE.TextureLoader();
        texLoader.setCrossOrigin('anonymous'); 
        const applyMap = async () => {
             const entries = Object.entries(textures).filter(([_, val]) => !!val);
             for (const [key, val] of entries) {
                 try {
                     const tex = await texLoader.loadAsync(val!);
                     tex.flipY = textureFlipY;
                     if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
                     else tex.colorSpace = THREE.NoColorSpace;
                     
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
                 } catch (e) { }
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
  const { patchedUrl, patchedTextures, error } = usePatchedResources(item);

  if (!item.modelUrl) return <div className="flex items-center justify-center w-full h-full text-6xl">{item.icon}</div>;

  if (error || !patchedUrl) {
     return (
        <div className="flex flex-col items-center justify-center h-full gap-3">
             {error ? (
                 <div className="text-red-500 font-bold bg-white/80 p-4 rounded-xl">Không tải được mô hình</div>
             ) : (
                 <>
                    <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                    <span className="text-xs font-bold text-indigo-400">Đang tải...</span>
                 </>
             )}
        </div>
     )
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <span className="text-4xl mb-2">😵</span>
                <span className="text-red-500 font-bold">Lỗi hiển thị</span>
                <button onClick={() => window.location.reload()} className="mt-2 text-xs underline">Tải lại</button>
            </div>
        }>
          <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 45, position: [0, 1, 6] }} gl={{ preserveDrawingBuffer: true, antialias: true }}>
            <SceneHandler captureRef={screenshotRef} exportRef={exportRef} />
            <Suspense fallback={null}>
              <Center>
                <Resize scale={4}>
                  <Model url={patchedUrl} textures={patchedTextures || undefined} textureFlipY={item.textureFlipY} />
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