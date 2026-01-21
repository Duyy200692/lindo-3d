import React, { Component, useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';

interface Toy3DProps {
  item: DiscoveryItem;
  screenshotRef?: React.MutableRefObject<() => string | null>; // Prop mới để nhận hàm chụp ảnh
}

// Component phụ để truy cập vào gl context và thực hiện chụp ảnh
const ScreenshotHandler = ({ captureRef }: { captureRef?: React.MutableRefObject<() => string | null> }) => {
    const { gl, scene, camera } = useThree();

    useEffect(() => {
        if (captureRef) {
            captureRef.current = () => {
                try {
                    // Render lại một khung hình để đảm bảo buffer có dữ liệu
                    gl.render(scene, camera);
                    // Lấy dữ liệu ảnh dưới dạng base64 (JPEG, chất lượng 0.5 để nhẹ)
                    return gl.domElement.toDataURL('image/jpeg', 0.5);
                } catch (e) {
                    console.error("Lỗi chụp màn hình:", e);
                    return null;
                }
            };
        }
    }, [gl, scene, camera, captureRef]);

    return null;
};

const Model = ({ url, textures, resources, textureFlipY = false }: { url: string, textures?: TextureMaps, resources?: {[key: string]: string}, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
  // Tải mô hình
  // QUAN TRỌNG: Tham số thứ 2 là 'true' để bật Draco Compression (rất cần thiết cho file GLB nén)
  const { scene, animations } = useGLTF(url, true, undefined, (loader: any) => {
    // Luôn set CrossOrigin để tránh lỗi CORS với hình ảnh từ Firebase/Blob
    loader.setCrossOrigin('anonymous');

    // CHỈ can thiệp vào Manager khi thực sự có resources (file bin/texture rời)
    // Nếu resources rỗng (trường hợp file .glb đơn lẻ từ Cloud), ta dùng manager mặc định để tránh lỗi
    if (resources && Object.keys(resources).length > 0) {
        loader.manager = new THREE.LoadingManager();
        loader.manager.setURLModifier((url: string) => {
            // 1. Decode URL để xử lý %20 (khoảng trắng) và các ký tự đặc biệt
            const decodedUrl = decodeURIComponent(url);
            
            // 2. Lấy tên file gốc
            const fileName = decodedUrl.replace(/^.*[\\\/]/, '').replace(/[\?#].*$/, '');
            
            // 3. Tìm trong resources
            if (resources[fileName]) {
                return resources[fileName];
            }
            
            return url;
        });
    }
  });

  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    // 1. Animation
    if (actions) {
      Object.values(actions).forEach((action: any) => {
        action?.reset().fadeIn(0.5).play();
      });
    }

    // 2. Texture mapping
    const applyTextures = async () => {
      if (!textures) return;
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous'); // Quan trọng cho texture

      const loadedMaps: { [key: string]: THREE.Texture } = {};
      const textureEntries = Object.entries(textures).filter(([_, url]) => !!url);
      
      await Promise.all(textureEntries.map(async ([key, url]) => {
        try {
          const tex = await loader.loadAsync(url!);
          tex.flipY = textureFlipY; 
          if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
          loadedMaps[key] = tex;
        } catch (err) { console.error(`Lỗi tải texture ${key}:`, err); }
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

interface ModelErrorBoundaryProps { fallback: ReactNode; children?: ReactNode; }
interface ModelErrorBoundaryState { hasError: boolean; }

class ModelErrorBoundary extends Component<ModelErrorBoundaryProps, ModelErrorBoundaryState> {
  constructor(props: ModelErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() { return { hasError: true }; }
  
  componentDidCatch(error: any, errorInfo: any) {
    console.error("Model Error Boundary caught error:", error, errorInfo);
  }

  render() { 
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children; 
  }
}

const Toy3D: React.FC<Toy3DProps> = ({ item, screenshotRef }) => {
  if (item.modelUrl) {
    return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="bg-white/80 backdrop-blur-sm p-6 rounded-3xl border-2 border-red-100 shadow-sm">
                    <span className="text-4xl block mb-2">🤕</span>
                    <span className="text-red-500 font-bold block mb-1">Ối! Lỗi tải mô hình rồi</span>
                    <span className="text-xs text-slate-400 block max-w-[200px] mx-auto">
                        Có thể do mạng yếu hoặc file bị lỗi. Bé thử chọn mô hình khác xem sao nhé!
                    </span>
                </div>
            </div>
        }>
          <Canvas 
            shadows 
            dpr={[1, 2]} 
            camera={{ fov: 45, position: [0, 1, 6] }}
            gl={{ preserveDrawingBuffer: true }} // Quan trọng: Cho phép chụp ảnh canvas
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
              {/* @ts-ignore */}
              <spotLight position={[-5, 5, 5]} intensity={1} angle={0.5} penumbra={1} />
              {/* @ts-ignore */}
              <pointLight position={[0, 1, 2]} intensity={0.5} color="#ffdcae" />
            </Suspense>
            
            <OrbitControls 
                autoRotate 
                autoRotateSpeed={1} 
                makeDefault 
                enableZoom={true} 
                enablePan={true} 
                screenSpacePanning={true}
                minDistance={2} 
                maxDistance={20}
                target={[0, 0, 0]}
            />
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