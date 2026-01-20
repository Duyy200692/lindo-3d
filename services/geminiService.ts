import { GoogleGenAI, Type } from "@google/genai";
import { FunFactData } from "../types";

export const fetchFunFact = async (itemName: string): Promise<FunFactData> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.error("API_KEY is not defined in environment variables.");
    return {
      name: itemName,
      description: "Ứng dụng chưa được cấu hình chìa khóa AI. Bé hãy nhờ ba mẹ kiểm tra nhé!",
      funFact: "Kiến thức là sức mạnh!",
      soundText: "..."
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Explain what a "${itemName}" is for a 5-year-old child in Vietnamese. Be creative, funny, and educational.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "The name of the animal/object in Vietnamese" },
            description: { type: Type.STRING, description: "A short simple description." },
            funFact: { type: Type.STRING, description: 'A surprising or funny fact.' },
            soundText: { type: Type.STRING, description: "The sound it makes." }
          },
          required: ["name", "description", "funFact", "soundText"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as FunFactData;
    }
    throw new Error("No text in response");
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return {
      name: itemName,
      description: "Chú bạn này đang bận đi chơi rồi, bé hãy thử lại sau nhé!",
      funFact: "Bé có biết không? Khám phá luôn mang lại niềm vui!",
      soundText: "..."
    };
  }
};