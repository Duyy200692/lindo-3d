import { DiscoveryItem, FunFactData, TextureMaps } from '../types';

const DB_NAME = 'KiddoBuilderDB';
const DB_VERSION = 1;
const STORE_NAME = 'models';

// Mở kết nối IDB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export interface LocalModelData {
  id: string;
  item: DiscoveryItem;
  factData: FunFactData;
  blobs: { [key: string]: Blob }; // Lưu trữ Blob thực tế thay vì URL
  createdAt: number;
}

// Lưu mô hình vào IDB
export const saveToLocalDB = async (
  item: DiscoveryItem,
  factData: FunFactData,
  mainBlobUrl: string,
  resources?: { [key: string]: string }
): Promise<void> => {
  const db = await openDB();
  
  // 1. Chuyển đổi tất cả blob URL thành Blob data để lưu trữ
  const blobs: { [key: string]: Blob } = {};
  
  // Fetch file chính
  const mainRes = await fetch(mainBlobUrl);
  blobs['main'] = await mainRes.blob();

  // Fetch tài nguyên phụ (bin, textures)
  if (resources) {
    for (const [name, url] of Object.entries(resources)) {
        if(url) {
            try {
                const res = await fetch(url);
                blobs[name] = await res.blob();
            } catch (e) {
                console.warn(`Không thể lưu local resource: ${name}`);
            }
        }
    }
  }

  // Fetch textures trong textureMaps
  if (item.textures) {
      for (const [key, url] of Object.entries(item.textures)) {
          if (url) {
             try {
                 const res = await fetch(url);
                 const blob = await res.blob();
                 // Tạo một tên file giả định cho texture để map lại khi load
                 blobs[`texture_${key}`] = blob;
             } catch (e) {
                 console.warn(`Không thể lưu local texture: ${key}`);
             }
          }
      }
  }

  const data: LocalModelData = {
    id: item.id,
    item: { ...item, modelUrl: 'local', resources: {}, textures: {} }, // Reset URL khi lưu, sẽ tái tạo khi load
    factData,
    blobs,
    createdAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(data);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// Tải danh sách từ IDB
export const loadFromLocalDB = async (): Promise<{ item: DiscoveryItem, factData: FunFactData }[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results: LocalModelData[] = request.result;
      // Sắp xếp mới nhất trước
      results.sort((a, b) => b.createdAt - a.createdAt);

      const mapped = results.map(data => {
        // Tái tạo Blob URL từ Blob data
        const resources: { [key: string]: string } = {};
        let modelUrl = '';
        const textures: TextureMaps = {};

        // Reconstruct resources
        Object.entries(data.blobs).forEach(([key, blob]) => {
            const url = URL.createObjectURL(blob);
            if (key === 'main') {
                modelUrl = url;
            } else if (key.startsWith('texture_')) {
                const texKey = key.replace('texture_', '') as keyof TextureMaps;
                textures[texKey] = url;
            } else {
                resources[key] = url;
            }
        });

        // Nếu resources rỗng (trường hợp cũ), hãy đảm bảo main file có tên để mapper hoạt động
        // Tuy nhiên với logic mới, modelUrl là blob url, resources chứa các file khác.
        
        return {
          item: {
            ...data.item,
            id: data.id, // Đảm bảo ID khớp
            modelUrl,
            resources,
            textures
          },
          factData: data.factData
        };
      });
      resolve(mapped);
    };
    request.onerror = () => reject(request.error);
  });
};

export const deleteFromLocalDB = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}
