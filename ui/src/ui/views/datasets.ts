import { html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { icons as iconRegistry } from "../icons.js";
import type { AppViewState } from "../app-view-state.js";

// Helper function that matches the one used in other views
function icon(name: keyof typeof iconRegistry, className = "w-5 h-5") {
  return html`<span class="icon inline-flex items-center justify-center ${className}">${iconRegistry[name]}</span>`;
}

export function renderDatasets(state: AppViewState) {
  const isPendingJob = state.datasetsActiveJob && (state.datasetsActiveJob.status === "pending" || state.datasetsActiveJob.status === "processing");
  const isFinishedJob = state.datasetsActiveJob && (state.datasetsActiveJob.status === "completed" || state.datasetsActiveJob.status === "failed");

  return html`
    <div class="px-6 py-6 pb-24 mx-auto max-w-4xl w-full flex flex-col gap-6">
      <!-- Header -->
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold flex items-center gap-2">
          ${icon("database", "w-6 h-6")}
          Multi-Format Dataset Creator
        </h1>
        <p class="text-zinc-500 text-sm max-w-2xl">
          Clean, deduplicate, and format massive raw datasets directly in the cloud. This advanced computing feature requires a Pro subscription.
        </p>
      </div>

      <!-- Error Banner -->
      ${state.datasetsError
        ? html`
            <div class="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-md flex items-start gap-3">
              ${icon("alertCircle", "w-5 h-5 shrink-0 mt-0.5")}
              <div class="text-sm">${state.datasetsError}</div>
            </div>
          `
        : ""}

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        
        <!-- Left Column: Upload Form -->
        <div class="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h2 class="text-lg font-semibold flex items-center gap-2">
            ${icon("uploadCloud", "w-5 h-5")} Upload Raw Data
          </h2>
          
          <div class="flex flex-col gap-4">
            <!-- Format Selector -->
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-400">Target Output Format</label>
              <select 
                id="dataset-format-select"
                class="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                ?disabled=${isPendingJob}
              >
                <option value="jsonl">JSONL (Chat Completions)</option>
                <option value="parquet">Parquet (Columnar)</option>
                <option value="csv">CSV (Tabular)</option>
              </select>
            </div>

            <!-- File Input Area -->
            <div class="flex flex-col gap-2 relative">
               <label class="text-sm font-medium text-zinc-400">Source File (>1GB supported)</label>
               <input 
                  type="file" 
                  id="dataset-file-input"
                  class="block w-full text-sm text-zinc-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-md file:border-0
                    file:text-sm file:font-semibold
                    file:bg-blue-600 file:text-white
                    hover:file:bg-blue-500 focus:outline-none"
                  ?disabled=${isPendingJob}
                />
            </div>

            <!-- Upload Button -->
            <button
              class=${classMap({
                "w-full py-2.5 rounded-md font-medium text-sm transition-colors mt-2 flex justify-center items-center gap-2": true,
                "bg-blue-600 hover:bg-blue-500 text-white": !isPendingJob,
                "bg-zinc-800 text-zinc-500 cursor-not-allowed": isPendingJob,
              })}
              ?disabled=${isPendingJob}
              @click=${() => {
                const select = document.getElementById("dataset-format-select") as HTMLSelectElement;
                const fileInput = document.getElementById("dataset-file-input") as HTMLInputElement;
                const file = fileInput.files?.[0];
                if (!file) {
                  state.datasetsError = "Please select a file first.";
                  return;
                }
                void state.handleDatasetsUpload(file, select.value);
              }}
            >
              ${state.datasetsLoading && !isPendingJob
                ? html`${icon("loader", "w-4 h-4 animate-spin")} Uploading...`
                : "Secure Upload & Process"}
            </button>
            
            ${state.datasetsLoading && state.datasetsUploadProgress > 0 && !isPendingJob
             ? html`<div class="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mt-1"><div class="bg-blue-500 h-full transition-all duration-300" style="width: ${state.datasetsUploadProgress}%"></div></div>`
             : ""}
          </div>
        </div>

        <!-- Right Column: Status & Output -->
        <div class="flex flex-col gap-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6 h-full">
           <h2 class="text-lg font-semibold flex items-center gap-2">
            ${icon("activity", "w-5 h-5")} Processing Status
          </h2>

          <div class="flex-1 flex flex-col justify-center items-center gap-4 text-center text-zinc-500 py-8">
            ${!state.datasetsActiveJob ? html`
              ${icon("inbox", "w-12 h-12 text-zinc-700")}
              <p class="text-sm">No active tasks. Upload a dataset to begin processing.</p>
            ` : ""}

            ${isPendingJob ? html`
              ${icon("loader", "w-10 h-10 text-blue-500 animate-spin")}
              <div>
                <div class="text-zinc-300 font-medium">Pipeline running in secure sandbox...</div>
                <div class="text-xs mt-1 font-mono">Job ID: ${state.datasetsActiveJob?.id.slice(0, 8)} | Format: ${state.datasetsActiveJob?.output_format.toUpperCase()}</div>
              </div>
            ` : ""}

            ${isFinishedJob ? html`
               ${state.datasetsActiveJob?.status === "completed" 
                  ? html`${icon("checkCircle2", "w-12 h-12 text-green-500")}`
                  : html`${icon("xCircle", "w-12 h-12 text-red-500")}`
               }
               <div>
                  <div class="text-zinc-300 font-medium pb-2">
                     Job ${state.datasetsActiveJob?.status}
                  </div>
                  ${state.datasetsActiveJob?.status === "completed" ? html`
                    <a href="${state.datasetsActiveJob?.output_url || '#'}" 
                       target="_blank"
                       class="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 justify-center">
                       ${icon("download", "w-4 h-4")} Download Result
                    </a>
                  ` : ""}
               </div>
            ` : ""}
          </div>
        </div>
      </div>
      
      <!-- Premium Overlay (optional lock state based on user data in future) -->
      ${!state.hello?.userId ? html`
         <div class="mt-8 bg-gradient-to-r from-amber-500/10 to-amber-600/10 border border-amber-500/20 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
             <div class="flex items-center gap-4">
               <div class="bg-amber-500/20 p-3 rounded-full text-amber-500">
                  ${icon("award", "w-6 h-6")}
               </div>
               <div>
                  <h3 class="text-amber-500 font-bold mb-1">Pro Plan Required</h3>
                  <p class="text-sm text-zinc-400">Dataset processing utilizes heavy isolated compute infrastructure. Upgrade your account to unlock.</p>
               </div>
             </div>
             <a href="#" class="shrink-0 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold px-4 py-2 rounded-md text-sm transition-colors">
               Upgrade to Pro
             </a>
         </div>
      ` : ""}
    </div>
  `;
}
