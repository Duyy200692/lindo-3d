
import React, { useState, useEffect, useRef } from 'react';
import { DiscoveryItem, AppMode, FunFactData, TextureMaps } from './types';
import Toy3D from './components/Toy3D';
import { fetchFunFact } from './services/geminiService';
import { saveModelToLibrary, loadLibrary, deleteFromLibrary } from './utils/storage';
import { db, auth } from './firebaseConfig';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Sparkles, ArrowLeft, Volume2, Rotate3d, Upload, 
  ArrowRight, Wand2, Save, Library, Trash2, 
  Image as ImageIcon, Check, Zap, Wifi, WifiOff, 
  Loader2, Lock, Settings, X, Box, Layers
} from 'lucide-react';

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.GALLERY);
  const [selectedItem, setSelectedItem] = useState<DiscoveryItem | null>(null);
  const [factData, setFactData] = useState<FunFactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [savedItems, setSavedItems] = useState<{ item: DiscoveryItem, factData: FunFactData }[]>([]);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Admin logic
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pinInput, setPinInput] = useState("");
  
  // Model creation state
  const [showNameInput, setShowNameInput] = useState(false);
  const [tempModelUrl, setTempModelUrl] = useState<string | null>(null);
  const [tempTextures, setTempTextures] = useState<TextureMaps>({});
  const [tempResources, setTempResources] = useState<{ [key: string]: string }>({}); 
  const [tempFlipY, setTempFlipY] = useState(false);
  const [customName, setCustomName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTextureType, setActiveTextureType] = useState<keyof TextureMaps | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const multiTextureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    
    // Tự động đăng nhập ẩn danh để thỏa mãn Rules: if request.auth != null
    if (auth) {
      signInAnonymously(auth)
        .then(() => {
          console.log("Đã kết nối Firebase (Ẩn danh)");
          setIsAuthenticated(true);
          loadSavedLibrary();
        })
        .catch((err) => {
          console.error("Firebase Auth failed:", err);
          loadSavedLibrary(); // Thử load dù auth lỗi
        });
    }

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
      window.speechSynthesis.cancel();
    };
  }, []);

  const loadSavedLibrary = async () => {
    setLoadingLibrary(true);
    try {
      if (db) {
        const library = await loadLibrary();
        setSavedItems(library);
      }
    } catch (e) {
      console.error("Failed to load library", e);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const handleBack = () => {
    setMode(isAdmin ? AppMode.ADMIN : AppMode.GALLERY);
    setSelectedItem(null);
    setFactData(null);
    setShowNameInput(false);
    setCustomName("");
    setTempModelUrl(null);
    setTempTextures({});
    setTempResources({});
    setTempFlipY(false);
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setIsSaving(false);
    loadSavedLibrary(); 
  };

  const speakText = (text: string) => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'vi-VN';
    utterance.rate = 0.9;
    utterance.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleVerifyPin = () => {
    if (pinInput === "1234") {
      setIsAdmin(true);
      setMode(AppMode.ADMIN);
      setShowPinDialog(false);
      setPinInput("");
    } else {
      alert("Mật mã chưa đúng rồi ba mẹ ơi!");
      setPinInput("");
    }
  };

  const handleExitAdmin = () => {
    setIsAdmin(false);
    setMode(AppMode.GALLERY);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleModelFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files) as File[];
    const mainFile = fileArray.find(f => f.name.toLowerCase().endsWith('.gltf') || f.name.toLowerCase().endsWith('.glb'));

    if (!mainFile) {
      alert("Chọn file .glb hoặc .gltf nhé!");
      return;
    }

    const resources: { [key: string]: string } = {};
    fileArray.forEach(f => {
      resources[f.name] = URL.createObjectURL(f);
    });

    setTempModelUrl(resources[mainFile.name]);
    setTempResources(resources);
    setShowNameInput(true);
    setCustomName("");
    setTempTextures({});
    setTempFlipY(false);
    event.target.value = '';
  };

  const handleConfirmName = async () => {
    if (!tempModelUrl) return;
    const finalName = customName.trim() || "Mô hình bí ẩn";
    const tempId = `temp-${Date.now()}`;
    const customItem: DiscoveryItem = {
      id: tempId, name: finalName, icon: '✨', modelUrl: tempModelUrl,
      textures: tempTextures, resources: tempResources, textureFlipY: tempFlipY, 
      color: 'bg-indigo-400', modelType: 'model', baseColor: '#818cf8'
    };
    setSelectedItem(customItem);
    setShowNameInput(false); 
    setMode(AppMode.VIEWER); 
    setLoading(true); 
    try {
        const data = await fetchFunFact(finalName);
        setFactData(data);
    } catch (e) {
        setFactData({ name: finalName, description: "Xem mô hình 3D tuyệt đẹp!", funFact: "Thế giới 3D thật thú vị!", soundText: "..." });
    } finally {
        setLoading(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (!selectedItem || !factData || !selectedItem.modelUrl) return;
    if (!isOnline) { alert("Cần có mạng để lưu mây ba mẹ nhé!"); return; }
    if (!isAuthenticated) { alert("App đang chờ kết nối bảo mật với Firebase, ba mẹ đợi 1 giây rồi nhấn lại nhé!"); return; }
    
    setIsSaving(true);
    try {
      await saveModelToLibrary(selectedItem, factData, selectedItem.modelUrl, selectedItem.textures, selectedItem.resources);
      alert("Lưu thành công vào bộ sưu tập!");
      setIsSaving(false);
      setMode(AppMode.ADMIN);
      setSelectedItem(null);
      loadSavedLibrary();
    } catch (e: any) {
      console.error("Save Error:", e);
      alert(`Lỗi: ${e.message || "Không thể lưu. Ba mẹ kiểm tra lại quyền truy cập Storage nhé!"}`);
      setIsSaving(false);
    }
  };

  const handleOpenLibraryItem = (saved: { item: DiscoveryItem, factData: FunFactData }) => {
    setSelectedItem(saved.item);
    setFactData(saved.factData);
    setMode(AppMode.VIEWER);
  };

  const handleDeleteItem = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if(confirm("Xác nhận xóa mô hình này?")) {
        await deleteFromLibrary(id);
        loadSavedLibrary();
    }
  }

  // Logic tự động nhận diện Texture dựa trên tên file
  const handleAutoTextureSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const newTextures: TextureMaps = { ...tempTextures };
    
    Array.from(files).forEach((file: File) => {
      const name = file.name.toLowerCase();
      const url = URL.createObjectURL(file);
      
      // Quy tắc nhận diện tên file phổ biến trong thiết kế 3D
      if (name.includes('base') || name.includes('color') || name.includes('diffuse') || name.includes('albedo')) {
        newTextures.map = url;
      } else if (name.includes('norm')) {
        newTextures.normalMap = url;
      } else if (name.includes('rough')) {
        newTextures.roughnessMap = url;
      } else if (name.includes('metal') || name.includes('spec')) {
        newTextures.metalnessMap = url;
      } else if (name.includes('ao') || name.includes('occlusion')) {
        newTextures.aoMap = url;
      } else if (name.includes('emissive') || name.includes('glow')) {
        newTextures.emissiveMap = url;
      }
    });

    setTempTextures(newTextures);
    event.target.value = ''; // Reset input
  };

  const TextureButton = ({ type, label, iconClass }: { type: keyof TextureMaps, label: string, iconClass: string }) => {
    const textureUrl = tempTextures[type];
    const isSet = !!textureUrl;
    return (
        <button 
          onClick={() => { setActiveTextureType(type); setTimeout(() => textureInputRef.current?.click(), 50); }} 
          className={`relative flex flex-col items-center justify-center p-2 rounded-2xl border-2 transition-all h-28 overflow-hidden group shadow-sm ${isSet ? 'border-orange-500 bg-orange-50/50' : 'border-slate-100 bg-white hover:border-orange-200'}`}
        >
            {isSet ? (
                <div className="absolute inset-0">
                  <img src={textureUrl} className="w-full h-full object-cover opacity-80" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent flex items-end p-2">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>
            ) : (
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-2 bg-slate-50 ${iconClass}`}><ImageIcon className="w-5 h-5" /></div>
            )}
            <span className={`relative z-10 text-[10px] font-black uppercase tracking-wider ${isSet ? 'text-white' : 'text-slate-400'}`}>{label}</span>
        </button>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 relative overflow-hidden font-sans flex flex-col animate-fadeIn">
      {/* Hidden Inputs */}
      <input type="file" ref={fileInputRef} onChange={handleModelFileChange} accept=".glb,.gltf,.bin,.png,.jpg,.jpeg" multiple className="hidden" />
      <input type="file" ref={textureInputRef} onChange={(e) => {
        const file = e.target.files?.[0];
        if (file && activeTextureType) {
          setTempTextures(prev => ({ ...prev, [activeTextureType]: URL.createObjectURL(file) }));
        }
        e.target.value = '';
        setActiveTextureType(null);
      }} accept="image/*" className="hidden" />
      <input type="file" ref={multiTextureInputRef} onChange={handleAutoTextureSelection} accept="image/*" multiple className="hidden" />

      <header className="relative z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-white rounded-xl shadow-sm">
            <Rotate3d className={`w-6 h-6 ${isAdmin ? 'text-orange-500' : 'text-indigo-500'}`} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-700 leading-none">Kiddo<span className={isAdmin ? 'text-orange-500' : 'text-indigo-500'}>Builder</span></h1>
            {isAdmin && <span className="text-[9px] font-black uppercase tracking-tighter text-orange-400">Góc Phụ Huynh</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border ${isOnline ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-500'}`}>
            <span className="text-[10px] font-black uppercase tracking-widest">{isOnline ? 'Mây' : 'Offline'}</span>
          </div>
          
          {isAdmin ? (
            <button onClick={handleExitAdmin} className="p-2 bg-orange-500 text-white rounded-xl shadow-md active:scale-95 transition-all">
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={() => setShowPinDialog(true)} className="p-2 bg-white text-slate-300 rounded-xl hover:text-indigo-400 transition-colors">
              <Lock className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-4 max-w-lg flex-1 flex flex-col justify-center overflow-hidden">
        {/* GALLERY MODE (KIDS VIEW) */}
        {mode === AppMode.GALLERY && (
          <div className="flex flex-col h-full animate-fadeIn">
            <div className="flex items-center justify-center py-6">
              <div className="text-center">
                <h2 className="text-2xl font-black text-slate-800">Chào bé yêu!</h2>
                <p className="text-slate-400 text-sm">Hôm nay bé muốn xem gì nào?</p>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto no-scrollbar pb-6 px-1 grid grid-cols-2 gap-4">
              {loadingLibrary ? (
                <div className="col-span-2 flex flex-col items-center py-12 opacity-30">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                </div>
              ) : savedItems.length === 0 ? (
                <div className="col-span-2 text-center py-12 bg-white/50 rounded-3xl border-2 border-dashed border-slate-200">
                  <p className="text-slate-400 text-sm px-10">Nhờ ba mẹ tải thêm mô hình 3D cho bé nhé!</p>
                </div>
              ) : (
                savedItems.map((record) => (
                  <button key={record.item.id} onClick={() => handleOpenLibraryItem(record)} className="bg-white p-4 rounded-[32px] shadow-sm border border-slate-100 flex flex-col items-center gap-3 active:scale-[0.95] transition-all group aspect-square justify-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:rotate-12 transition-transform">
                       <Rotate3d className="w-8 h-8" />
                    </div>
                    <div className="text-5xl mb-2">{record.item.icon}</div>
                    <h4 className="font-bold text-slate-700 text-sm text-center">{record.factData.name}</h4>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ADMIN MODE (PARENTS VIEW) */}
        {mode === AppMode.ADMIN && (
          <div className="flex flex-col h-full animate-fadeIn">
            <div className="py-4">
              <div className="bg-orange-50 border-2 border-orange-200 p-4 rounded-[28px] mb-4">
                 <h3 className="text-orange-700 font-bold mb-1 flex items-center gap-2 text-sm">
                   <Settings className="w-4 h-4" /> Hướng dẫn Phụ huynh
                 </h3>
                 <p className="text-orange-600/80 text-[10px] leading-relaxed">
                   Tải file <b>.glb</b> hoặc <b>.gltf</b>. Sau đó nạp Texture (ảnh da) nếu mô hình yêu cầu ảnh rời.
                 </p>
              </div>
              <button onClick={handleUploadClick} className="group relative w-full h-24 bg-white border-4 border-dashed border-orange-200 rounded-[28px] hover:border-orange-400 active:scale-95 transition-all flex flex-col items-center justify-center shadow-sm">
                <div className="w-10 h-10 mb-1 bg-orange-50 rounded-full flex items-center justify-center text-orange-500"><Upload className="w-5 h-5" /></div>
                <span className="text-orange-600 font-bold text-sm">Tải mô hình lên</span>
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <div className="flex items-center gap-2 mb-3 px-1">
                <Library className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Kho đồ chơi ({savedItems.length})</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto no-scrollbar pb-6 px-1 space-y-3">
                {savedItems.map((record) => (
                  <div key={record.item.id} className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-xl shrink-0">{record.item.icon}</div>
                    <div className="flex-1 min-w-0">
                       <h4 className="font-bold text-slate-700 truncate text-sm">{record.factData.name}</h4>
                       <p className="text-[10px] text-slate-400">3D Model Ready</p>
                    </div>
                    <button onClick={(e) => handleDeleteItem(e, record.item.id)} className="p-2 text-red-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEWER MODE (COMMON) */}
        {mode === AppMode.VIEWER && selectedItem && (
          <div className="h-full flex flex-col animate-fadeIn pb-4">
            <div className="flex items-center justify-between mb-2">
              <button onClick={handleBack} className="p-2 bg-white rounded-xl shadow-sm text-slate-400 hover:bg-slate-50"><ArrowLeft className="w-5 h-5" /></button>
              {isAdmin && selectedItem.id.startsWith('temp') && (
                <button onClick={handleSaveToLibrary} disabled={isSaving} className="px-4 py-2 bg-orange-500 rounded-full shadow-md font-bold text-xs text-white flex items-center gap-2">
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {isSaving ? "Đang lưu..." : "Lưu vào kho"}
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 relative">
               <Toy3D item={selectedItem} />
            </div>
            <div className="bg-white rounded-[32px] p-5 shadow-sm border border-slate-100 mt-2">
              {loading ? (
                <div className="py-4 flex flex-col items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-200 animate-spin" /></div>
              ) : factData ? (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-black text-slate-800">{factData.name}</h2>
                    <button onClick={() => speakText(`${factData.name}. ${factData.description}`)} className={`p-2 rounded-full ${speaking ? 'bg-red-500 text-white' : 'bg-indigo-50 text-indigo-500'}`}><Volume2 className="w-5 h-5" /></button>
                  </div>
                  <p className="text-slate-500 text-sm font-medium leading-relaxed mb-3">{factData.description}</p>
                  <div className="bg-yellow-50 p-3 rounded-2xl flex gap-2 border border-yellow-100">
                    <Sparkles className="w-4 h-4 text-orange-400 shrink-0" />
                    <p className="text-[11px] text-slate-600 italic">{factData.funFact}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>

      {/* PIN DIALOG FOR PARENTS */}
      {showPinDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-fadeIn">
          <div className="bg-white rounded-[32px] p-8 w-full max-w-xs text-center shadow-2xl">
            <div className="w-16 h-16 bg-indigo-100 text-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-black text-slate-800 mb-2">Dành cho Phụ huynh</h3>
            <p className="text-slate-500 text-xs mb-6">Nhập mật mã để mở quyền quản lý mô hình (Mặc định: 1234)</p>
            <input 
              type="password" 
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              className="w-full text-center text-3xl tracking-[1em] font-black border-b-4 border-indigo-200 outline-none mb-8 text-indigo-600 bg-transparent"
              placeholder="••••"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowPinDialog(false)} className="flex-1 py-3 font-bold text-slate-400">Hủy</button>
              <button onClick={handleVerifyPin} className="flex-2 py-3 px-6 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-100">Xác nhận</button>
            </div>
          </div>
        </div>
      )}

      {/* NAME & TEXTURE INPUT OVERLAY */}
      {showNameInput && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[40px] shadow-2xl p-6 w-full max-w-md flex flex-col max-h-[90vh] animate-fadeIn border-t-8 border-orange-400">
               <h3 className="text-xl font-black text-center mb-6 text-slate-800">Cài đặt mô hình ✨</h3>
               
               <div className="space-y-6 overflow-y-auto no-scrollbar flex-1 mb-6 px-1">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 mb-2 block">Tên mô hình</label>
                    <input autoFocus type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Tên là gì vậy ba mẹ?" className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-orange-400 outline-none font-bold text-slate-700" />
                  </div>

                  <div className="bg-slate-50/50 p-5 rounded-[32px] border border-slate-100">
                     <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                           <Layers className="w-4 h-4 text-orange-400" />
                           <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Tùy chọn Texture</span>
                        </div>
                        <button 
                          onClick={() => multiTextureInputRef.current?.click()} 
                          className="px-3 py-1.5 bg-orange-500 text-white rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-md shadow-orange-100 active:scale-95 transition-all"
                        >
                          <Zap className="w-3 h-3" /> Tự động nạp tất cả
                        </button>
                     </div>

                     <div className="grid grid-cols-3 gap-3">
                        <TextureButton type="map" label="Màu da" iconClass="text-pink-400" />
                        <TextureButton type="normalMap" label="Khối sần" iconClass="text-blue-400" />
                        <TextureButton type="roughnessMap" label="Độ nhám" iconClass="text-emerald-400" />
                        <TextureButton type="metalnessMap" label="Kim loại" iconClass="text-slate-500" />
                        <TextureButton type="aoMap" label="Đổ bóng" iconClass="text-indigo-400" />
                        <TextureButton type="emissiveMap" label="Phát sáng" iconClass="text-yellow-400" />
                     </div>
                  </div>

                  <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-100 rounded-2xl">
                     <input type="checkbox" id="flipy" checked={tempFlipY} onChange={(e) => setTempFlipY(e.target.checked)} className="w-5 h-5 accent-orange-500" />
                     <label htmlFor="flipy" className="text-xs font-bold text-slate-500">Lật ngược ảnh (Flip Y) - Dùng nếu ảnh bị ngược</label>
                  </div>
               </div>

               <div className="flex gap-3">
                 <button onClick={handleBack} className="flex-1 py-4 font-bold text-slate-400 hover:text-slate-600 transition-colors">Hủy</button>
                 <button onClick={handleConfirmName} disabled={!customName.trim()} className="flex-[2] py-4 bg-orange-500 rounded-3xl text-white font-bold shadow-xl shadow-orange-100 disabled:opacity-50 transition-all active:scale-95">Xem mô hình 3D <ArrowRight className="inline w-4 h-4 ml-1" /></button>
               </div>
            </div>
          </div>
        )}
    </div>
  );
}
