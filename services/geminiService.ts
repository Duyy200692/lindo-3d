import { GoogleGenAI, Type } from "@google/genai";
import { FunFactData } from "../types";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const fetchFunFact = async (itemName: string): Promise<FunFactData> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Explain what a "${itemName}" is for a 5-year-old child in Vietnamese. Be creative, funny, and educational.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "The name of the animal/object in Vietnamese (e.g., Chú Khủng Long T-Rex)" },
            description: { type: Type.STRING, description: "A short, simple description (max 2 sentences) suitable for a toddler." },
            funFact: { type: Type.STRING, description: 'A surprising or funny fact ("Did you know?").' },
            soundText: { type: Type.STRING, description: "The sound it makes spelled out (e.g. Roarrr, Beep Beep)." }
          },
          required: ["name", "description", "funFact", "soundText"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as FunFactData;
    }
    throw new Error("No data returned");
  } catch (error) {
    console.error("Gemini API Error:", error);
    // Fallback data if API fails or key is missing
    return {
      name: itemName,
      description: "Ồ! Có vẻ như chú này đang đi ngủ rồi. Bé hãy thử lại sau nhé!",
      funFact: "Bé có biết không? Thế giới này rộng lớn lắm!",
      soundText: "..."
    };
  }
};