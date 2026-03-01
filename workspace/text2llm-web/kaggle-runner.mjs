import { spawn } from "node:child_process";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

// Using synchronous operations where possible to prevent breaking config flows,
// but Kaggle execution is inherently async and long. We will await it.
export async function executeNotebookOnKaggle(cells, credentials, repoRoot) {
  const runId = randomBytes(4).toString("hex");
  const username = credentials.username;
  const kernelTitle = `text2llm-${runId}`;
  const kernelSlug = `${username}/${kernelTitle}`;
  
  console.log(`[kaggle-runner] ═══ Starting Kaggle GPU execution ═══`);
  console.log(`[kaggle-runner] Run ID: ${runId}`);
  console.log(`[kaggle-runner] Username: ${username}`);
  console.log(`[kaggle-runner] Kernel slug: ${kernelSlug}`);
  console.log(`[kaggle-runner] Cells to execute: ${cells.length}`);

  // 1. Prepare directory
  const runDir = join(repoRoot, "workspace", "kaggle-runs", runId);
  if (!existsSync(runDir)) {
    await mkdir(runDir, { recursive: true });
  }
  console.log(`[kaggle-runner] Step 1: Run directory created: ${runDir}`);

  // 2. Generate Python script from cells
  const pythonLines = [];
  pythonLines.push("#!/usr/bin/env python3");
  pythonLines.push("import sys");
  pythonLines.push("print('---TEXT2LLM_EXECUTION_START---')");
  
  for (const cell of cells) {
      if (cell.type === "code") {
          pythonLines.push(`print('---CELL_START_${cell.id}---')`);
          pythonLines.push(`try:`);
          const sourceLines = (cell.source || "").split("\n");
          for (const line of sourceLines) {
              pythonLines.push(`    ${line}`);
          }
          pythonLines.push(`except Exception as e:`);
          pythonLines.push(`    import traceback`);
          pythonLines.push(`    traceback.print_exc()`);
          pythonLines.push(`print('---CELL_END_${cell.id}---')`);
      }
  }
  pythonLines.push("print('---TEXT2LLM_EXECUTION_END---')");
  
  const scriptPath = join(runDir, "script.py");
  await writeFile(scriptPath, pythonLines.join("\n"));
  console.log(`[kaggle-runner] Step 2: Python script written (${pythonLines.length} lines)`);

  // 3. Generate kernel-metadata.json
  const metadata = {
    id: kernelSlug,
    title: kernelTitle,
    code_file: "script.py",
    language: "python",
    kernel_type: "script",
    is_private: true,
    enable_gpu: true,
    enable_internet: true,
    dataset_sources: [],
    competition_sources: [],
    kernel_sources: [],
    model_sources: []
  };
  await writeFile(join(runDir, "kernel-metadata.json"), JSON.stringify(metadata, null, 2));
  console.log(`[kaggle-runner] Step 3: kernel-metadata.json written`);

  // 4. Push to Kaggle
  console.log(`[kaggle-runner] Step 4: Pushing kernel to Kaggle...`);
  const env = { ...process.env, KAGGLE_USERNAME: credentials.username, KAGGLE_KEY: credentials.key };
  
  const pushRes = await runKaggleCmd(["kernels", "push", "-p", runDir], env);
  console.log(`[kaggle-runner] Push result: code=${pushRes.code}, stdout="${pushRes.stdout.trim()}", stderr="${pushRes.stderr.trim()}"`);
  if (pushRes.code !== 0) {
      throw new Error(`Kaggle push failed: ${pushRes.stderr || pushRes.stdout}`);
  }

  // 5. Poll for completion
  console.log(`[kaggle-runner] Step 5: Polling for execution status...`);
  let status = "running";
  let attempts = 0;
  while (status === "running" || status === "queued") {
      if (attempts > 30) {
          throw new Error("Kaggle execution timed out (waited 5 minutes)");
      }
      await new Promise(r => setTimeout(r, 10000)); // poll every 10s
      
      const statRes = await runKaggleCmd(["kernels", "status", kernelSlug], env);
      const out = statRes.stdout.toLowerCase();
      
      if (out.includes("complete")) status = "complete";
      else if (out.includes("error") || out.includes("fail")) status = "error";
      else if (out.includes("cancel")) status = "cancelled";
      else if (out.includes("running")) status = "running";
      else if (out.includes("queue")) status = "queued";
      else status = "unknown";
      
      attempts++;
      console.log(`[kaggle-runner] Poll attempt ${attempts}: status="${status}" (raw: "${out.trim()}")`);
  }

  if (status === "error" || status === "cancelled") {
      throw new Error(`Kaggle execution ended with status: ${status}`);
  }

  // 6. Pull output
  console.log(`[kaggle-runner] Step 6: Pulling output from Kaggle...`);
  const outDir = join(runDir, "output");
  await mkdir(outDir, { recursive: true });
  const pullRes = await runKaggleCmd(["kernels", "output", kernelSlug, "-p", outDir], env);
  console.log(`[kaggle-runner] Pull result: code=${pullRes.code}, stdout length=${pullRes.stdout.length}`);
  if (pullRes.code !== 0) {
      throw new Error(`Failed to pull Kaggle output: ${pullRes.stderr}`);
  }

  // 7. Parse output log
  console.log(`[kaggle-runner] Step 7: Parsing output log...`);
  let logContent = "";
  try {
      logContent = await readFile(join(outDir, "script.log"), "utf-8");
      console.log(`[kaggle-runner] Read script.log (${logContent.length} chars)`);
  } catch(e) {
      try {
         logContent = pullRes.stdout;
         console.log(`[kaggle-runner] Using stdout as log (${logContent.length} chars)`);
      } catch (e2) {}
  }

  const updatedCells = [...cells];
  let currentCellLogs = [];
  let currentCellId = null;
  let capturing = false;
  const logLines = logContent.split("\n");

  for (const line of logLines) {
      if (line.includes("---TEXT2LLM_EXECUTION_START---")) {
          capturing = true;
          continue;
      }
      if (line.includes("---TEXT2LLM_EXECUTION_END---")) {
          capturing = false;
          break;
      }

      const startMatch = line.match(/---CELL_START_(.+)---/);
      if (startMatch) {
          currentCellId = startMatch[1];
          currentCellLogs = [];
          continue;
      }

      const endMatch = line.match(/---CELL_END_(.+)---/);
      if (endMatch) {
          if (currentCellId) {
             const cellIdx = updatedCells.findIndex(c => c.id === currentCellId);
             if (cellIdx !== -1) {
                 const cell = updatedCells[cellIdx];
                 updatedCells[cellIdx] = {
                     ...cell,
                     outputs: [{ type: "stdout", text: currentCellLogs.join("\n") + "\n" }],
                     executionCount: (cell.executionCount || 0) + 1,
                     status: "completed",
                     updatedAt: new Date().toISOString()
                 };
                 console.log(`[kaggle-runner] Cell ${currentCellId} output: ${currentCellLogs.length} lines`);
             }
          }
          currentCellId = null;
          continue;
      }

      if (capturing && currentCellId) {
          currentCellLogs.push(line);
      }
  }

  // Cleanup
  try {
      await rm(runDir, { recursive: true, force: true });
      console.log(`[kaggle-runner] Cleanup complete`);
  } catch(e) {}

  console.log(`[kaggle-runner] ═══ Kaggle GPU execution complete ═══`);
  return updatedCells;
}

function runKaggleCmd(args, env) {
 return new Promise((resolve) => {
   // Use appropriate shell invocation for Windows vs Unix
   const isWindows = process.platform === 'win32';
   const cmd = isWindows ? "kaggle.exe" : "kaggle";
   console.log(`[runKaggleCmd] Executing: ${cmd} ${args.join(" ")}`);
   const child = spawn(cmd, args, { env, shell: true });
   let stdout = "";
   let stderr = "";
   child.stdout.on("data", d => stdout += d.toString());
   child.stderr.on("data", d => stderr += d.toString());
   child.on("close", code => {
      console.log(`[runKaggleCmd] Finished with code ${code}`);
      if (code !== 0) {
          console.error(`[runKaggleCmd] stderr:`, stderr);
      }
      resolve({ code, stdout, stderr });
   });
 });
}
