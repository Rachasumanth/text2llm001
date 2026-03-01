import fs from "node:fs";
import { resolve } from "node:path";
import { TEXT2LLMSchema } from "./src/config/zod-schema.js";

const configPath = resolve("workspace", "text2llm.json");
const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const result = TEXT2LLMSchema.safeParse(data);
if (!result.success) {
  console.log(JSON.stringify(result.error.issues, null, 2));
} else {
  console.log("Validation passed.");
}
