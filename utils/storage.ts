import { DiscoveryItem, FunFactData, TextureMaps } from '../types';

const DB_NAME = 'KiddoWorldDB';
const STORE_NAME = 'savedModels';
const VERSION = 4; // Incremented version for resources support

interface SavedRecord {
  id: string;
  item: DiscoveryItem;
  factData: FunFactData;
  modelBlob: Blob;
  textureBlobs?: { [key: string]: Blob }; // Store multiple texture blobs
  resourceBlobs?: { [key: string]: Blob }; // Store .bin and other gltf resources
  createdAt: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      } else {
         // Simple migration
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlobUrl: string,
  textureMaps?: TextureMaps,
  resources?: { [key: string]: string }
): Promise<void> => {
  try {
    // 1. Convert Model Blob URL back to Blob
    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    
    // 2. Convert Texture Maps to Blobs
    let textureBlobs: { [key: string]: Blob } | undefined = undefined;
    if (textureMaps) {
      textureBlobs = {};
      for (const [key, url] of Object.entries(textureMaps)) {
        if (url) {
          const texRes = await fetch(url);
          textureBlobs[key] = await texRes.blob();
        }
      }
    }

    // 3. Convert Resources (.bin) to Blobs
    let resourceBlobs: { [key: string]: Blob } | undefined = undefined;
    if (resources) {
      resourceBlobs = {};
      for (const [key, url] of Object.entries(resources)) {
        if (url) {
           const resRes = await fetch(url);
           resourceBlobs[key] = await resRes.blob();
        }
      }
    }

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record: SavedRecord = {
      id: item.id,
      item: { ...item, modelUrl: '', textures: undefined, resources: undefined }, // Clear URLs
      factData,
      modelBlob,
      textureBlobs,
      resourceBlobs,
      createdAt: Date.now()
    };

    store.put(record);
    
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error("Save failed:", error);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const records = request.result as SavedRecord[];
      
      const results = records.map(record => {
        // Reconstruct Model URL
        const modelUrl = URL.createObjectURL(record.modelBlob);
        
        // Reconstruct Texture Map URLs
        let textures: TextureMaps | undefined = undefined;
        if (record.textureBlobs) {
          textures = {};
          for (const [key, blob] of Object.entries(record.textureBlobs)) {
            (textures as any)[key] = URL.createObjectURL(blob);
          }
        } else if ((record as any).textureBlob) {
            // Backward compatibility
            textures = { map: URL.createObjectURL((record as any).textureBlob) };
        }

        // Reconstruct Resource URLs
        let resources: { [key: string]: string } | undefined = undefined;
        if (record.resourceBlobs) {
            resources = {};
            for (const [key, blob] of Object.entries(record.resourceBlobs)) {
                resources[key] = URL.createObjectURL(blob);
            }
        }
        
        return {
          item: { ...record.item, modelUrl, textures, resources },
          factData: record.factData
        };
      });
      
      resolve(results.sort((a, b) => (b.item as any).createdAt - (a.item as any).createdAt));
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
    });
}