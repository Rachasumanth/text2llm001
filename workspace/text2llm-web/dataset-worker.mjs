import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exec, spawn } from 'node:child_process';
import util from 'node:util';
import path from 'node:path';
const execPromise = util.promisify(exec);

// A simple polling worker to pick up dataset jobs and process them
// In a real production environment, use BullMQ / Redis or AWS SQS.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillDir = path.resolve(__dirname, '../skills/data-pipeline');
const workspaceConfig = path.join(__dirname, '../text2llm.json');

// Helper to load Text2LLM config
async function loadConfig() {
  try {
    const data = await fs.readFile(process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

// Helper to save Text2LLM config
async function saveConfig(config) {
  try {
    await fs.writeFile(process.env.TEXT2LLM_CONFIG_PATH || workspaceConfig, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error("[Worker] Failed to save local config:", e);
  }
}

async function pollJobs() {
  const config = await loadConfig();
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || config?.supabase?.url;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || config?.supabase?.service_role_key;

  let job = null;
  let isLocal = false;

  if (supabaseUrl && serviceRole) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/dataset_jobs?status=eq.pending&limit=1`, {
        method: "GET",
        headers: {
          apikey: serviceRole,
          Authorization: `Bearer ${serviceRole}`
        }
      });

      if (response.ok) {
        const jobs = await response.json();
        if (jobs && jobs.length > 0) {
          job = jobs[0];
        }
      }
    } catch (e) {
      console.error("[Worker] Polling error:", e.message);
    }
  } else {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LOCAL EXECUTION FALLBACK
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (config?.dataStudio?.datasets) {
      for (const ds of config.dataStudio.datasets) {
        if (ds.rows && ds.rows.length > 0 && ds.rows[0].status === 'job-queued') {
          job = {
            id: ds.id,
            file_key: null,
            output_format: ds.format || 'jsonl',
            scrape_config: ds.scrapeConfig,
            api_config: ds.apiConfig,
            synth_config: ds.synthConfig,
            autonomous_config: ds.autonomousConfig
          };
          isLocal = true;
          break;
        }
      }
    }
  }

  if (!job) return;

  try {
    // Mark as processing
    await updateJobStatus(job.id, "processing", null, isLocal);
    console.log(`[Worker] Processing job ${job.id}`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // AUTONOMOUS DATASET CREATOR (Premium)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (job.autonomous_config) {
      console.log(`[Worker] Autonomous dataset job detected!`);
      const ac = job.autonomous_config;
      const prompt = (ac.prompt || '').replace(/"/g, '\\"');
      const targetRows = ac.targetRows || 5000;
      const outputFormat = job.output_format || 'jsonl';
      const outputDir = path.join(skillDir, 'output', `autonomous-${job.id}`);

      // The Python script auto-detects API keys from environment variables
      // (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) set by the Infra/Instances page
      let cmdArgs = [
        path.join(skillDir, 'autonomous_dataset.py'),
        '--prompt', prompt,
        '--target-rows', String(targetRows),
        '--output-format', outputFormat,
        '--output-dir', outputDir
      ];

      try {
        await runWithProgress(job.id, 'python', cmdArgs, isLocal);
        await updateJobStatus(job.id, "completed", outputDir, isLocal);
        console.log(`[Worker] Autonomous job ${job.id} completed.`);
      } catch (e) {
        console.error(`[Worker] Autonomous job ${job.id} failed:`, e.message || e);
        await updateJobStatus(job.id, "failed", null, isLocal);
      }
      return;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // LEGACY JOB TYPES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    let command = `python ${skillDir}/run.py --input ${job.file_key} --output-format ${job.output_format}`;
    
    // Dataset Creator: Web Scraping
    if (job.scrape_config) {
      console.log(`[Worker] Detected scraping job with engine: ${job.scrape_config.engine}`);
      const urls = job.scrape_config.seedUrls.join(",");
      command = `python ${skillDir}/scrape.py --engine ${job.scrape_config.engine} --urls "${urls}" --depth ${job.scrape_config.maxDepth} --focus ${job.scrape_config.focusArea} --output-format ${job.output_format}`;
    }
    // Dataset Creator: External API
    else if (job.api_config) {
      console.log(`[Worker] Detected external API job for provider: ${job.api_config.provider}`);
      command = `python ${skillDir}/api_aggregate.py --provider ${job.api_config.provider} --query "${job.api_config.query}" --output-format ${job.output_format}`;
    }
    // Dataset Creator: Synthetic Generation
    else if (job.synth_config) {
      console.log(`[Worker] Detected synthetic generation job for domain: ${job.synth_config.domain}`);
      const count = job.synth_config.recordsPerState || 50;
      const domain = job.synth_config.domain || 'animal-sensor';
      const task = (job.synth_config.taskDescription || '').replace(/"/g, '\\"');
      const sensors = (job.synth_config.sensorInputs || []).join(',');
      command = `python ${skillDir}/generate_training_data.py --domain "${domain}" --task "${task}" --count ${count} --sensors "${sensors}" --output-format ${job.output_format}`;
    }

    try {
      await execPromise(command);
      console.log(`[Worker] Executed: ${command}`);
      await updateJobStatus(job.id, "completed", `https://storage.example.com/outputs/${job.id}.${job.output_format}`, isLocal);
      console.log(`[Worker] Job ${job.id} completed.`);
    } catch (e) {
      console.error(`[Worker] Job ${job.id} failed:`, e);
      await updateJobStatus(job.id, "failed", null, isLocal);
    }

  } catch (err) {
    console.error("[Worker] Error processing job boundary:", err);
  }
}

/**
 * Run a Python script and parse @@PROGRESS@@ lines to update job status in real-time.
 */
function runWithProgress(jobId, cmd, args, isLocal) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split('\n')) {
        if (line.startsWith('@@PROGRESS@@')) {
          try {
            const progress = JSON.parse(line.replace('@@PROGRESS@@', ''));
            updateJobProgress(jobId, progress.phase, progress.detail, isLocal).catch(() => {});
            console.log(`[Worker] Progress: ${progress.phase} — ${progress.detail}`);
          } catch {}
        } else if (line.trim()) {
          console.log(`[Worker] ${line}`);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Process exited with code ${code}: ${stderr.slice(-500)}`));
    });

    child.on('error', reject);
  });
}

async function updateJobStatus(jobId, status, outputUrl = null, isLocal = false) {
  if (isLocal) {
    const config = await loadConfig();
    const ds = config.dataStudio?.datasets?.find(d => d.id === jobId);
    if (ds && ds.rows && ds.rows.length > 0) {
      if (status === 'completed') {
        ds.rows[0].status = 'job-completed';
        ds.rows[0].message = 'Dataset generated successfully.';
        if (outputUrl) ds.rows[0].outputUrl = outputUrl;
      } else if (status === 'failed') {
        ds.rows[0].status = 'job-failed';
        ds.rows[0].message = 'Job failed during execution.';
      } else {
        ds.rows[0].status = status;
      }
      await saveConfig(config);
    }
    return;
  }

  // Supabase Code
  const config = await loadConfig();
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || config?.supabase?.url;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || config?.supabase?.service_role_key;
  if (!supabaseUrl || !serviceRole) return;
  
  const payload = { status };
  if (outputUrl) payload.output_url = outputUrl;

  try {
    await fetch(`${supabaseUrl}/rest/v1/dataset_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[Worker] Failed to update job status to ${status}`, err.message);
  }
}

async function updateJobProgress(jobId, phase, detail, isLocal = false) {
  if (isLocal) {
    const config = await loadConfig();
    const ds = config.dataStudio?.datasets?.find(d => d.id === jobId);
    if (ds && ds.rows && ds.rows.length > 0) {
      ds.rows[0].status = 'job-processing'; // Ensure it changes from 'job-queued'
      ds.rows[0].message = detail || phase;
      await saveConfig(config);
    }
    return;
  }

  // Supabase Code
  const config = await loadConfig();
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || config?.supabase?.url;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || config?.supabase?.service_role_key;
  if (!supabaseUrl || !serviceRole) return;
  
  const payload = { 
    status: "processing",
    progress: JSON.stringify({ phase, detail, updated_at: new Date().toISOString() })
  };
  
  try {
    await fetch(`${supabaseUrl}/rest/v1/dataset_jobs?id=eq.${jobId}`, {
      method: "PATCH",
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[Worker] Failed to update progress to ${phase}`, err.message);
  }
}

function start() {
  console.log("[Worker] Starting dataset processing worker...");
  setInterval(pollJobs, 5000);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}
