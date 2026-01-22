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
                return new Promise((resolve) => {
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
                            (error) => { resolve(null); },
                            { binary: true, onlyVisible: true, maxTextureSize: 2048 }
                        );
                    } catch (e) { resolve(null); }
                });
            };
        }
    }, [captureRef, exportRef, gl, scene, camera]);

    return null;
};

// Hook tải tài nguyên mạnh mẽ hơn
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

            // CƠ CHẾ MỚI: Luôn fetch blob trước để kiểm tra quyền truy cập
            try {
                // Fetch thủ công để bắt lỗi 403 (Permission) hoặc CORS
                const response = await fetch(item.modelUrl, { mode: 'cors' });
                
                if (!response.ok) {
                    if (response.status === 403) throw new Error("403: Không có quyền (Cần đăng nhập)");
                    if (response.status === 404) throw new Error("404: File không tồn tại");
                    throw new Error(`Lỗi tải: ${response.status}`);
                }

                const mainBlob = await response.blob();
                
                // Kiểm tra định dạng
                const headerBuffer = await mainBlob.slice(0, 4).arrayBuffer();
                const headerView = new DataView(headerBuffer);
                const isBinaryGLB = headerView.byteLength >= 4 && headerView.getUint32(0, true) === 0x46546C67;

                let finalModelUrl = '';

                if (isBinaryGLB) {
                    // Nếu là GLB, tạo URL trực tiếp từ Blob vừa tải
                    finalModelUrl = URL.createObjectURL(mainBlob);
                    generatedUrls.push(finalModelUrl);
                } else {
                    // Nếu là GLTF (JSON), cần xử lý như cũ
                    const text = await mainBlob.text();
                    let json;
                    try { json = JSON.parse(text); } catch (e) { 
                        finalModelUrl = URL.createObjectURL(mainBlob);
                        generatedUrls.push(finalModelUrl);
                    }

                    if (json) {
                        // ... (Logic patch resource cũ nếu cần) ...
                        // Nhưng thường với Cloud GLTF đã đóng gói, bước này ít khi chạy
                        const gltfBlob = new Blob([JSON.stringify(json)], { type: 'application/json' });
                        finalModelUrl = URL.createObjectURL(gltfBlob);
                        generatedUrls.push(finalModelUrl);
                    }
                }

                // Xử lý Textures (Áp dụng cho cả file Local và Cloud nếu có textureMaps riêng)
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
                console.error("Lỗi tải model:", err);
                if (isMounted) {
                    setState({ 
                        patchedUrl: null, 
                        patchedTextures: null, 
                        error: err.message || "Không thể tải mô hình" 
                    });
                }
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
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
             <div className="bg-red-50 border-2 border-red-100 p-4 rounded-2xl">
                 <span className="text-3xl block mb-2">🚧</span>
                 <h3 className="text-red-600 font-bold text-sm uppercase mb-1">Không tải được</h3>
                 <p className="text-red-400 text-xs">{error}</p>
                 {error.includes("403") && <p className="text-xs mt-2 text-slate-500">Hãy thử tải lại trang để đăng nhập.</p>}
                 <button onClick={() => window.location.reload()} className="mt-3 px-4 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-bold">Thử lại</button>
             </div>
        </div>
     )
  }

  return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
            <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <span className="text-4xl mb-2">😵</span>
                <span className="text-red-500 font-bold">Lỗi hiển thị 3D</span>
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