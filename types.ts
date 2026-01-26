export interface TextureMaps {
  map?: string; // Base Color / Albedo
  normalMap?: string; // Normal Map (Purple)
  roughnessMap?: string; // Roughness (Black/White)
  metalnessMap?: string; // Metallic (Black/White)
  aoMap?: string; // Ambient Occlusion
  emissiveMap?: string; // Emissive (Glow)
}

export interface DiscoveryItem {
  id: string;
  name: string;
  icon: string; // Emoji fallback
  thumbnail?: string; // NEW: Base64 image of the model screenshot
  imageUrl?: string; // URL for 2.5D image effect
  modelUrl?: string; // URL for real .glb 3D model
  storagePath?: string; // NEW: Internal Firebase Storage path (e.g., "models/123.glb") for CORS-proof loading
  textures?: TextureMaps; // CHANGED: Now holds an object of texture URLs
  resources?: { [filename: string]: string }; // NEW: For split .gltf files (bin, external textures)
  textureFlipY?: boolean; // NEW: Toggle to flip texture Y coordinate
  color: string; // Tailwind color class
  modelType: 'cube' | 'sphere' | 'image' | 'model'; // Added 'model' type
  baseColor: string; // Hex for the 3D model
}

export interface FunFactData {
  name: string;
  description: string;
  funFact: string;
  soundText: string; // e.g., "Gâu gâu!"
}

export enum AppMode {
  GALLERY = 'GALLERY',
  VIEWER = 'VIEWER',
}