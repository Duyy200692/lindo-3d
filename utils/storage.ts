import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';

const COLLECTION_NAME = 'models';

// Helper to upload a single blob and get URL
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Firebase Storage not initialized");
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);
    return await getDownloadURL(storageRef);
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlobUrl: string,
  textureMaps?: TextureMaps,
  resources?: { [key: string]: string }
): Promise<void> => {
  if (!db || !storage) {
      console.warn("Firebase unavailable, cannot save.");
      throw new Error("Dịch vụ lưu trữ đang tạm ngưng (Firebase Error).");
  }

  try {
    const uniqueId = item.id; // Or generate a new one if needed, but item.id from creation time is fine
    const folderPath = `models/${uniqueId}`;

    // 1. Upload Main Model
    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    // Use .glb extension assuming standard export, or extract from url
    const modelDownloadUrl = await uploadFile(`${folderPath}/model.glb`, modelBlob);

    // 2. Upload Textures
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
      for (const [key, url] of Object.entries(textureMaps)) {
        if (url) {
          const texRes = await fetch(url);
          const texBlob = await texRes.blob();
          const texUrl = await uploadFile(`${folderPath}/textures/${key}.png`, texBlob);
          (textureUrls as any)[key] = texUrl;
        }
      }
    }

    // 3. Upload Resources (.bin etc)
    const resourceUrls: { [key: string]: string } = {};
    if (resources) {
      for (const [filename, url] of Object.entries(resources)) {
        if (url) {
           const resRes = await fetch(url);
           const resBlob = await resRes.blob();
           const resUrl = await uploadFile(`${folderPath}/resources/${filename}`, resBlob);
           resourceUrls[filename] = resUrl;
        }
      }
    }

    // 4. Save Metadata to Firestore
    await addDoc(collection(db, COLLECTION_NAME), {
      originalId: item.id,
      name: factData.name, // Use fact name as the primary name
      icon: item.icon,
      modelUrl: modelDownloadUrl,
      textures: textureUrls,
      resources: resourceUrls,
      textureFlipY: item.textureFlipY || false,
      color: item.color,
      modelType: item.modelType,
      baseColor: item.baseColor,
      factData: factData,
      createdAt: Timestamp.now()
    });

  } catch (error) {
    console.error("Firebase Save Failed:", error);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  if (!db) {
      console.warn("Firebase DB not initialized, returning empty library.");
      return [];
  }

  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      
      return {
        item: {
          id: doc.id, // Use Firestore ID for easier deletion
          name: data.name,
          icon: data.icon,
          modelUrl: data.modelUrl,
          textures: data.textures,
          resources: data.resources,
          textureFlipY: data.textureFlipY,
          color: data.color,
          modelType: data.modelType,
          baseColor: data.baseColor
        } as DiscoveryItem,
        factData: data.factData as FunFactData
      };
    });
  } catch (error) {
    console.error("Firebase Load Failed:", error);
    // Return empty array instead of throwing to prevent app crash if config is wrong
    return [];
  }
};

export const deleteFromLibrary = async (firestoreId: string): Promise<void> => {
    if (!db) return;

    try {
        await deleteDoc(doc(db, COLLECTION_NAME, firestoreId));
    } catch (error) {
        console.error("Firebase Delete Failed:", error);
        throw error;
    }
}