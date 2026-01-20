
export interface TextureMaps {
  map?: string; 
  normalMap?: string; 
  roughnessMap?: string; 
  metalnessMap?: string; 
  aoMap?: string; 
  emissiveMap?: string; 
}

export interface DiscoveryItem {
  id: string;
  name: string;
  icon: string; 
  imageUrl?: string; 
  modelUrl?: string; 
  textures?: TextureMaps; 
  resources?: { [filename: string]: string }; 
  textureFlipY?: boolean; 
  color: string; 
  modelType: 'cube' | 'sphere' | 'image' | 'model'; 
  baseColor: string; 
}

export interface FunFactData {
  name: string;
  description: string;
  funFact: string;
  soundText: string; 
}

export enum AppMode {
  GALLERY = 'GALLERY',
  VIEWER = 'VIEWER',
  ADMIN = 'ADMIN',
}
