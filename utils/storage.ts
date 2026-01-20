
import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import * as Firestore from 'firebase/firestore';
import * as FirebaseStorage from 'firebase/storage';

const { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } = Firestore as any;
const { ref, uploadBytes, getDownloadURL } = FirebaseStorage as any;

const COLLECTION_NAME = 'models';

// Hàm phụ để tải file lên Storage
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
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
  if (!db || !storage) throw new Error("Firebase chưa kết nối thành công.");

  try {
    const uniqueId = `item-${Date.now()}`; 
    const folderPath = `models/${uniqueId}`;

    // 1. Tải mô hình chính (.glb / .gltf)
    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    const modelDownloadUrl = await uploadFile(`${folderPath}/scene_main.glb`, modelBlob);

    // 2. Tải các tài nguyên đi kèm (textures, bin...)
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
             console.warn(`Không tải được resource: ${filename}`, e);
           }
        }
      }
    }

    // 3. Lưu thông tin vào Firestore
    await addDoc(collection(db, COLLECTION_NAME), {
      name: factData.name,
      icon: item.icon,
      modelUrl: modelDownloadUrl,
      resources: resourceUrls,
      textureFlipY: item.textureFlipY || false,
      color: item.color,
      modelType: item.modelType,
      baseColor: item.baseColor,
      factData: factData,
      createdAt: Timestamp.now()
    });

  } catch (error: any) {
    console.error("Lỗi khi lưu lên Firebase:", error);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  if (!db) return [];
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map((docSnap: any) => {
      const data = docSnap.data();
      return {
        item: { ...data, id: docSnap.id } as any,
        factData: data.factData as FunFactData
      };
    });
  } catch (e) {
    console.error("Lỗi khi tải thư viện:", e);
    return [];
  }
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  if (!db) return;
  await deleteDoc(doc(db, COLLECTION_NAME, id));
};
