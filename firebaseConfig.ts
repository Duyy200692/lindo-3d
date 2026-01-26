import { initializeApp, getApp, getApps, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import * as FirebaseAuth from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDwqbnonJu8DA7BxRnw57klhBM7iaGPdT0",
  authDomain: "lindo-3d.firebaseapp.com",
  projectId: "lindo-3d",
  storageBucket: "lindo-3d.firebasestorage.app",
  messagingSenderId: "448393169111",
  appId: "1:448393169111:web:dcaf613efb242f1e70c892"
};

let app: FirebaseApp;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let auth: FirebaseAuth.Auth | null = null;

try {
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApp();
    }

    // Cấu hình Firestore với cache offline bền vững (IndexedDB)
    db = initializeFirestore(app, {
        localCache: persistentLocalCache({
             tabManager: persistentMultipleTabManager() 
        })
    });
    
    storage = getStorage(app);
    auth = FirebaseAuth.getAuth(app);
    
    console.log("Firebase đã kết nối (Offline Persistence Enabled)!");
} catch (error) {
    console.error("Lỗi cấu hình Firebase:", error);
}

export { db, storage, auth, app };