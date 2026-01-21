import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

const COLLECTION_NAME = 'models';

// Hàm phụ để tải file lên Storage với cơ chế retry đơn giản
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
    
    // Tự động đoán Content-Type chuẩn nếu blob chưa có hoặc chung chung
    let contentType = blob.type;
    const lowerPath = path.toLowerCase();
    
    if (!contentType || contentType === 'application/octet-stream') {
        if (lowerPath.endsWith('.glb')) contentType = 'model/gltf-binary';
        else if (lowerPath.endsWith('.gltf')) contentType = 'model/gltf+json';
        else if (lowerPath.endsWith('.bin')) contentType = 'application/octet-stream';
        else if (lowerPath.endsWith('.png')) contentType = 'image/png';
        else if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) contentType = 'image/jpeg';
    }

    const storageRef = ref(storage, path);
    
    const metadata = {
        contentType: contentType,
        cacheControl: 'public,max-age=3600'
    };

    await uploadBytes(storageRef, blob, metadata);
    const url = await getDownloadURL(storageRef);
    console.log(`Đã upload: ${path} (${contentType})`);
    return url;
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlobUrl: string,
  textureMaps?: TextureMaps,
  resources?: { [key: string]: string }
): Promise<void> => {
  
  // 1. Lưu offline để backup ngay lập tức
  try {
      await saveToLocalDB(item, factData, modelBlobUrl, resources);
  } catch (localError) {
      console.warn("Lỗi lưu offline:", localError);
  }

  // 2. Kiểm tra kết nối Cloud
  if (!db || !storage) {
      alert("Đang ở chế độ Offline. Mô hình chỉ được lưu trên máy này thôi nhé!");
      return; 
  }

  try {
    const uniqueId = item.id.startsWith('temp-') ? `item-${Date.now()}` : item.id; 
    const folderPath = `models/${uniqueId}`;

    // --- UPLOAD MÔ HÌNH CHÍNH ---
    let mainFileName = 'scene.glb'; 
    if (resources && modelBlobUrl) {
        // Tìm tên file gốc nếu có
        const foundName = Object.keys(resources).find(key => resources[key] === modelBlobUrl);
        if (foundName) mainFileName = foundName;
    }

    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    const modelDownloadUrl = await uploadFile(`${folderPath}/${mainFileName}`, modelBlob);

    // --- UPLOAD RESOURCES (BIN, TEXTURES RỜI) ---
    const resourceUrls: { [key: string]: string } = {};
    if (resources) {
      const resourcePromises = Object.entries(resources).map(async ([filename, url]) => {
        if (url && url.startsWith('blob:') && filename !== mainFileName) {
           try {
             const resRes = await fetch(url);
             const resBlob = await resRes.blob();
             const resUrl = await uploadFile(`${folderPath}/resources/${filename}`, resBlob);
             resourceUrls[filename] = resUrl;
           } catch (e) {
             console.warn(`Bỏ qua resource lỗi: ${filename}`, e);
           }
        }
      });
      await Promise.all(resourcePromises);
    }

    // --- UPLOAD TEXTURES (MAPPING) ---
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
        const texturePromises = Object.entries(textureMaps).map(async ([key, url]) => {
            if (url && url.startsWith('blob:')) {
                try {
                    const tRes = await fetch(url);
                    const tBlob = await tRes.blob();
                    // Xác định đuôi file (thường là png hoặc jpg)
                    const ext = tBlob.type.includes('jpeg') ? 'jpg' : 'png';
                    const tUrl = await uploadFile(`${folderPath}/textures/${key}.${ext}`, tBlob);
                    // @ts-ignore
                    textureUrls[key] = tUrl;
                } catch (e) { console.warn(`Bỏ qua texture lỗi: ${key}`); }
            }
        });
        await Promise.all(texturePromises);
    }

    // --- LƯU DATABASE ---
    await addDoc(collection(db, COLLECTION_NAME), {
      name: factData.name,
      icon: item.icon,
      thumbnail: item.thumbnail || null, // Lưu ảnh thumbnail base64 (chụp màn hình)
      modelUrl: modelDownloadUrl,
      resources: resourceUrls,
      textures: textureUrls,
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
    alert(`Lỗi khi đồng bộ: ${error.message}. Dữ liệu vẫn được lưu trên máy này.`);
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  let allItemsRaw: any[] = [];

  // 1. Load Local
  try {
      const local = await loadFromLocalDB();
      // Đánh dấu items local và thêm timestamp giả định nếu thiếu
      const localFormatted = local.map(l => ({
          ...l,
          createdAtTime: Date.now(), // Local coi như mới nhất tạm thời nếu không có time
          isLocal: true
      }));
      allItemsRaw = [...allItemsRaw, ...localFormatted];
  } catch (e) { console.error("Lỗi load local:", e); }

  // 2. Load Cloud (QUAN TRỌNG: Không dùng orderBy để tránh lỗi Index)
  if (db) {
    try {
        const q = query(collection(db, COLLECTION_NAME));
        const querySnapshot = await getDocs(q);
        
        const cloudItems = querySnapshot.docs.map((docSnap: any) => {
            const data = docSnap.data();
            
            // Xử lý an toàn cho createdAt (có thể là Timestamp object hoặc null)
            let timeVal = 0;
            if (data.createdAt && data.createdAt.seconds) {
                timeVal = data.createdAt.seconds * 1000;
            } else if (typeof data.createdAt === 'number') {
                timeVal = data.createdAt;
            }

            return {
                item: { 
                    ...data, 
                    id: docSnap.id, 
                    modelType: data.modelType || 'model'
                } as any,
                factData: data.factData as FunFactData,
                createdAtTime: timeVal,
                isLocal: false
            };
        });
        
        allItemsRaw = [...allItemsRaw, ...cloudItems];
        console.log(`Đã tải ${cloudItems.length} mô hình từ Cloud`);
    } catch (e) {
        console.error("Không tải được dữ liệu Cloud:", e);
    }
  }

  // 3. Lọc trùng và Sắp xếp Client-side (Mới nhất lên đầu)
  // Ưu tiên Cloud item nếu trùng ID (trừ temp-id)
  const uniqueMap = new Map();
  allItemsRaw.forEach(entry => {
      // Nếu đã có item này rồi, và item hiện tại là Cloud thì ghi đè (ưu tiên Cloud)
      if (uniqueMap.has(entry.item.id)) {
          if (!entry.isLocal) {
              uniqueMap.set(entry.item.id, entry);
          }
      } else {
          uniqueMap.set(entry.item.id, entry);
      }
  });

  const finalItems = Array.from(uniqueMap.values());
  
  // Sắp xếp giảm dần theo thời gian
  finalItems.sort((a: any, b: any) => b.createdAtTime - a.createdAtTime);

  return finalItems.map(entry => ({ item: entry.item, factData: entry.factData }));
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  await deleteFromLocalDB(id);
  if (db && !id.startsWith('temp-')) {
      try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
      } catch (e) { console.error("Lỗi xóa trên cloud", e); }
  }
};