import React, { useState, useEffect, useRef } from 'react';
import { DiscoveryItem, AppMode, FunFactData, TextureMaps } from './types';
import Toy3D from './components/Toy3D';
import { fetchFunFact } from './services/geminiService';
import { saveModelToLibrary, loadLibrary, deleteFromLibrary } from './utils/storage';
import { Sparkles, ArrowLeft, Volume2, Rotate3d, Info, Upload, ArrowRight, Wand2, Save, Library, Trash2, Image as ImageIcon, Layers, Check, Zap, RefreshCw, Lightbulb } from 'lucide-react';

export default function App() {
  const [mode, setMode] = useState<AppMode>(AppMode.GALLERY);
  const [selectedItem, setSelectedItem] = useState<DiscoveryItem | null>(null);
  const [factData, setFactData] = useState<FunFactData | null>(null);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [savedItems, setSavedItems] = useState<{ item: DiscoveryItem, factData: FunFactData }[]>([]);
  
  // State for the "Name Input" step
  const [showNameInput, setShowNameInput] = useState(false);
  const [tempModelUrl, setTempModelUrl] = useState<string | null>(null);
  const [tempTextures, setTempTextures] = useState<TextureMaps>({});
  const [tempResources, setTempResources] = useState<{ [key: string]: string }>({}); // New: For .bin files
  const [tempFlipY, setTempFlipY] = useState(false);
  const [customName, setCustomName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [activeTextureType, setActiveTextureType] = useState<keyof TextureMaps | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const multiTextureInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSavedLibrary();
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const loadSavedLibrary = async () => {
    try {
      const library = await loadLibrary();
      setSavedItems(library);
    } catch (e) {
      console.error("Failed to load library", e);
    }
  };

  const handleBack = () => {
    setMode(AppMode.GALLERY);
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
    utterance.pitch = 1.1;
    utterance.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // -- UPLOAD HANDLERS --

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleModelFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Convert FileList to Array
    const fileArray = Array.from(files) as File[];

    // 1. Find the main model file (.gltf or .glb)
    const mainFile = fileArray.find(f => f.name.toLowerCase().endsWith('.gltf') || f.name.toLowerCase().endsWith('.glb'));

    if (!mainFile) {
      alert("Bé ơi, bé cần chọn file có đuôi .gltf hoặc .glb nhé!");
      return;
    }

    // 2. Create Object URLs for ALL files (resources like .bin, .png associated with the gltf)
    const resources: { [key: string]: string } = {};
    fileArray.forEach(f => {
      resources[f.name] = URL.createObjectURL(f);
    });

    // 3. Set State
    setTempModelUrl(resources[mainFile.name]); // Main URL
    setTempResources(resources); // Resource Map
    setShowNameInput(true);
    setTempTextures({});
    setTempFlipY(false);

    // Alert if user selected .gltf but missed the .bin
    if (mainFile.name.toLowerCase().endsWith('.gltf') && fileArray.length === 1) {
       alert("Lưu ý: Với file .gltf, bé hãy chọn cùng lúc cả file .bin và hình ảnh đi kèm để mô hình hiển thị đúng nhé!");
    }

    event.target.value = '';
  };

  // Single Texture Manual Select
  const handleTextureClick = (type: keyof TextureMaps) => {
    setActiveTextureType(type);
    setTimeout(() => {
        textureInputRef.current?.click();
    }, 50);
  }

  const handleTextureFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeTextureType) return;
    
    const objectUrl = URL.createObjectURL(file);
    setTempTextures(prev => ({
        ...prev,
        [activeTextureType]: objectUrl
    }));
    
    event.target.value = '';
    setActiveTextureType(null);
  };

  // -- AUTO DETECT "MAGIC" UPLOAD --
  const handleMagicUploadClick = () => {
    multiTextureInputRef.current?.click();
  }

  const handleMultiTextureChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newTextures: TextureMaps = { ...tempTextures };
    let detectedList: string[] = [];

    Array.from(files).forEach((file: File) => {
        const lowerName = file.name.toLowerCase();
        const objectUrl = URL.createObjectURL(file);
        
        // --- LOGIC 1: Standard Keywords ---
        if (lowerName.includes('base') || lowerName.includes('color') || lowerName.includes('albedo') || lowerName.includes('diff')) {
            newTextures.map = objectUrl;
            detectedList.push("Màu da (Color)");
        } 
        else if (lowerName.includes('norm') || lowerName.includes('nrm')) {
            newTextures.normalMap = objectUrl;
            detectedList.push("Độ sần (Normal)");
        } 
        else if (lowerName.includes('rough') || lowerName.includes('rgh')) {
            newTextures.roughnessMap = objectUrl;
            detectedList.push("Độ bóng (Roughness)");
            if (lowerName.includes('met') || lowerName.includes('mtl')) {
                newTextures.metalnessMap = objectUrl;
                detectedList.push("Kim loại (Metallic)");
            }
        } 
        else if (lowerName.includes('met') || lowerName.includes('mtl') || lowerName.includes('metal')) {
            newTextures.metalnessMap = objectUrl;
            detectedList.push("Kim loại (Metallic)");
        } 
        else if (lowerName.includes('ao') || lowerName.includes('occ') || lowerName.includes('ambient')) {
            newTextures.aoMap = objectUrl;
            detectedList.push("Đổ bóng (AO)");
        }
        else if (lowerName.includes('emissive') || lowerName.includes('emit') || lowerName.includes('glow')) {
            newTextures.emissiveMap = objectUrl;
            detectedList.push("Phát sáng (Emissive)");
        }
        // Packed Maps (ORM/ARM)
        else if (lowerName.includes('arm') || lowerName.includes('orm') || lowerName.includes('packed')) {
             newTextures.roughnessMap = objectUrl;
             newTextures.metalnessMap = objectUrl;
             newTextures.aoMap = objectUrl;
             detectedList.push("Đa năng (AO/Rough/Metal)");
        }
        
        // --- LOGIC 2: GLTF Embedded Logic (Numbered Files) ---
        else if (lowerName.includes('gltf_embedded') || lowerName.includes('image')) {
            const numberMatch = lowerName.match(/(\d+)/);
            if (numberMatch) {
                const index = parseInt(numberMatch[0]);
                if (index === 0) {
                     newTextures.map = objectUrl;
                     detectedList.push("Màu da (Color - Ảnh 0)");
                }
                else if (index === 1) {
                     newTextures.roughnessMap = objectUrl;
                     newTextures.metalnessMap = objectUrl;
                     detectedList.push("Độ bóng/Kim loại (Ảnh 1)");
                }
                else if (index === 2) {
                     newTextures.normalMap = objectUrl;
                     detectedList.push("Độ sần (Normal - Ảnh 2)");
                }
                else if (index === 3) {
                    newTextures.aoMap = objectUrl;
                    detectedList.push("Đổ bóng (AO - Ảnh 3)");
                }
            }
        }
    });

    if (detectedList.length > 0) {
        setTempTextures(newTextures);
        const unique = Array.from(new Set(detectedList));
        alert(`Đã tự động tìm thấy:\n- ${unique.join('\n- ')}`);
    } else {
        alert("Không nhận diện được tên file. Bé hãy thử chọn từng ô nhé!");
    }

    event.target.value = '';
  };

  // -- GENERATE CONTENT --

  const handleConfirmName = async () => {
    if (!tempModelUrl) return;

    // 1. Prepare Data
    const finalName = customName.trim() || "Mô hình bí ẩn";
    const tempId = `temp-${Date.now()}`;

    const customItem: DiscoveryItem = {
      id: tempId,
      name: finalName,
      icon: '✨',
      modelUrl: tempModelUrl,
      textures: tempTextures, 
      resources: tempResources, // Pass the .bin and other resources
      textureFlipY: tempFlipY, 
      color: 'bg-indigo-400',
      modelType: 'model',
      baseColor: '#818cf8'
    };

    // 2. Immediate UI Feedback
    setSelectedItem(customItem);
    setShowNameInput(false); 
    setMode(AppMode.VIEWER); 
    setLoading(true); 

    // 3. Fetch AI Data
    try {
        const data = await fetchFunFact(finalName);
        setFactData(data);
    } catch (e) {
        console.error(e);
        setFactData({
            name: finalName,
            description: "Chưa tải được thông tin, bé xem mô hình nhé!",
            funFact: "Thế giới 3D thật thú vị!",
            soundText: "..."
        });
    } finally {
        setLoading(false);
    }
  };

  // -- LIBRARY HANDLERS --

  const handleSaveToLibrary = async () => {
    if (!selectedItem || !factData || !selectedItem.modelUrl) return;
    setIsSaving(true);
    try {
      await saveModelToLibrary(selectedItem, factData, selectedItem.modelUrl, selectedItem.textures, selectedItem.resources);
      alert("Đã lưu vào bộ sưu tập!");
      setIsSaving(false);
    } catch (e) {
      console.error(e);
      alert("Không lưu được, bộ nhớ đầy!");
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
    if(confirm("Bé có chắc muốn xóa không?")) {
        await deleteFromLibrary(id);
        loadSavedLibrary();
    }
  }

  // Helper for texture buttons
  const TextureButton = ({ type, label, iconClass }: { type: keyof TextureMaps, label: string, iconClass: string }) => {
    const textureUrl = tempTextures[type];
    const isSet = !!textureUrl;

    return (
        <button 
            onClick={() => handleTextureClick(type)}
            className={`relative flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all h-28 overflow-hidden group ${
                isSet 
                ? 'border-indigo-500 bg-indigo-50' 
                : 'border-slate-200 bg-slate-50 hover:bg-white hover:border-indigo-300'
            }`}
        >
            {isSet ? (
                <>
                    <div className="absolute inset-0 w-full h-full">
                        <img 
                            src={textureUrl} 
                            alt={label} 
                            className="w-full h-full object-cover opacity-80 group-hover:scale-110 transition-transform duration-500" 
                        />
                        <div className="absolute inset-0 bg-black/10"></div>
                    </div>
                    <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full p-0.5 z-10 shadow-sm">
                        <Check className="w-3 h-3"/>
                    </div>
                </>
            ) : (
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 bg-slate-200 ${iconClass}`}>
                    <ImageIcon className="w-5 h-5" />
                </div>
            )}
            <span className={`relative z-10 text-[10px] font-bold text-center leading-tight px-1 py-0.5 rounded ${isSet ? 'bg-white/90 text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {label}
            </span>
        </button>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 relative overflow-hidden font-sans flex flex-col">
      
      {/* Hidden File Inputs */}
      {/* UPDATE: Added 'multiple' to support .gltf + .bin + textures */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleModelFileChange} 
        accept=".glb,.gltf,.bin,.png,.jpg,.jpeg" 
        multiple
        className="hidden" 
      />
      <input 
        type="file" 
        ref={textureInputRef} 
        onChange={handleTextureFileChange} 
        accept="image/png,image/jpeg,image/jpg" 
        className="hidden" 
      />
      <input 
        type="file" 
        ref={multiTextureInputRef} 
        onChange={handleMultiTextureChange} 
        accept="image/png,image/jpeg,image/jpg" 
        multiple
        className="hidden" 
      />

      {/* Background Decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-blue-200 rounded-full blur-3xl opacity-30 z-0 animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] bg-purple-200 rounded-full blur-3xl opacity-30 z-0 animate-pulse" style={{animationDelay: '2s'}}></div>

      {/* Header */}
      <header className="relative z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-white rounded-xl shadow-sm">
            <Rotate3d className="w-8 h-8 text-indigo-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-700 tracking-tight">Kiddo<span className="text-indigo-500">Builder</span></h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 container mx-auto px-4 max-w-lg flex-1 flex flex-col justify-center">
        
        {/* STEP 1: UPLOAD SCREEN (GALLERY MODE) */}
        {mode === AppMode.GALLERY && !showNameInput && (
          <div className="flex flex-col h-full animate-fadeIn pb-20">
            
            {/* Upload Area */}
            <div className="flex flex-col items-center justify-center py-6">
              <div className="text-center mb-4">
                <h2 className="text-3xl font-black text-slate-800 mb-1">Tạo Mô Hình Mới</h2>
                <p className="text-slate-500 text-sm">Chọn file .glb hoặc (.gltf + .bin) nhé</p>
              </div>

              <button
                onClick={handleUploadClick}
                className="group relative w-full h-32 bg-white border-4 border-dashed border-indigo-300 rounded-[24px] hover:bg-indigo-50 hover:border-indigo-500 hover:scale-[1.02] active:scale-95 transition-all duration-300 flex flex-col items-center justify-center shadow-lg shadow-indigo-100/50"
              >
                <div className="w-12 h-12 mb-1 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-500 group-hover:rotate-12 transition-transform duration-500">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-indigo-600 font-bold">Mở file của bé</span>
                <span className="text-[10px] text-slate-400 mt-1">(Hỗ trợ .glb và .gltf)</span>
                <Sparkles className="absolute top-4 right-4 text-yellow-400 w-4 h-4 animate-bounce" />
              </button>
            </div>

            {/* Library List */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 mb-3 px-2">
                <Library className="w-5 h-5 text-indigo-500" />
                <h3 className="text-lg font-bold text-slate-700">Bộ Sưu Tập Của Bé</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pb-4 px-1">
                {savedItems.length === 0 ? (
                  <div className="text-center py-10 opacity-50 border-2 border-dashed border-slate-200 rounded-3xl">
                    <p className="text-sm">Chưa có mô hình nào được lưu.</p>
                  </div>
                ) : (
                  savedItems.map((record) => (
                    <div 
                      key={record.item.id}
                      onClick={() => handleOpenLibraryItem(record)}
                      className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 hover:bg-slate-50 active:scale-[0.98] transition-all relative group"
                    >
                      <div className="w-14 h-14 bg-indigo-50 rounded-xl flex items-center justify-center text-2xl overflow-hidden shrink-0">
                        {record.item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                         <h4 className="font-bold text-slate-800 text-base truncate">{record.factData.name}</h4>
                         <p className="text-xs text-slate-400 truncate">Đã lưu: {new Date((record.item as any).createdAt || Date.now()).toLocaleDateString()}</p>
                      </div>
                      <button 
                         onClick={(e) => handleDeleteItem(e, record.item.id)}
                         className="p-2 bg-red-50 text-red-400 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: NAME & TEXTURE INPUT DIALOG */}
        {showNameInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md relative overflow-hidden flex flex-col max-h-[90vh]">
               <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-400 to-purple-400"></div>
               
               <div className="text-center mb-4 mt-2 shrink-0">
                 <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-2 text-indigo-600">
                    <Wand2 className="w-6 h-6" />
                 </div>
                 <h3 className="text-xl font-bold text-slate-800">Hoàn thiện mô hình</h3>
               </div>

               <div className="space-y-4 overflow-y-auto flex-1 px-1 py-2">
                  <div>
                    <label className="block text-sm font-bold text-slate-500 mb-1 ml-1">1. Tên gọi</label>
                    <input 
                      autoFocus
                      type="text" 
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Ví dụ: Khủng long bạo chúa..."
                      className="w-full px-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 outline-none font-bold text-slate-700"
                    />
                  </div>

                  <div>
                     <div className="flex items-center justify-between mb-2 ml-1">
                        <div className="flex items-center gap-2">
                           <label className="text-sm font-bold text-slate-500">2. Mặc áo cho mô hình</label>
                           <Layers className="w-4 h-4 text-indigo-400" />
                        </div>
                     </div>

                     {/* MAGIC BUTTON */}
                     <button
                        onClick={handleMagicUploadClick}
                        className="w-full mb-3 py-3 px-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-xl text-white font-bold shadow-lg shadow-purple-200 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all"
                     >
                        <Zap className="w-5 h-5 text-yellow-300 fill-yellow-300" />
                        <span>Tự động chọn tất cả ảnh</span>
                     </button>
                     
                     <div className="grid grid-cols-3 gap-2">
                        <TextureButton type="map" label="Màu da (Color)" iconClass="text-pink-500" />
                        <TextureButton type="normalMap" label="Độ sần (Normal)" iconClass="text-blue-500" />
                        <TextureButton type="roughnessMap" label="Độ bóng (Roughness)" iconClass="text-slate-500" />
                        <TextureButton type="metalnessMap" label="Kim loại (Metallic)" iconClass="text-amber-600" />
                        <TextureButton type="aoMap" label="Đổ bóng (AO)" iconClass="text-gray-800" />
                        <TextureButton type="emissiveMap" label="Phát sáng (Glow)" iconClass="text-yellow-400" />
                     </div>
                     
                     {/* FLIP Y TOGGLE */}
                     <div className="mt-4 flex items-center justify-between bg-orange-50 p-3 rounded-xl border border-orange-100">
                         <div className="flex items-center gap-2">
                             <RefreshCw className="w-4 h-4 text-orange-500" />
                             <span className="text-sm font-bold text-orange-700">Màu bị lỗi / sai vị trí?</span>
                         </div>
                         <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="sr-only peer" 
                                checked={tempFlipY}
                                onChange={(e) => setTempFlipY(e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                            <span className="ml-2 text-xs font-medium text-gray-600">Lật ảnh</span>
                        </label>
                     </div>

                     <p className="text-[10px] text-center text-slate-400 mt-2 italic">
                        Mẹo: Bấm nút "Tự động" rồi chọn hết các ảnh trong thư mục
                     </p>
                  </div>
               </div>

               <div className="flex gap-3 mt-4 shrink-0 pt-2 border-t border-slate-100">
                 <button 
                   onClick={handleBack}
                   className="flex-1 py-3 px-4 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                 >
                   Hủy
                 </button>
                 <button 
                   onClick={handleConfirmName}
                   disabled={!customName.trim()}
                   className="flex-1 py-3 px-4 rounded-xl font-bold text-white bg-indigo-500 hover:bg-indigo-600 active:scale-95 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                 >
                   Xong <ArrowRight className="w-5 h-5" />
                 </button>
               </div>
            </div>
          </div>
        )}

        {/* STEP 3: VIEWER MODE */}
        {mode === AppMode.VIEWER && selectedItem && (
          <div className="h-full flex flex-col animate-slideUp pb-6">
            {/* Top Navigation */}
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleBack}
                className="p-3 bg-white rounded-2xl shadow-md text-slate-600 hover:bg-slate-50 active:scale-90 transition-transform z-20"
              >
                <ArrowLeft className="w-6 h-6" />
              </button>
              
              {/* Save Button */}
              <button 
                onClick={handleSaveToLibrary}
                disabled={isSaving}
                className="px-4 py-2 bg-white rounded-full shadow-md text-indigo-500 font-bold border border-indigo-100 flex items-center gap-2 active:scale-95 hover:bg-indigo-50 transition-all z-20"
              >
                {isSaving ? (
                    <span className="text-xs">Đang lưu...</span>
                ) : (
                    <>
                        <Save className="w-4 h-4" />
                        <span className="text-sm">Lưu lại</span>
                    </>
                )}
              </button>
            </div>

            {/* 3D Viewport Area */}
            <div className="flex-1 relative flex items-center justify-center mb-4 perspective-container min-h-[40vh]">
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                <Toy3D item={selectedItem} />
              </div>
            </div>

            {/* Info Card (Gemini Data) */}
            <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.15)] p-6 flex flex-col transition-all duration-500 z-20 border border-slate-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-100 rounded-full blur-3xl opacity-50 -z-10"></div>

              {loading ? (
                <div className="py-8 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-500 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-indigo-400 animate-pulse" />
                    </div>
                  </div>
                  <p className="text-slate-500 font-medium animate-pulse">Đang tìm hiểu về {selectedItem.name}...</p>
                </div>
              ) : factData ? (
                <div className="animate-fadeIn">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-black text-slate-800 leading-tight">{factData.name}</h2>
                      <div className="inline-block bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-sm font-bold mt-2 border border-indigo-100">
                         Âm thanh: "{factData.soundText}"
                      </div>
                    </div>
                    <button 
                      onClick={() => speakText(`${factData.name}. ${factData.description} ${factData.funFact}`)}
                      className={`p-3 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 ${speaking ? 'bg-red-500 text-white shadow-red-200' : 'bg-indigo-500 text-white shadow-indigo-200 hover:bg-indigo-600'}`}
                    >
                      {speaking ? <Volume2 className="w-6 h-6 animate-pulse" /> : <Volume2 className="w-6 h-6" />}
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[25vh] overflow-y-auto no-scrollbar">
                    <p className="text-slate-600 text-lg leading-relaxed font-medium">
                        {factData.description}
                    </p>

                    <div className="bg-gradient-to-r from-yellow-50 to-orange-50 p-4 rounded-2xl flex gap-3 border border-yellow-100 shadow-sm">
                      <Sparkles className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="block text-xs font-bold text-orange-500 uppercase tracking-wide mb-1">Có thể bé chưa biết</span>
                        <p className="text-slate-700 font-medium text-sm">
                          {factData.funFact}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                 <div className="py-8 flex flex-col items-center justify-center text-center text-slate-400">
                    <Info className="w-10 h-10 mb-2 opacity-50"/>
                    <p>Không tải được thông tin rồi :(</p>
                 </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}