import React, { useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, Bounds } from '@react-three/drei';
import * as THREE from 'three';

interface Toy3DProps {
  item: DiscoveryItem;
}

const Model = ({ url, textures, resources, textureFlipY = false }: { url: string, textures?: TextureMaps, resources?: {[key: string]: string}, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
  // Tải mô hình và quản lý tài nguyên đi kèm (.bin, .jpg...)
  const { scene, animations } = useGLTF(url, undefined, undefined, (loader: any) => {
    if (resources) {
        loader.manager = new THREE.LoadingManager();
        loader.manager.setURLModifier((url: string) => {
            const fileName = url.replace(/^.*[\\\/]/, ''); 
            if (resources[fileName]) {
                return resources[fileName];
            }
            return url;
        });
    }
  });

  const { actions } = useAnimations(animations, group);

  // Xử lý nạp Texture thủ công khi bé chọn ảnh từ giao diện
  useEffect(() => {
    // 1. Chạy hoạt hình
    if (actions) {
      Object.values(actions).forEach((action: any) => {
        action?.reset().fadeIn(0.5).play();
      });
    }

    // 2. Nạp các tấm ảnh textures bé đã chọn
    const applyTextures = async () => {
      if (!textures) return;

      const loader = new THREE.TextureLoader();
      const loadedMaps: { [key: string]: THREE.Texture } = {};

      // Tạo danh sách các texture cần nạp
      const textureEntries = Object.entries(textures).filter(([_, url]) => !!url);
      
      await Promise.all(textureEntries.map(async ([key, url]) => {
        try {
          const tex = await loader.loadAsync(url!);
          // GLTF thường yêu cầu flipY = false, nhưng đôi khi ảnh rời lại cần true
          tex.flipY = textureFlipY; 
          // Thiết lập hệ màu cho ảnh màu da
          if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
          loadedMaps[key] = tex;
        } catch (err) {
          console.error(`Lỗi nạp texture ${key}:`, err);
        }
      }));

      // Duyệt qua mô hình để "dán" ảnh lên
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          // Một số mô hình có nhiều vật liệu trên một mesh
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          
          materials.forEach((mat: any) => {
            if (mat.isMeshStandardMaterial) {
              // Dán Màu da
              if (loadedMaps.map) {
                mat.map = loadedMaps.map;
                mat.color.setHex(0xffffff); // Xóa màu gốc để hiện ảnh rõ nhất
              }
              // Dán Độ sần (Normal)
              if (loadedMaps.normalMap) {
                mat.normalMap = loadedMaps.normalMap;
                mat.normalScale.set(1, 1);
              }
              // Dán Độ bóng (Roughness)
              if (loadedMaps.roughnessMap) {
                mat.roughnessMap = loadedMaps.roughnessMap;
                mat.roughness = 1;
              }
              // Dán Kim loại (Metallic)
              if (loadedMaps.metalnessMap) {
                mat.metalnessMap = loadedMaps.metalnessMap;
                mat.metalness = 1;
              }
              // Dán Đổ bóng (AO)
              if (loadedMaps.aoMap) {
                mat.aoMap = loadedMaps.aoMap;
              }
              // Dán Phát sáng (Emissive)
              if (loadedMaps.emissiveMap) {
                mat.emissiveMap = loadedMaps.emissiveMap;
                mat.emissive.setHex(0xffffff);
              }

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

interface ModelErrorBoundaryProps {
  fallback: ReactNode;
  children?: ReactNode;
}

interface ModelErrorBoundaryState {
  hasError: boolean;
}

class ModelErrorBoundary extends React.Component<ModelErrorBoundaryProps, ModelErrorBoundaryState> {
  public state: ModelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }
  
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const Toy3D: React.FC<Toy3DProps> = ({ item }) => {
  if (item.modelUrl) {
    return (
      // CẬP NHẬT QUAN TRỌNG:
      // 1. h-[90vh]: Chiều cao cực lớn, gần như toàn màn hình để tránh bị cắt đầu/chân.
      // 2. absolute inset-x-0 top-0: Đóng đinh vị trí lên trên cùng.
      // 3. z-30: Đè lên khung thông tin.
      // 4. mask-image: Kỹ thuật gradient mask để làm mờ nhẹ phần chân tiếp giáp đáy màn hình (tuỳ chọn, nhưng giúp đẹp hơn).
      <div className="w-full h-[90vh] absolute top-0 left-0 z-30 touch-none outline-none pointer-events-auto">
        <ModelErrorBoundary fallback={<div className="flex flex-col items-center justify-center h-full text-slate-400 font-bold bg-white/50 rounded-3xl border-2 border-dashed border-slate-200 mt-20">⚠️ Lỗi nạp mô hình</div>}>
          <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, position: [0, 1, 6] }}>
            <Suspense fallback={null}>
              {/* margin={0.65} : Giảm margin để mô hình TO HƠN, chiếm nhiều không gian hơn */}
              <Bounds fit observe margin={0.65}>
                  <Center top>
                     <Model 
                        url={item.modelUrl} 
                        textures={item.textures} 
                        resources={item.resources} 
                        textureFlipY={item.textureFlipY} 
                      />
                  </Center>
              </Bounds>
              <Environment preset="city" />
              {/* @ts-ignore */}
              <ambientLight intensity={0.8} />
              {/* @ts-ignore */}
              <directionalLight position={[5, 10, 5]} intensity={1.2} castShadow />
              {/* @ts-ignore */}
              <spotLight position={[-5, 5, 5]} intensity={0.5} angle={0.3} />
            </Suspense>
            {/* enableZoom={true} là mặc định, nhưng explicit để rõ ràng */}
            <OrbitControls autoRotate autoRotateSpeed={0.5} makeDefault enableZoom={true} enablePan={true} />
          </Canvas>
          <div className="absolute top-[60vh] right-4 bg-white/30 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-slate-600 pointer-events-none border border-white/50 shadow-sm z-50">
            Dùng 2 ngón tay để xoay & phóng to
          </div>
        </ModelErrorBoundary>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-64 h-64 bg-white/40 rounded-full shadow-inner animate-float mt-20">
      <span className="text-9xl filter drop-shadow-2xl">{item.icon}</span>
    </div>
  );
};

export default Toy3D;