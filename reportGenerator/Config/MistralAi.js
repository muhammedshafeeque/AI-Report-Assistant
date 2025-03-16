import { Mistral } from "@mistralai/mistralai";
import dotenv from 'dotenv';
import { ChatMistralAI } from "@langchain/mistralai";

dotenv.config();

// Check if the API key is available
const apiKey = process.env.MISTRAL_API_KEY;

if (!apiKey) {
  console.error("Error: MISTRAL_API_KEY is not set in the environment variables.");
  console.error("Please add your Mistral API key to the .env file.");
  // You might want to exit the process in a production environment
  // process.exit(1);
}

// Create a LangChain compatible Mistral chat model
const mistralLangChain = new ChatMistralAI({
  apiKey: apiKey || "",
  modelName: "mistral-small-latest",
});

// Simple wrapper for Mistral API
const mistralSimple = {
  invoke: async (prompt) => {
    try {
      const response = await fetch(
        "https://api.mistral.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
          },
          body: JSON.stringify({
            model: "mistral-small-latest",
            messages: [{ role: "user", content: prompt }],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Mistral API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error("Error invoking Mistral:", error);
      throw error;
    }
  }
};

// Export a function to get the API key for direct API calls
export const getMistralApiKey = () => apiKey || "";

// Export both models, with mistralSimple as the default
export { mistralLangChain };
export default mistralSimple;