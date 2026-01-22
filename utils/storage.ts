import { DiscoveryItem, FunFactData, TextureMaps } from '../types';
import { db, storage } from '../firebaseConfig';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { saveToLocalDB, loadFromLocalDB, deleteFromLocalDB } from './indexedDB';

const COLLECTION_NAME = 'models';

// Helper: Chuyển Blob thành Base64 DataURI
const blobToDataURI = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// --- LOGIC ĐÓNG GÓI MỚI ---
// Nhúng tất cả file rời vào trong file GLTF chính
const packGltfToSingleFile = async (
    modelBlobUrl: string, 
    resources: { [key: string]: string } = {}
): Promise<{ blob: Blob, extension: string }> => {
    
    const response = await fetch(modelBlobUrl);
    const mainBlob = await response.blob();
    
    // 1. Kiểm tra nếu là GLB (Binary) -> Đã đóng gói sẵn, không cần làm gì
    const headerBuffer = await mainBlob.slice(0, 4).arrayBuffer();
    const headerView = new DataView(headerBuffer);
    if (headerView.byteLength >= 4 && headerView.getUint32(0, true) === 0x46546C67) {
        return { blob: mainBlob, extension: 'glb' };
    }

    // 2. Nếu là GLTF (JSON) -> Tiến hành nhúng resource
    try {
        const text = await mainBlob.text();
        const json = JSON.parse(text);
        let modified = false;

        // Helper tìm url trong resources map
        const findResourceUrl = (uri: string) => {
            const cleanUri = decodeURIComponent(uri).split('/').pop() || '';
            // Tìm chính xác hoặc tương đối
            const key = Object.keys(resources).find(k => k === cleanUri || k.endsWith(cleanUri));
            return key ? resources[key] : null;
        };

        // Nhúng Buffers (.bin)
        if (json.buffers) {
            await Promise.all(json.buffers.map(async (buffer: any) => {
                if (buffer.uri && !buffer.uri.startsWith('data:')) {
                    const resUrl = findResourceUrl(buffer.uri);
                    if (resUrl) {
                        const resBlob = await (await fetch(resUrl)).blob();
                        const base64 = await blobToDataURI(resBlob);
                        buffer.uri = base64; // Thay thế đường dẫn bằng dữ liệu thật
                        modified = true;
                    }
                }
            }));
        }

        // Nhúng Images (Textures)
        if (json.images) {
            await Promise.all(json.images.map(async (image: any) => {
                if (image.uri && !image.uri.startsWith('data:')) {
                    const resUrl = findResourceUrl(image.uri);
                    if (resUrl) {
                        const resBlob = await (await fetch(resUrl)).blob();
                        const base64 = await blobToDataURI(resBlob);
                        image.uri = base64; // Thay thế đường dẫn bằng dữ liệu thật
                        modified = true;
                    }
                }
            }));
        }

        // Tạo blob mới từ JSON đã chỉnh sửa
        const finalString = JSON.stringify(json);
        return { 
            blob: new Blob([finalString], { type: 'application/json' }), 
            extension: 'gltf' 
        };

    } catch (e) {
        console.warn("Không thể đóng gói GLTF, sẽ upload file gốc:", e);
        return { blob: mainBlob, extension: 'gltf' };
    }
};

const uploadFile = async (path: string, blob: Blob): Promise<string> => {
    if (!storage) throw new Error("Storage chưa sẵn sàng.");
    const storageRef = ref(storage, path);
    const metadata = { contentType: blob.type, cacheControl: 'public,max-age=31536000' };
    await uploadBytes(storageRef, blob, metadata);
    return await getDownloadURL(storageRef);
};

export const saveModelToLibrary = async (
  item: DiscoveryItem, 
  factData: FunFactData,
  modelBlobUrl: string,
  textureMaps?: TextureMaps,
  resources?: { [key: string]: string }
): Promise<void> => {
  
  try {
      await saveToLocalDB(item, factData, modelBlobUrl, resources);
  } catch (localError) { console.warn("Lỗi lưu offline:", localError); }

  if (!db || !storage) {
      alert("Đang ở chế độ Offline. Mô hình chỉ được lưu trên máy này thôi nhé!");
      return; 
  }

  try {
    const uniqueId = item.id.startsWith('temp-') ? `item-${Date.now()}` : item.id; 
    const folderPath = `models/${uniqueId}`;

    // --- BƯỚC QUAN TRỌNG: ĐÓNG GÓI ---
    console.log("Đang đóng gói mô hình...");
    const { blob: packedBlob, extension } = await packGltfToSingleFile(modelBlobUrl, resources);
    
    // Upload file duy nhất (đã chứa tất cả mọi thứ)
    // Đặt tên file cố định là 'packed_model' để dễ quản lý
    const cloudFileName = `packed_model.${extension}`;
    const modelDownloadUrl = await uploadFile(`${folderPath}/${cloudFileName}`, packedBlob);

    // Xử lý Custom Textures (Da, Normal Map...) - Những cái này ko nằm trong GLTF nên vẫn upload rời
    const textureUrls: TextureMaps = {};
    if (textureMaps) {
        const texturePromises = Object.entries(textureMaps).map(async ([key, url]) => {
            if (url && url.startsWith('blob:')) {
                try {
                    const tRes = await fetch(url);
                    const tBlob = await tRes.blob();
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
      thumbnail: item.thumbnail || null,
      modelUrl: modelDownloadUrl,
      // QUAN TRỌNG: Resources set rỗng vì tất cả đã nằm trong file modelUrl rồi
      resources: {}, 
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