
import { GoogleGenAI, Type } from "@google/genai";
import { FunFactData } from "../types";

export const fetchFunFact = async (itemName: string): Promise<FunFactData> => {
  // Sử dụng trực tiếp process.env.API_KEY theo quy định
  if (!process.env.API_KEY) {
    console.error("API_KEY chưa được thiết lập.");
    return {
      name: itemName,
      description: "Ứng dụng chưa có chìa khóa AI, bé hãy nhờ ba mẹ giúp nhé!",
      funFact: "Kiến thức là món quà tuyệt vời nhất!",
      soundText: "..."
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Hãy giải thích "${itemName}" là gì cho một bé 5 tuổi bằng tiếng Việt. Nội dung phải sáng tạo, vui nhộn và dễ hiểu.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            description: { type: Type.STRING },
            funFact: { type: Type.STRING },
            soundText: { type: Type.STRING }
          },
          required: ["name", "description", "funFact", "soundText"]
        }
      }
    });

    // Truy cập trực tiếp thuộc tính .text (không phải hàm)
    if (response.text) {
      return JSON.parse(response.text.trim()) as FunFactData;
    }
    throw new Error("Không nhận được phản hồi từ AI");
  } catch (error: any) {
    console.error("Lỗi Gemini:", error);
    return {
      name: itemName,
      description: "Mô hình của bé thật là đẹp và bí ẩn!",
      funFact: "Mỗi mô hình đều ẩn chứa một câu chuyện riêng.",
      soundText: "..."
    };
  }
};
