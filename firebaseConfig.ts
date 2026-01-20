import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDwqbnonJu8DA7BxRnw57klhBM7iaGPdT0",
  authDomain: "lindo-3d.firebaseapp.com",
  projectId: "lindo-3d",
  storageBucket: "lindo-3d.firebasestorage.app",
  messagingSenderId: "448393169111",
  appId: "1:448393169111:web:dcaf613efb242f1e70c892"
};

// Singleton initialization pattern
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

let db: any = null;
let storage: any = null;

try {
  db = getFirestore(app);
  storage = getStorage(app);
} catch (error) {
  console.error("Firebase services initialization failed:", error);
}

export { db, storage, app };