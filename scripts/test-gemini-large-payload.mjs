import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const apiKey = process.env.PI_API_KEY_GOOGLE || "missing";
const client = new GoogleGenAI({ apiKey });

async function run() {
  console.log("Loading massive system prompt...");
  // Fake a large system prompt
  const systemInstruction = "A".repeat(20000); 
  
  // Fake 20 complex tool schemas
  const tools = [
    {
      functionDeclarations: Array.from({ length: 20 }).map((_, i) => ({
        name: `tool_number_${i}`,
        description: `This is tool ${i} with a very long description `.repeat(10),
        parameters: {
          type: "OBJECT",
          properties: {
            arg1: { type: "STRING", description: "Some arg" },
            arg2: { type: "NUMBER", description: "Another arg" },
          },
          required: ["arg1"],
        },
      })),
    }
  ];

  console.log("Sending request to gemini-2.5-flash...");
  const start = Date.now();
  
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      config: {
        systemInstruction,
        tools,
        // specifically omit thinkingConfig
      }
    });

    const duration = Date.now() - start;
    console.log(`Response received in ${duration}ms`);
    console.log(`Response text: ${response.text}`);
    console.log(`Usage:`, response.usageMetadata);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
