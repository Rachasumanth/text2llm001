/* ── Notebook Workspace State & API ── */

window.nbState = {
  cells: [],
  loading: false,
  initialized: false
};

function getActiveProjectIdOrDefault() {
  return typeof currentProjectId !== 'undefined' && currentProjectId ? currentProjectId : 'default';
}

function nbSetStatus(msg, type="info") {
  const el = document.getElementById("nb-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "nb-status-msg " + (type === "error" ? "error" : type === "success" ? "success" : "");
}

async function nbLoadCells() {
  try {
    nbState.loading = true;
    nbSetStatus("Loading notebook...");
    const res = await fetch(`/api/notebook/cells?projectId=${getActiveProjectIdOrDefault()}`);
    const data = await res.json();
    if (data.ok) {
      nbState.cells = data.cells || [];
    }
    nbRenderCells();
    nbSetStatus("Notebook ready.");
    nbState.loading = false;
  } catch (err) {
    nbSetStatus("Failed to load notebook", "error");
    nbState.loading = false;
  }
}

async function nbDeleteCell(cellId) {
  if (!confirm("Delete this cell?")) return;
  try {
    await fetch(`/api/notebook/cells/${cellId}?projectId=${getActiveProjectIdOrDefault()}`, { method: "DELETE" });
    await nbLoadCells();
  } catch(err) {
    nbSetStatus("Failed to delete cell", "error");
  }
}

async function nbUpdateCellSource(cellId, newSource) {
  try {
    const cell = nbState.cells.find(c => c.id === cellId);
    if (cell) cell.source = newSource;
  } catch(err) {}
}

async function nbSaveCell(cellId) {
  const cell = nbState.cells.find(c => c.id === cellId);
  if (!cell) return;
  try {
    await fetch(`/api/notebook/cells/${cellId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault(), source: cell.source })
    });
  } catch (err) {}
}

function nbRenderCells() {
  const container = document.getElementById("nb-cells");
  if (!container) return;
  container.innerHTML = "";

  nbState.cells.forEach(cell => {
    const el = document.createElement("div");
    el.className = `nb-cell nb-cell-${cell.type}`;
    el.dataset.cellId = cell.id;

    const header = document.createElement("div");
    header.className = "nb-cell-header";
    header.innerHTML = `
      <div class="nb-cell-controls">
        ${cell.type === "code" ? `<button class="nb-cell-run-btn" title="Run cell">&#9654;</button>` : ""}
        <button class="nb-cell-delete-btn" title="Delete cell">&times;</button>
        <button class="nb-cell-save-btn" title="Save cell">&#128190;</button>
      </div>
      <div class="nb-cell-type">${cell.type === "code" ? "Code" : "Markdown"}</div>
    `;
    el.appendChild(header);

    const inputWrap = document.createElement("div");
    inputWrap.className = "nb-cell-input";
    
    if (cell.type === "code") {
      const ta = document.createElement("textarea");
      ta.value = cell.source;
      ta.placeholder = "Enter your code here...";
      ta.addEventListener("input", (e) => nbUpdateCellSource(cell.id, e.target.value));
      inputWrap.appendChild(ta);
    } else {
      const preview = document.createElement("div");
      preview.className = "nb-cell-markdown-preview";
      preview.innerHTML = window.marked ? window.marked.parse(cell.source || "Double click to edit") : (cell.source || "");
      inputWrap.appendChild(preview);
    }
    el.appendChild(inputWrap);

    if (cell.type === "code" && cell.outputs && cell.outputs.length > 0) {
      const outWrap = document.createElement("div");
      outWrap.className = "nb-cell-output";
      cell.outputs.forEach(out => {
        const pre = document.createElement("pre");
        pre.textContent = out.text || out.data?.text || (out.data && out.data["text/plain"]) || JSON.stringify(out, null, 2);
        if (out.error || out.ename) {
          pre.classList.add("nb-cell-error");
          pre.textContent = `Error: ${out.ename}: ${out.evalue}\n${(out.traceback || []).join('\n')}`;
        }
        outWrap.appendChild(pre);
      });
      el.appendChild(outWrap);
    }
    
    container.appendChild(el);
  });

  addCellControlListeners();
}

function addCellControlListeners() {
  document.querySelectorAll(".nb-cell-run-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const cellId = e.target.closest(".nb-cell").dataset.cellId;
      await nbRunCell(cellId);
    });
  });
  document.querySelectorAll(".nb-cell-delete-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const cellId = e.target.closest(".nb-cell").dataset.cellId;
      await nbDeleteCell(cellId);
    });
  });
  document.querySelectorAll(".nb-cell-save-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const cellId = e.target.closest(".nb-cell").dataset.cellId;
      await nbSaveCell(cellId);
      nbSetStatus("✓ Saved", "success");
    });
  });
}

async function nbRunCell(cellId) {
  try {
    nbSetStatus("Running cell (may take a few minutes on Kaggle)...", "info");
    await nbSaveCell(cellId);
    const res = await fetch(`/api/notebook/cells/${cellId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault() })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await nbLoadCells();
    nbSetStatus("✓ Cell finished", "success");
  } catch (err) {
    nbSetStatus("Run failed: " + err.message, "error");
  }
}

async function nbRunAll() {
  try {
    nbSetStatus("Running all cells (may take a few minutes on Kaggle)...", "info");
    for (const cell of nbState.cells) {
      if (cell.type === "code") {
        await nbSaveCell(cell.id);
      }
    }
    const res = await fetch(`/api/notebook/run-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault() })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await nbLoadCells();
    nbSetStatus("✓ All cells finished", "success");
  } catch (err) {
    nbSetStatus("Run-all failed: " + err.message, "error");
  }
}

async function nbClearOutputs() {
  try {
    nbSetStatus("Clearing outputs...", "info");
    const res = await fetch(`/api/notebook/clear-outputs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault() })
    });
    await res.json();
    await nbLoadCells();
    nbSetStatus("Outputs cleared");
  } catch (err) {
    nbSetStatus("Failed to clear outputs", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const runAllBtn = document.getElementById("nb-run-all-btn");
  if (runAllBtn) runAllBtn.addEventListener("click", nbRunAll);

  const clearBtn = document.getElementById("nb-clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", nbClearOutputs);

  const addCodeBtn = document.getElementById("nb-add-code-btn");
  if (addCodeBtn) addCodeBtn.addEventListener("click", () => {
    if (typeof nbAddCellWithSource === "function") {
      nbAddCellWithSource("code", "");
    }
  });

  const addMdBtn = document.getElementById("nb-add-md-btn");
  if (addMdBtn) addMdBtn.addEventListener("click", () => {
    if (typeof nbAddCellWithSource === "function") {
      nbAddCellWithSource("markdown", "");
    }
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#experiments") {
      nbLoadCells();
    }
  });
  if (window.location.hash === "#experiments") {
    nbLoadCells();
  }
});
