import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

const COLLECTION_NAME = 'models';

// Hàm phụ để tải file lên Storage với cơ chế retry đơn giản
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
    
    // Thêm timestamp vào tên file để tránh cache
    const storageRef = ref(storage, path);
    
    // Metadata giúp xử lý CORS tốt hơn trên một số trình duyệt
    const metadata = {
        contentType: blob.type,
        cacheControl: 'public,max-age=3600'
    };

    await uploadBytes(storageRef, blob, metadata);
    const url = await getDownloadURL(storageRef);
    console.log(`Đã upload: ${path}`);
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
  let localItems: any[] = [];
  let cloudItems: any[] = [];

  // Load Local trước để hiển thị nhanh
  try {
      localItems = await loadFromLocalDB();
  } catch (e) { console.error("Lỗi load local:", e); }

  // Load Cloud nếu có mạng
  if (db) {
    try {
        const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        cloudItems = querySnapshot.docs.map((docSnap: any) => {
            const data = docSnap.data();
            return {
                item: { 
                    ...data, 
                    id: docSnap.id, // ID từ Firestore
                    modelType: data.modelType || 'model'
                } as any,
                factData: data.factData as FunFactData
            };
        });
    } catch (e) {
        console.error("Không tải được dữ liệu Cloud:", e);
    }
  }

  // Gộp dữ liệu: Ưu tiên Cloud Items, sau đó đến Local Items (những cái chưa được đồng bộ)
  // Logic đơn giản: Hiển thị tất cả, người dùng sẽ thấy trùng nếu vừa save xong (chấp nhận được ở mức này)
  return [...cloudItems, ...localItems.filter(l => l.id.startsWith('temp-') || l.item.modelUrl === 'local')];
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  await deleteFromLocalDB(id);
  if (db && !id.startsWith('temp-')) {
      try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
      } catch (e) { console.error("Lỗi xóa trên cloud", e); }
  }
};