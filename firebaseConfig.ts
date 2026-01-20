// @ts-ignore: Suppress "Module has no exported member initializeApp" error which can occur in some TS setups with Firebase v9
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getEnv } from "./utils/env";

const firebaseConfig = {
  apiKey: "AIzaSyDwqbnonJu8DA7BxRnw57klhBM7iaGPdT0",
  authDomain: "lindo-3d.firebaseapp.com",
  projectId: "lindo-3d",
  storageBucket: "lindo-3d.firebasestorage.app",
  messagingSenderId: "448393169111",
  appId: "1:448393169111:web:dcaf613efb242f1e70c892"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
let db: any;
let storage: any;

try {
  db = getFirestore(app);
  storage = getStorage(app);
  console.log("🔥 Firebase connected successfully!");
} catch (error) {
  console.error("🔥 Firebase connection failed:", error);
}

// Export services
export { db, storage };