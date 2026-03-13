import { GoogleGenAI } from "@google/genai";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const supportedLanguages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'zh', name: 'Chinese' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'tl', name: 'Tagalog' },
];

export async function translateText(text: string, targetLanguage: string): Promise<string> {
  if (!text || targetLanguage === 'en') return text;

  try {
    const prompt = `Translate the following text to ${targetLanguage}. Maintain the professional and clinical tone suitable for child welfare casework. Do not add any commentary, only provide the translation.
    
    Text: ${text}`;

    const result = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });
    
    const response = await result;
    return response.text.trim();
  } catch (error) {
    console.error("Translation error:", error);
    return text; // Fallback to original text
  }
}
