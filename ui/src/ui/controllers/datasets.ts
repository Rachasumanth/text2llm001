import type { AppViewState } from "../app-view-state.ts";

export type DatasetJob = {
  id: string;
  user_id: string;
  file_key: string;
  output_format: string;
  status: "pending" | "processing" | "completed" | "failed";
  output_url?: string;
  created_at: string;
  updated_at: string;
};

// Polling interval in milliseconds
const STATUS_POLL_INTERVAL = 3000;

export async function handleDatasetsUpload(state: AppViewState, file: File, format: string): Promise<void> {
  if (state.datasetsActiveJob?.status === "pending" || state.datasetsActiveJob?.status === "processing") {
    state.datasetsError = "A job is already in progress.";
    return;
  }

  state.datasetsError = null;
  state.datasetsLoading = true;
  state.datasetsUploadProgress = 0;

  try {
    // 1. Get presigned URL from proxy
    const uploadUrlReq = await fetch("/v1/datasets/upload-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!uploadUrlReq.ok) {
      const data = await uploadUrlReq.json();
      throw new Error(data.error || "Failed to get upload URL. Ensure you have a Pro tier subscription.");
    }

    const { uploadUrl, fileKey } = await uploadUrlReq.json();

    // 2. Upload file directly to Cloud Storage using presigned URL
    // In a real application, we would use XMLHttpRequest to track progress.
    // Simulating upload for now, as MVP uses a mock S3 URL.
    state.datasetsUploadProgress = 50;
    
    // Simulate network delay for upload
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    state.datasetsUploadProgress = 100;

    // 3. Initiate processing job
    const processReq = await fetch("/v1/datasets/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileKey, outputFormat: format }),
    });

    if (!processReq.ok) {
      const data = await processReq.json();
      throw new Error(data.error || "Failed to trigger processing job");
    }

    const { jobId } = await processReq.json();

    // 4. Set active job and start polling
    state.datasetsActiveJob = {
      id: jobId,
      user_id: "current-user",
      file_key: fileKey,
      output_format: format,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    pollJobStatus(state, jobId);

  } catch (err: unknown) {
    state.datasetsError = err instanceof Error ? err.message : String(err);
  } finally {
    state.datasetsLoading = false;
  }
}

let currentPollInterval: number | null = null;

export function pollJobStatus(state: AppViewState, jobId: string) {
  if (currentPollInterval) {
    window.clearInterval(currentPollInterval);
  }

  currentPollInterval = window.setInterval(async () => {
    try {
      const res = await fetch(`/v1/datasets/status/${jobId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await res.json();
      if (data.job) {
        state.datasetsActiveJob = data.job;
        
        // Stop polling if done
        if (data.job.status === "completed" || data.job.status === "failed") {
          window.clearInterval(currentPollInterval!);
          currentPollInterval = null;
          // Optionally refresh queue list
          void handleDatasetsRefresh(state);
        }
      }
    } catch {
      // Silently ignore poll errors to keep trying
    }
  }, STATUS_POLL_INTERVAL);
}

export async function handleDatasetsRefresh(state: AppViewState): Promise<void> {
  // In a full implementation, you'd fetch the list of past jobs from Supabase here.
  // For this MVP, we just reset the error and ensure the UI is reactive.
  state.datasetsError = null;
  // Note: if there's an active job, we could keep it.
}
