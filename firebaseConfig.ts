
import * as FirebaseApp from "firebase/app";
import * as Firestore from "firebase/firestore";
import * as FirebaseStorage from "firebase/storage";

// Sử dụng các hàm từ namespace để tránh lỗi named exports
const { initializeApp, getApp, getApps } = FirebaseApp as any;
const { getFirestore } = Firestore as any;
const { getStorage } = FirebaseStorage as any;

const firebaseConfig = {
  apiKey: "AIzaSyDwqbnonJu8DA7BxRnw57klhBM7iaGPdT0",
  authDomain: "lindo-3d.firebaseapp.com",
  projectId: "lindo-3d",
  storageBucket: "lindo-3d.firebasestorage.app",
  messagingSenderId: "448393169111",
  appId: "1:448393169111:web:dcaf613efb242f1e70c892"
};

// Khởi tạo Firebase App an toàn
let app: any;
try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
} catch (e) {
  console.error("Firebase initialization failed:", e);
}

let db: any = null;
let storage: any = null;

if (app) {
  try {
    db = getFirestore(app);
    storage = getStorage(app);
  } catch (error) {
    console.error("Firebase services initialization failed:", error);
  }
}

export { db, storage, app };
