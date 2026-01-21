import React, { Component, useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>;
}

// Cấu hình Draco Decoder cố định từ CDN Google để đảm bảo ổn định
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
    }, [gl, scene, camera, captureRef]);
    return null;
};

const Model = ({ url, textures, resources, textureFlipY = false }: { url: string, textures?: TextureMaps, resources?: {[key: string]: string}, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
  const { scene, animations } = useGLTF(url, true, true, (loader: any) => {
    loader.setCrossOrigin('anonymous');
    
    // Cài đặt đường dẫn Draco Decoder thủ công
    if (loader.setDRACOLoader) {
        const dracoLoader = loader.dracoLoader; // Lấy instance có sẵn nếu có
        if (dracoLoader) {
            dracoLoader.setDecoderPath(DRACO_URL);
            dracoLoader.setDecoderConfig({ type: 'js' });
        }
    }

    // Logic xử lý file .gltf tách rời (Cloud hoặc Local)
    const isGltf = resources 
        ? Object.keys(resources).some(k => k.toLowerCase().endsWith('.gltf')) 
        : url.toLowerCase().includes('.gltf');

    // FIX QUAN TRỌNG: Không new THREE.LoadingManager() mà dùng lại manager của loader
    // để tránh làm hỏng các thiết lập nội bộ của useGLTF.
    if (isGltf && resources && Object.keys(resources).length > 0) {
        loader.manager.setURLModifier((requestUrl: string) => {
            // Giải mã URL và lấy tên file
            const decodedUrl = decodeURIComponent(requestUrl);
            // Regex lấy tên file cuối cùng, bỏ qua query param
            const fileName = decodedUrl.replace(/^.*[\\\/]/, '').replace(/[\?#].*$/, '');
            
            // Nếu tìm thấy file trong danh sách resources, trả về URL đầy đủ (có token)
            if (resources[fileName]) {
                return resources[fileName];
            }
            return requestUrl;
        });
    }
  });

  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    if (actions) {
      Object.values(actions).forEach((action: any) => {
        try { action?.reset().fadeIn(0.5).play(); } catch(e) {}
      });
    }

    const applyTextures = async () => {
      if (!textures) return;
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');

      const loadedMaps: { [key: string]: THREE.Texture } = {};
      const textureEntries = Object.entries(textures).filter(([_, url]) => !!url);
      
      await Promise.all(textureEntries.map(async ([key, url]) => {
        try {
          const tex = await loader.loadAsync(url!);
          tex.flipY = textureFlipY; 
          if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
          loadedMaps[key] = tex;
        } catch (err) { console.error(`Lỗi texture ${key}`, err); }
      }));

      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          
          materials.forEach((mat: any) => {
            if (mat.isMeshStandardMaterial) {
              if (loadedMaps.map) { mat.map = loadedMaps.map; mat.color.setHex(0xffffff); }
              if (loadedMaps.normalMap) { mat.normalMap = loadedMaps.normalMap; }
              if (loadedMaps.roughnessMap) { mat.roughnessMap = loadedMaps.roughnessMap; mat.roughness = 1; }
              if (loadedMaps.metalnessMap) { mat.metalnessMap = loadedMaps.metalnessMap; mat.metalness = 1; }
              if (loadedMaps.aoMap) { mat.aoMap = loadedMaps.aoMap; }
              if (loadedMaps.emissiveMap) { mat.emissiveMap = loadedMaps.emissiveMap; mat.emissive.setHex(0xffffff); }
              mat.needsUpdate = true;
            }
          });
        }
      });
    };
    applyTextures();
  }, [actions, scene, textures, textureFlipY]);
  
  return (
    // @ts-ignore
    <group ref={group} dispose={null}>
      {/* @ts-ignore */}
      <primitive object={scene} />
    </group>
  );
};

interface ModelErrorBoundaryProps { fallback: (error: any) => ReactNode; children?: ReactNode; }
interface ModelErrorBoundaryState { hasError: boolean; error: any; }

class ModelErrorBoundary extends React.Component<ModelErrorBoundaryProps, ModelErrorBoundaryState> {
  constructor(props: ModelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  
  componentDidCatch(error: any, errorInfo: any) {
    console.error("Model Error:", error);
  }

  render() { 
    if (this.state.hasError) {
      return this.props.fallback(this.state.error);
    }
    return this.props.children; 
  }
}

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef }) => {
  if (item.modelUrl) {
    return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary key={item.id} fallback={(error) => (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="bg-white/90 backdrop-blur-sm p-6 rounded-3xl border-2 border-red-100 shadow-xl max-w-xs">
                    <span className="text-4xl block mb-2">🤕</span>
                    <span className="text-red-500 font-bold block mb-1">Ối! Lỗi tải mô hình rồi</span>
                    <div className="text-[10px] text-slate-500 bg-slate-100 p-2 rounded-lg mb-2 overflow-auto max-h-20 text-left w-full break-words font-mono">
                        {error?.message || "Lỗi không xác định"}
                    </div>
                    <span className="text-xs text-slate-400 block mb-3">
                        {error?.message?.includes('403') || error?.message?.includes('Network') 
                            ? "Có thể do quyền truy cập Cloud (CORS) chưa được mở." 
                            : "File mô hình có thể bị hỏng."}
                    </span>
                    <button 
                        onClick={() => window.location.reload()}
                        className="w-full px-4 py-2 bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-indigo-600 transition-all"
                    >
                        Thử tải lại trang
                    </button>
                </div>
            </div>
        )}>
          <Canvas 
            shadows 
            dpr={[1, 1.5]} // Giảm dpr tối đa xuống 1.5 để đỡ lag trên mobile
            camera={{ fov: 45, position: [0, 1, 6] }}
            gl={{ preserveDrawingBuffer: true }} 
          >
            <ScreenshotHandler captureRef={screenshotRef} />
            <Suspense fallback={null}>
              <Center>
                <Resize scale={4}>
                  <Model 
                      url={item.modelUrl} 
                      textures={item.textures} 
                      resources={item.resources} 
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
  }

  return (
    <div className="flex flex-col items-center justify-center w-64 h-64 bg-white/40 rounded-full shadow-inner animate-float">
      <span className="text-9xl filter drop-shadow-2xl">{item.icon}</span>
    </div>
  );
};

export default Toy3D;