import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

const COLLECTION_NAME = 'models';

// Trả về cả URL và Path
const uploadFile = async (path: string, blob: Blob): Promise<{ url: string, path: string }> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
    const storageRef = ref(storage, path);
    // Lưu ý: Luôn gán type là model/gltf-binary cho chuẩn
    const metadata = { contentType: 'model/gltf-binary', cacheControl: 'public,max-age=31536000' };
    await uploadBytes(storageRef, blob, metadata);
    const url = await getDownloadURL(storageRef);
    return { url, path }; // Trả về full path để lưu DB
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlob: Blob, 
  textureMaps?: TextureMaps, 
  resources?: { [key: string]: string }
): Promise<void> => {
  
  // 1. Tạo blob URL tạm để lưu local
  const tempUrl = URL.createObjectURL(modelBlob);
  try {
      await saveToLocalDB(item, factData, tempUrl, {});
  } catch (localError) { console.warn("Lỗi lưu offline:", localError); }

  if (!db || !storage) {
      alert("Đang ở chế độ Offline. Mô hình chỉ được lưu trên máy này thôi nhé!");
      return; 
  }

  try {
    const uniqueId = item.id.startsWith('temp-') ? `item-${Date.now()}` : item.id; 
    const folderPath = `models/${uniqueId}`;

    console.log("Đang upload mô hình...");
    // Upload file GLB duy nhất
    const cloudFileName = `model.glb`;
    const fullStoragePath = `${folderPath}/${cloudFileName}`;
    
    // Nhận về cả URL và Path
    const uploadResult = await uploadFile(fullStoragePath, modelBlob);

    // --- LƯU DATABASE ---
    await addDoc(collection(db, COLLECTION_NAME), {
      name: factData.name,
      icon: item.icon,
      thumbnail: item.thumbnail || null,
      modelUrl: uploadResult.url,
      storagePath: uploadResult.path, // QUAN TRỌNG: Lưu đường dẫn nội bộ
      resources: {}, 
      textures: {},
      textureFlipY: item.textureFlipY || false,
      color: item.color,
      modelType: item.modelType,
      baseColor: item.baseColor,
      factData: factData,
      createdAt: Timestamp.now()
    });

    console.log("Đã đồng bộ lên Cloud thành công!");

  } catch (error: any) {
    console.error("Lỗi Critical khi lưu Cloud:", error);
    alert(`Lỗi khi đồng bộ: ${error.message}`);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  let allItemsRaw: any[] = [];

  try {
      const local = await loadFromLocalDB();
      const localFormatted = local.map(l => ({ ...l, createdAtTime: Date.now(), isLocal: true }));
      allItemsRaw = [...allItemsRaw, ...localFormatted];
  } catch (e) { console.error("Lỗi load local:", e); }

  if (db) {
    try {
        const q = query(collection(db, COLLECTION_NAME));
        const querySnapshot = await getDocs(q);
        const cloudItems = querySnapshot.docs.map((docSnap: any) => {
            const data = docSnap.data();
            let timeVal = 0;
            if (data.createdAt && data.createdAt.seconds) timeVal = data.createdAt.seconds * 1000;
            else if (typeof data.createdAt === 'number') timeVal = data.createdAt;

            return {
                item: { ...data, id: docSnap.id, modelType: data.modelType || 'model' } as any,
                factData: data.factData as FunFactData,
                createdAtTime: timeVal,
                isLocal: false
            };
        });
        allItemsRaw = [...allItemsRaw, ...cloudItems];
    } catch (e) { console.error("Không tải được dữ liệu Cloud:", e); }
  }

  const uniqueMap = new Map();
  allItemsRaw.forEach(entry => {
      if (uniqueMap.has(entry.item.id)) {
          if (!entry.isLocal) uniqueMap.set(entry.item.id, entry);
      } else {
          uniqueMap.set(entry.item.id, entry);
      }
  });

  const finalItems = Array.from(uniqueMap.values());
  finalItems.sort((a: any, b: any) => b.createdAtTime - a.createdAtTime);
  return finalItems.map(entry => ({ item: entry.item, factData: entry.factData }));
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  await deleteFromLocalDB(id);
  if (db && !id.startsWith('temp-')) {
      try { await deleteDoc(doc(db, COLLECTION_NAME, id)); } 
      catch (e) { console.error("Lỗi xóa trên cloud", e); }
  }
};