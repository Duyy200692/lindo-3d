import React, { Component, useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>;
}

// Cấu hình Draco Decoder
const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

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

// Hook tải và xử lý tài nguyên
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

            // --- TỐI ƯU HÓA QUAN TRỌNG ---
            // 1. Nếu là file local (blob:) -> Luôn xử lý để hiển thị ngay.
            // 2. Nếu là file Cloud (http) VÀ là file đơn (.glb) -> Dùng thẳng URL, bỏ qua fetch để tránh lỗi CORS.
            const isLocalBlob = item.modelUrl.startsWith('blob:');
            const hasComplexResources = item.resources && Object.keys(item.resources).length > 1; // >1 vì file chính cũng nằm trong resources
            
            // Nếu là file Cloud đơn giản (.glb), không cần patch
            if (!isLocalBlob && !hasComplexResources) {
                if (isMounted) {
                    setState({ 
                        patchedUrl: item.modelUrl, 
                        patchedTextures: item.textures || null, 
                        error: null 
                    });
                }
                return;
            }

            // Nếu đã vào đây thì là:
            // a) File đang xem trước (Blob)
            // b) File Cloud dạng split (.gltf + .bin) cần xử lý path
            
            // Nếu là Blob URL đơn giản thì dùng luôn
            if (isLocalBlob && !hasComplexResources) {
                 if (isMounted) setState({ patchedUrl: item.modelUrl, patchedTextures: item.textures || null, error: null });
                 return;
            }

            try {
                // --- BẮT ĐẦU QUÁ TRÌNH PATCH (Cho GLTF rời hoặc Blob phức tạp) ---
                let finalModelUrl = '';
                
                // 1. Tải file model gốc
                // Lưu ý: Không dùng mode: 'cors' ép buộc, để browser tự xử lý
                const response = await fetch(item.modelUrl);
                if (!response.ok) throw new Error(`Lỗi tải model: ${response.status}`);
                const mainBlob = await response.blob();
                
                // 2. Kiểm tra định dạng (GLB hay GLTF)
                const headerBuffer = await mainBlob.slice(0, 4).arrayBuffer();
                const headerView = new DataView(headerBuffer);
                const isBinaryGLB = headerView.byteLength >= 4 && headerView.getUint32(0, true) === 0x46546C67;

                if (isBinaryGLB) {
                    finalModelUrl = URL.createObjectURL(mainBlob);
                    generatedUrls.push(finalModelUrl);
                } else {
                    // Xử lý GLTF (JSON)
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
                            
                            // Tìm key khớp trong resources
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

                // --- XỬ LÝ TEXTURE MAPS ---
                const finalTextures: TextureMaps = {};
                if (item.textures) {
                    await Promise.all(Object.entries(item.textures).map(async ([key, url]) => {
                        if (url) {
                            try {
                                if (url.startsWith('blob:') || url.startsWith('data:')) {
                                    // @ts-ignore
                                    finalTextures[key] = url;
                                } else {
                                    const tRes = await fetch(url);
                                    const tBlob = await tRes.blob();
                                    const tUrl = URL.createObjectURL(tBlob);
                                    generatedUrls.push(tUrl);
                                    // @ts-ignore
                                    finalTextures[key] = tUrl;
                                }
                            } catch (e) {
                                // @ts-ignore
                                finalTextures[key] = url;
                            }
                        }
                    }));
                }

                if (isMounted) {
                    setState({
                        patchedUrl: finalModelUrl,
                        patchedTextures: finalTextures,
                        error: null
                    });
                }

            } catch (err: any) {
                console.warn("Patching failed, falling back to original URL:", err);
                // Fallback về URL gốc nếu xử lý thất bại
                if (isMounted) {
                    setState({
                        patchedUrl: item.modelUrl || null,
                        patchedTextures: item.textures || null,
                        error: null 
                    });
                }
            }
        };

        process();

        return () => {
            isMounted = false;
            generatedUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [item.modelUrl, item.resources, item.textures, item.id]);

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
    if (actions) {
        Object.values(actions).forEach((action: any) => {
            try { action?.reset().fadeIn(0.5).play(); } catch(e) {}
        });
    }

    if (textures && Object.keys(textures).length > 0) {
        const texLoader = new THREE.TextureLoader();
        texLoader.setCrossOrigin('anonymous'); // QUAN TRỌNG: Cho phép load ảnh từ domain khác

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
                 } catch (e) { console.warn("Lỗi texture loader:", key); }
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

interface ErrorBoundaryProps { fallback: ReactNode; children?: ReactNode; }
interface ErrorBoundaryState { hasError: boolean; }

class ModelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
  const { patchedUrl, patchedTextures, error } = usePatchedResources(item);

  if (!item.modelUrl) {
    return <div className="flex items-center justify-center w-full h-full"><span className="text-6xl">{item.icon}</span></div>;
  }

  if (error) {
     return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4">
             <div className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl border-2 border-red-100 shadow-sm animate-bounce">
                 <span className="text-4xl block mb-2">🤕</span>
                 <p className="text-red-500 font-bold text-sm">Không tải được file rồi</p>
                 <button onClick={() => window.location.reload()} className="mt-3 text-xs bg-indigo-500 text-white px-4 py-2 rounded-xl font-bold">Thử tải lại</button>
             </div>
        </div>
     )
  }

  if (!patchedUrl) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
              <span className="text-xs font-bold text-indigo-400 animate-pulse">Đang tải mô hình...</span>
          </div>
      )
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl border-2 border-red-100 shadow-sm">
                    <span className="text-4xl block mb-2">🤔</span>
                    <span className="text-red-500 font-bold block mb-1">Mô hình bị lỗi hiển thị</span>
                    <button onClick={() => window.location.reload()} className="mt-2 text-xs text-indigo-500 underline">Tải lại trang</button>
                </div>
            </div>
        }>
          <Canvas 
            shadows 
            dpr={[1, 1.5]} 
            camera={{ fov: 45, position: [0, 1, 6] }}
            gl={{ preserveDrawingBuffer: true, antialias: true }} 
          >
            <ScreenshotHandler captureRef={screenshotRef} />
            <Suspense fallback={null}>
              <Center>
                <Resize scale={4}>
                  <Model 
                      url={patchedUrl} 
                      textures={patchedTextures || undefined} 
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