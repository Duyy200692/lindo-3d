
import React, { Component, useRef, useState, useEffect, Suspense, ReactNode } from 'react';
import { DiscoveryItem, TextureMaps } from '../types';
import { Canvas, ThreeElements } from '@react-three/fiber';
import { useGLTF, OrbitControls, useAnimations, Environment, Center, Bounds } from '@react-three/drei';
import * as THREE from 'three';

// Extend JSX.IntrinsicElements to include Three.js elements
declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements extends ThreeElements {}
    }
  }
}

interface Toy3DProps {
  item: DiscoveryItem;
}

// -- REAL 3D MODEL COMPONENT --
const Model = ({ url, textures, resources, textureFlipY = false }: { url: string, textures?: TextureMaps, resources?: {[key: string]: string}, textureFlipY?: boolean }) => {
  const group = useRef<THREE.Group>(null);
  
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
    if (actions) {
      Object.values(actions).forEach((action: any) => {
        action?.reset().fadeIn(0.5).play();
      });
    }

    const loadTextures = async () => {
      if (!textures) return;

      const loader = new THREE.TextureLoader();
      const loadedMaps: any = {};

      try {
        const promises = Object.entries(textures).map(async ([key, texUrl]) => {
          if (texUrl) {
            const tex = await loader.loadAsync(texUrl);
            tex.flipY = textureFlipY; 
            tex.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            loadedMaps[key] = tex;
          }
        });

        await Promise.all(promises);

        scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            
            materials.forEach((mat: any) => {
              if (mat.isMeshStandardMaterial) {
                if (loadedMaps.map) {
                    mat.map = loadedMaps.map;
                    mat.color.setHex(0xffffff);
                }
                if (loadedMaps.normalMap) mat.normalMap = loadedMaps.normalMap;
                if (loadedMaps.roughnessMap) {
                    mat.roughnessMap = loadedMaps.roughnessMap;
                    mat.roughness = 1.0;
                }
                if (loadedMaps.metalnessMap) {
                    mat.metalnessMap = loadedMaps.metalnessMap;
                    mat.metalness = 1.0;
                }
                if (loadedMaps.aoMap) mat.aoMap = loadedMaps.aoMap;
                if (loadedMaps.emissiveMap) {
                    mat.emissiveMap = loadedMaps.emissiveMap;
                    mat.emissive = new THREE.Color(0xffffff);
                    mat.emissiveIntensity = 1.0;
                }
                if (loadedMaps.normalMap) mat.normalScale.set(1, 1);
                mat.envMapIntensity = 1.5;
                mat.needsUpdate = true;
              }
            });
          }
        });
      } catch (e) {
        console.error("Error loading textures", e);
      }
    };

    loadTextures();

  }, [actions, scene, textures, url, textureFlipY]);
  
  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  );
};

// -- FAKE 3D (IMAGE LAYERS) COMPONENT --
const ImageModel = ({ item, size = 280 }: { item: DiscoveryItem, size?: number }) => {
  const [rotation, setRotation] = useState({ x: -5, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastMousePosition = useRef({ x: 0, y: 0 });

  const handleStart = (clientX: number, clientY: number) => {
    setIsDragging(true);
    lastMousePosition.current = { x: clientX, y: clientY };
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const deltaX = clientX - lastMousePosition.current.x;
    const deltaY = clientY - lastMousePosition.current.y;
    setRotation((prev) => ({
      x: Math.max(-60, Math.min(60, prev.x - deltaY * 0.5)),
      y: prev.y + deltaX * 0.5,
    }));
    lastMousePosition.current = { x: clientX, y: clientY };
  };

  const handleEnd = () => setIsDragging(false);

  useEffect(() => {
    let animationFrame: number;
    const animate = () => {
      if (!isDragging) {
        setRotation(prev => ({ ...prev, y: prev.y + 0.3 }));
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationFrame);
  }, [isDragging]);

  const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX, e.clientY);
  const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX, e.clientY);
  const onMouseUp = handleEnd;
  const onMouseLeave = handleEnd;
  const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY);
  const onTouchEnd = handleEnd;

  if (item.imageUrl) {
    const layers = [-4, -2, 0, 2, 4];
    return (
      <div 
        className="scene cursor-grab active:cursor-grabbing"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ width: size, height: size }}
      >
        <div 
          className="cube"
          style={{
            width: '100%',
            height: '100%',
            transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            position: 'relative',
            transformStyle: 'preserve-3d'
          }}
        >
          {layers.map((z, index) => (
            <img 
              key={index}
              src={item.imageUrl} 
              alt={item.name}
              className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none drop-shadow-xl"
              style={{
                transform: `translateZ(${z}px)`,
                opacity: index === 2 ? 1 : 0.9,
                filter: index !== 2 ? 'brightness(0.9)' : 'none'
              }}
            />
          ))}
           <img 
              src={item.imageUrl} 
              alt={item.name}
              className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
              style={{
                transform: `translateZ(-5px) rotateY(180deg)`,
                filter: 'brightness(0.8)'
              }}
            />
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex items-center justify-center w-full h-full bg-white/20 rounded-full">
      <span className="text-8xl">{item.icon}</span>
    </div>
  )
};

interface ModelErrorBoundaryProps {
  fallback: ReactNode;
  children?: ReactNode;
  key?: React.Key;
}

interface ModelErrorBoundaryState {
  hasError: boolean;
}

class ModelErrorBoundary extends Component<ModelErrorBoundaryProps, ModelErrorBoundaryState> {
  readonly props: Readonly<ModelErrorBoundaryProps>;
  public state: ModelErrorBoundaryState = { hasError: false };

  constructor(props: ModelErrorBoundaryProps) {
    super(props);
    this.props = props;
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any): ModelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("3D Model Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// -- MAIN COMPONENT SWITCHER --
const Toy3D: React.FC<Toy3DProps> = ({ item }) => {
  const textureKey = item.textures ? JSON.stringify(item.textures) : 'no-tex';
  const resourceKey = item.resources ? Object.keys(item.resources).join('-') : 'no-res';
  const flipKey = item.textureFlipY ? 'flip' : 'noflip';
  const key = item.id + (item.modelUrl || '') + textureKey + resourceKey + flipKey;

  if (item.modelUrl) {
    return (
      <div className="w-full h-[400px] cursor-move relative z-10 rounded-2xl overflow-hidden bg-gradient-to-b from-transparent to-black/5">
        <ModelErrorBoundary key={key} fallback={
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-white/30 rounded-3xl border-2 border-dashed border-slate-300">
             <span className="text-4xl mb-2">⚠️</span>
             <p className="font-bold">Không tải được mô hình 3D</p>
             <p className="text-sm">File bị lỗi hoặc không hỗ trợ.</p>
          </div>
        }>
          {/* CHỈNH SỬA: Thêm near: 0.1 và far: 1000 để camera nhìn được xa và gần hơn, không bị cắt model */}
          <Canvas shadows dpr={[1, 2]} camera={{ fov: 45, position: [0, 2, 8], near: 0.1, far: 1000 }}>
            <Suspense fallback={null}>
              {/* CHỈNH SỬA: Bỏ 'clip' để không tự động cắt các phần ngoài box, tăng margin lên 1.8 để khủng long T-Rex có nhiều không gian xoay hơn */}
              <Bounds fit observe margin={1.8} damping={6}>
                  <Center top>
                     <Model url={item.modelUrl} textures={item.textures} resources={item.resources} textureFlipY={item.textureFlipY} />
                  </Center>
              </Bounds>
              
              <Environment preset="city" blur={1} />
              
              <ambientLight intensity={0.7} />
              <directionalLight position={[10, 10, 10]} intensity={1.5} />
              <spotLight position={[-10, 10, -10]} intensity={0.5} angle={0.2} />
            </Suspense>
            
            <OrbitControls 
              autoRotate 
              autoRotateSpeed={1}
              enableZoom={true} 
              makeDefault 
              enablePan={true}
              minPolarAngle={0} 
              maxPolarAngle={Math.PI} 
            />
          </Canvas>
          
          <div className="absolute bottom-4 right-4 bg-white/50 px-2 py-1 rounded text-xs text-slate-500 pointer-events-none backdrop-blur-sm">
            Dùng 2 ngón tay để di chuyển & phóng to
          </div>
        </ModelErrorBoundary>
      </div>
    );
  }

  return <ImageModel item={item} />;
};

export default Toy3D;
