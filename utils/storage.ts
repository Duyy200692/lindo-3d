import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import * as Firestore from 'firebase/firestore';
import * as FirebaseStorage from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

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
  
  // 1. LUÔN LUÔN Lưu vào IndexedDB (Offline) trước
  // Đảm bảo người dùng luôn thấy mô hình đã lưu kể cả khi mạng lỗi
  try {
      await saveToLocalDB(item, factData, modelBlobUrl, resources);
      console.log("Đã lưu vào bộ nhớ thiết bị (Offline mode)");
  } catch (localError) {
      console.error("Lỗi lưu offline:", localError);
  }

  // 2. Nếu có mạng và Firebase, thử lưu lên Cloud
  if (!db || !storage) {
      console.warn("Đang ở chế độ Offline hoặc chưa cấu hình Firebase, chỉ lưu cục bộ.");
      return; 
  }

  try {
    const uniqueId = item.id.startsWith('temp-') ? `item-${Date.now()}` : item.id; 
    const folderPath = `models/${uniqueId}`;

    // Xác định tên file gốc
    let mainFileName = 'scene.glb'; 
    if (resources && modelBlobUrl) {
        const foundName = Object.keys(resources).find(key => resources[key] === modelBlobUrl);
        if (foundName) mainFileName = foundName;
    }

    // Tải mô hình chính
    const modelRes = await fetch(modelBlobUrl);
    const modelBlob = await modelRes.blob();
    const modelDownloadUrl = await uploadFile(`${folderPath}/${mainFileName}`, modelBlob);

    // Tải resources
    const resourceUrls: { [key: string]: string } = {};
    if (resources) {
      for (const [filename, url] of Object.entries(resources)) {
        if (url && url.startsWith('blob:') && filename !== mainFileName) {
           try {
             const resRes = await fetch(url);
             const resBlob = await resRes.blob();
             const resUrl = await uploadFile(`${folderPath}/resources/${filename}`, resBlob);
             resourceUrls[filename] = resUrl;
           } catch (e) {
             console.warn(`Không tải được resource lên cloud: ${filename}`);
           }
        }
      }
    }

    // Tải textures
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
        for (const [key, url] of Object.entries(textureMaps)) {
            if (url && url.startsWith('blob:')) {
                try {
                    const tRes = await fetch(url);
                    const tBlob = await tRes.blob();
                    const tUrl = await uploadFile(`${folderPath}/textures/${key}.png`, tBlob);
                    // @ts-ignore
                    textureUrls[key] = tUrl;
                } catch (e) { console.warn(`Lỗi upload texture ${key}`); }
            }
        }
    }

    // Lưu Firestore
    await addDoc(collection(db, COLLECTION_NAME), {
      name: factData.name,
      icon: item.icon,
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

  } catch (error: any) {
    console.error("Lỗi khi lưu lên Cloud (nhưng đã lưu Local):", error);
    // Không throw lỗi để app không báo thất bại, vì đã lưu được local rồi
  }
};

export const loadLibrary = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  let localItems: any[] = [];
  let cloudItems: any[] = [];

  // 1. Load Local
  try {
      localItems = await loadFromLocalDB();
  } catch (e) { console.error("Lỗi load local:", e); }

  // 2. Load Cloud
  if (db) {
    try {
        const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        cloudItems = querySnapshot.docs.map((docSnap: any) => {
        const data = docSnap.data();
        return {
            item: { ...data, id: docSnap.id } as any,
            factData: data.factData as FunFactData
        };
        });
    } catch (e) {
        console.error("Lỗi load cloud hoặc không có mạng:", e);
    }
  }

  // 3. Merge (Ưu tiên local nếu trùng ID - tuy nhiên ID cloud và local khác nhau do cơ chế sinh)
  // Đơn giản là nối lại.
  // Để tránh trùng lặp nội dung (nếu bạn vừa lưu local vừa lưu cloud), 
  // trong thực tế cần logic phức tạp hơn (sync). 
  // Ở đây ta hiển thị cả hai hoặc ưu tiên Cloud nếu muốn.
  // Nhưng để user thấy ngay cái vừa tạo -> show hết.
  
  return [...localItems, ...cloudItems];
};

export const deleteFromLibrary = async (id: string): Promise<void> => {
  // Thử xóa cả 2 nơi
  await deleteFromLocalDB(id);
  if (db) {
      try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
      } catch (e) { /* Bỏ qua nếu id không tồn tại trên cloud */ }
  }
};