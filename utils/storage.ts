import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

const COLLECTION_NAME = 'models';

// Hàm làm sạch tên file cơ bản (chỉ dùng cho tên hiển thị nếu cần)
const sanitizeFilename = (filename: string): string => {
  const clean = filename.toLowerCase().replace(/[^a-z0-9.]/g, '_');
  return clean.length > 50 ? clean.substring(0, 50) : clean;
};

// Hàm phụ để tải file lên Storage với cơ chế retry đơn giản
const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
    
    const storageRef = ref(storage, path);
    
    const metadata = {
        contentType: blob.type,
        cacheControl: 'public,max-age=31536000' // Cache 1 năm vì file này không thay đổi
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
    // Tạo ID duy nhất dựa trên thời gian thực -> Đây sẽ là tên thư mục
    const uniqueId = item.id.startsWith('temp-') ? `item-${Date.now()}` : item.id; 
    const folderPath = `models/${uniqueId}`;

    // --- UPLOAD MÔ HÌNH CHÍNH ---
    // Tìm tên file gốc để biết đuôi file (glb hay gltf)
    let originalMainName = 'model.glb';
    let mainExtension = 'glb';

    if (resources && modelBlobUrl) {
        const foundName = Object.keys(resources).find(key => resources[key] === modelBlobUrl);
        if (foundName) {
            originalMainName = foundName;
            mainExtension = foundName.split('.').pop() || 'glb';
        }
    }
    
    // Tên file trên Cloud luôn ngắn gọn: "main_model.glb"
    const cloudMainFileName = `main_model.${mainExtension}`;

    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    const modelDownloadUrl = await uploadFile(`${folderPath}/${cloudMainFileName}`, modelBlob);

    // --- UPLOAD RESOURCES (BIN, TEXTURES RỜI) ---
    // QUAN TRỌNG: 
    // - File upload lên Cloud sẽ có tên ngắn: res_0.png, res_1.bin
    // - Firestore lưu map: { "Tên_Gốc_Dài_Ngoằng.png": "URL_Của_File_Ngắn" }
    const resourceUrls: { [key: string]: string } = {};
    
    if (resources) {
      const entries = Object.entries(resources);
      // Lọc ra các file resource (không phải file chính đã upload)
      const resourceEntries = entries.filter(([originalName]) => originalName !== originalMainName);

      const resourcePromises = resourceEntries.map(async ([originalFilename, url], index) => {
        if (url && url.startsWith('blob:')) {
           try {
             const resRes = await fetch(url);
             const resBlob = await resRes.blob();
             
             // Lấy đuôi file
             const ext = originalFilename.split('.').pop() || 'bin';
             // Đặt tên ngắn gọn cho file trên cloud
             const shortName = `res_${index}.${ext}`;
             
             const resUrl = await uploadFile(`${folderPath}/resources/${shortName}`, resBlob);
             
             // Map tên gốc -> URL mới
             resourceUrls[originalFilename] = resUrl;
           } catch (e) {
             console.warn(`Bỏ qua resource lỗi: ${originalFilename}`, e);
           }
        }
      });
      await Promise.all(resourcePromises);

      // Map lại file chính (đã upload ở trên) vào resources map nếu cần
      if (Object.keys(resources).includes(originalMainName)) {
          resourceUrls[originalMainName] = modelDownloadUrl;
      }
    }

    // --- UPLOAD TEXTURES (MAPPING) ---
    // Tương tự: texture_0.jpg, texture_1.png
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
        const textureEntries = Object.entries(textureMaps);
        const texturePromises = textureEntries.map(async ([key, url], index) => {
            if (url && url.startsWith('blob:')) {
                try {
                    const tRes = await fetch(url);
                    const tBlob = await tRes.blob();
                    const ext = tBlob.type.includes('jpeg') ? 'jpg' : 'png';
                    
                    // Tên file ngắn gọn
                    const shortName = `tex_${key}_${index}.${ext}`;
                    
                    const tUrl = await uploadFile(`${folderPath}/textures/${shortName}`, tBlob);
                    // @ts-ignore
                    textureUrls[key] = tUrl;
                } catch (e) { console.warn(`Bỏ qua texture lỗi: ${key}`); }
            }
        });
        await Promise.all(texturePromises);
    }

    // --- LƯU DATABASE ---
    // Dữ liệu lưu vào Firestore vẫn chứa map resourceUrls với Key là tên gốc
    // Để Toy3D.tsx có thể tra cứu đúng khi load file GLTF.
    await addDoc(collection(db, COLLECTION_NAME), {
      name: factData.name,
      icon: item.icon,
      thumbnail: item.thumbnail || null,
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
    // Nếu lỗi 'permission-denied' hoặc tương tự, thông báo rõ hơn
    if (error.code === 'permission-denied') {
        alert("Không có quyền lưu dữ liệu lên Cloud. Vui lòng kiểm tra Rules của Firebase.");
    } else if (error.message && error.message.includes("Service firestore is not available")) {
        alert("Lỗi kết nối dịch vụ Google. Vui lòng tải lại trang.");
    } else {
        alert(`Lỗi khi đồng bộ: ${error.message}. Dữ liệu vẫn được lưu trên máy này.`);
    }
    throw error;
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  let allItemsRaw: any[] = [];

  // 1. Load Local
  try {
      const local = await loadFromLocalDB();
      const localFormatted = local.map(l => ({
          ...l,
          createdAtTime: Date.now(), 
          isLocal: true
      }));
      allItemsRaw = [...allItemsRaw, ...localFormatted];
  } catch (e) { console.error("Lỗi load local:", e); }

  // 2. Load Cloud
  if (db) {
    try {
        const q = query(collection(db, COLLECTION_NAME));
        const querySnapshot = await getDocs(q);
        
        const cloudItems = querySnapshot.docs.map((docSnap: any) => {
            const data = docSnap.data();
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
    } catch (e) {
        console.error("Không tải được dữ liệu Cloud:", e);
    }
  }

  const uniqueMap = new Map();
  allItemsRaw.forEach(entry => {
      if (uniqueMap.has(entry.item.id)) {
          if (!entry.isLocal) {
              uniqueMap.set(entry.item.id, entry);
          }
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
      try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
      } catch (e) { console.error("Lỗi xóa trên cloud", e); }
  }
};