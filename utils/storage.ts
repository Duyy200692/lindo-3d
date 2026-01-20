import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const COLLECTION_NAME = 'models';

// Helper to upload a single blob and get URL
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) {
        throw new Error("Dịch vụ lưu trữ chưa được kích hoạt trong Firebase.");
    }
    
    const storageRef = ref(storage, path);
    try {
        await uploadBytes(storageRef, blob);
        return await getDownloadURL(storageRef);
    } catch (e: any) {
        console.error("Storage Error:", e);
        if (e.message?.includes('billing') || e.code === 'storage/retry-limit-exceeded') {
            throw new Error("Bé ơi, Firebase yêu cầu nâng cấp gói 'Blaze' mới cho phép lưu file. Bé có thể nhờ ba mẹ giúp hoặc chỉ xem mô hình mà không lưu nhé!");
        }
        if (e.code === 'storage/unauthorized') {
            throw new Error("Lỗi Quyền: Bé hãy kiểm tra lại cấu hình Rules trong Storage (cho phép allow write: if true).");
        }
        throw e;
    }
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlobUrl: string,
  textureMaps?: TextureMaps,
  resources?: { [key: string]: string }
): Promise<void> => {
  if (!db) throw new Error("Database chưa sẵn sàng.");

  try {
    const uniqueId = `item-${Date.now()}`; 
    const folderPath = `models/${uniqueId}`;

    // 1. Upload Main Model
    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    const modelDownloadUrl = await uploadFile(`${folderPath}/model.glb`, modelBlob);

    // 2. Upload Textures
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
      for (const [key, url] of Object.entries(textureMaps)) {
        if (url && url.startsWith('blob:')) {
          try {
            const texRes = await fetch(url);
            const texBlob = await texRes.blob();
            const texUrl = await uploadFile(`${folderPath}/textures/${key}.png`, texBlob);
            (textureUrls as any)[key] = texUrl;
          } catch (e) {
            console.warn(`Texture ${key} skipped`, e);
          }
        }
      }
    }

    // 3. Upload Resources
    const resourceUrls: { [key: string]: string } = {};
    if (resources) {
      for (const [filename, url] of Object.entries(resources)) {
        if (url && url.startsWith('blob:')) {
           try {
             const resRes = await fetch(url);
             const resBlob = await resRes.blob();
             const resUrl = await uploadFile(`${folderPath}/resources/${filename}`, resBlob);
             resourceUrls[filename] = resUrl;
           } catch (e) {
             console.warn(`Resource ${filename} skipped`, e);
           }
        }
      }
    }

    // 4. Firestore record
    await addDoc(collection(db, COLLECTION_NAME), {
      originalId: item.id,
      name: factData.name,
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

  } catch (error: any) {
    console.error("Save Failed:", error);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  if (!db) return [];
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        item: { ...data, id: doc.id } as any,
        factData: data.factData as FunFactData
      };
    });
  } catch (e) {
    console.error("Load Failed:", e);
    return [];
  }
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  if (!db) return;
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};