import { spawn } from "node:child_process";
import { executeNotebookOnKaggle } from "./kaggle-runner.mjs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");

async function test() {
    console.log("Testing executeNotebookOnKaggle directly...");
    
    const creds = {
        username: process.env.KAGGLE_USERNAME,
        key: process.env.KAGGLE_KEY
    };

    if (!creds.username || !creds.key) {
        console.log("Skipping test: No Kaggle credentials in env (KAGGLE_USERNAME/KAGGLE_KEY)");
        return;
    }

    const cells = [
        {
            id: randomBytes(4).toString("hex"),
            type: "code",
            source: "print('Hello from the Text2LLM Automated Test on Kaggle!')\nprint('This cell ran successfully.')"
        }
    ];

    try {
        const res = await executeNotebookOnKaggle(cells, creds, join(__dirname, "..", ".."));
        console.log("Test passed. Updated cells:", JSON.stringify(res, null, 2));
    } catch (err) {
        console.error("Test failed:", err);
    }
}

test();
