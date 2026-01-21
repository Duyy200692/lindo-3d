import React, { useRef, useState, useEffect, Suspense, ReactNode, Component } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, Bounds, ContactShadows, Resize } from '@react-three/drei';
import * as THREE from 'three';

interface Toy3DProps {
  item: DiscoveryItem;
}

const Model = ({ url, textures, resources, textureFlipY = false }: { url: string, textures?: TextureMaps, resources?: {[key: string]: string}, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
  // Tải mô hình
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
      const loadedMaps: { [key: string]: THREE.Texture } = {};
      const textureEntries = Object.entries(textures).filter(([_, url]) => !!url);
      
      await Promise.all(textureEntries.map(async ([key, url]) => {
        try {
          const tex = await loader.loadAsync(url!);
          tex.flipY = textureFlipY; 
          if (key === 'map') tex.colorSpace = THREE.SRGBColorSpace;
          loadedMaps[key] = tex;
        } catch (err) { console.error(err); }
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
  state: ModelErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() { return { hasError: true }; }
  
  render() { 
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children; 
  }
}

const Toy3D: React.FC<Toy3DProps> = ({ item }) => {
  if (item.modelUrl) {
    return (
      <div className="absolute inset-0 w-full h-full z-0 touch-none outline-none">
        <ModelErrorBoundary fallback={<div className="flex flex-col items-center justify-center h-full text-slate-400 font-bold bg-white/50 rounded-3xl border-2 border-dashed border-slate-200">⚠️ Lỗi nạp mô hình</div>}>
          <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, position: [0, 1, 6] }}>
            <Suspense fallback={null}>
              {/* Sử dụng Center không tham số để căn giữa tâm hình học vào (0,0,0) -> Luôn nằm giữa màn hình */}
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
              
              {/* Đặt bóng đổ thấp xuống một chút để tạo không gian (khoảng -2.2 cho scale 4) */}
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
                // screenSpacePanning=true: Kéo như kéo ảnh (lên/xuống/trái/phải) thay vì kéo theo mặt phẳng camera
                screenSpacePanning={true}
                minDistance={2} 
                maxDistance={20}
                // Target [0,0,0] để camera luôn xoay quanh tâm mô hình
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