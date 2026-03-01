import fs from 'fs';

const templateJS = `
/* ── Notebook Templates Marketplace ── */
let NB_TEMPLATES = [];
let NB_TEMPLATE_CATEGORIES = ["All"];
let nbTplActiveCategory = "All";

function initTemplatesFeature() {
  const templatesBtn = document.getElementById("nb-templates-btn");
  if (templatesBtn) {
    templatesBtn.addEventListener("click", () => nbOpenTemplatesModal());
  }

  const modal = document.getElementById("nb-templates-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) nbCloseTemplatesModal();
    });
    const closeBtn = document.getElementById("nb-tpl-close");
    if (closeBtn) closeBtn.addEventListener("click", () => nbCloseTemplatesModal());
  }

  const searchInput = document.getElementById("nb-tpl-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => nbRenderTemplateCards());
  }

  document.querySelectorAll(".nb-tpl-tab").forEach((tab) => {
    tab.addEventListener("click", () => nbSwitchTab(tab.dataset.tplTab));
  });

  const communitySearchBtn = document.getElementById("nb-tpl-community-search-btn");
  if (communitySearchBtn) communitySearchBtn.addEventListener("click", () => nbCommunitySearch());
  const communitySearchInput = document.getElementById("nb-tpl-community-search");
  if (communitySearchInput) communitySearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nbCommunitySearch();
  });

  const importBtn = document.getElementById("nb-tpl-import-btn");
  if (importBtn) importBtn.addEventListener("click", () => nbImportFromUrl());
  const importUrlInput = document.getElementById("nb-tpl-import-url");
  if (importUrlInput) importUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nbImportFromUrl();
  });

  const pasteBtn = document.getElementById("nb-tpl-paste-btn");
  if (pasteBtn) pasteBtn.addEventListener("click", () => nbPasteCode());
}

async function nbOpenTemplatesModal() {
  const modal = document.getElementById("nb-templates-modal");
  if (!modal) return;

  if (NB_TEMPLATES.length === 0) {
    try {
      nbSetStatus("Loading templates catalog...");
      const res = await fetch("/data/templates.json");
      if (res.ok) {
        NB_TEMPLATES = await res.json();
        NB_TEMPLATE_CATEGORIES = ["All", ...new Set(NB_TEMPLATES.map((t) => t.category))];
      }
      nbSetStatus("");
    } catch (err) {
      console.error("Failed to load templates.json", err);
      nbSetStatus("Failed to load templates catalog", "error");
    }
  }

  modal.style.display = "flex";
  nbTplActiveCategory = "All";
  const searchInput = document.getElementById("nb-tpl-search");
  if (searchInput) searchInput.value = "";
  nbSwitchTab("builtin");
  nbRenderTemplateCategoryPills();
  nbRenderTemplateCards();
  if (searchInput) setTimeout(() => searchInput.focus(), 100);
}

function nbCloseTemplatesModal() {
  const modal = document.getElementById("nb-templates-modal");
  if (modal) modal.style.display = "none";
}

function nbSwitchTab(tabId) {
  document.querySelectorAll(".nb-tpl-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tplTab === tabId);
  });
  document.querySelectorAll(".nb-tpl-tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === \\\`nb-tpl-tab-\\\${tabId}\\\`);
  });
}

function nbRenderTemplateCategoryPills() {
  const container = document.getElementById("nb-tpl-categories");
  if (!container) return;
  container.innerHTML = "";
  NB_TEMPLATE_CATEGORIES.forEach((cat) => {
    const pill = document.createElement("button");
    pill.className = "nb-tpl-cat" + (cat === nbTplActiveCategory ? " active" : "");
    pill.type = "button";
    pill.textContent = cat;
    pill.addEventListener("click", () => {
      nbTplActiveCategory = cat;
      nbRenderTemplateCategoryPills();
      nbRenderTemplateCards();
    });
    container.appendChild(pill);
  });
}

function nbRenderTemplateCards() {
  const grid = document.getElementById("nb-tpl-grid");
  if (!grid) return;
  const searchInput = document.getElementById("nb-tpl-search");
  const query = (searchInput?.value || "").toLowerCase().trim();

  const filtered = NB_TEMPLATES.filter((tpl) => {
    const catMatch = nbTplActiveCategory === "All" || tpl.category === nbTplActiveCategory;
    if (!catMatch) return false;
    if (!query) return true;
    return (
      tpl.name.toLowerCase().includes(query) ||
      tpl.description.toLowerCase().includes(query) ||
      tpl.source.toLowerCase().includes(query) ||
      tpl.tags.some((t) => t.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    grid.innerHTML = \\\`<div class="nb-tpl-empty">No templates match your search.</div>\\\`;
    return;
  }

  grid.innerHTML = "";
  const toRender = filtered.slice(0, 200);

  toRender.forEach((tpl) => {
    const card = document.createElement("div");
    card.className = "nb-tpl-card";
    card.innerHTML = \\\`
      <div class="nb-tpl-card-top">
        <span class="nb-tpl-card-name">\\\${escapeHtml(tpl.name)}</span>
        <span class="nb-tpl-card-source" data-source="\\\${escapeHtml(tpl.source)}">\\\${escapeHtml(tpl.source)}</span>
      </div>
      <div class="nb-tpl-card-desc">\\\${escapeHtml(tpl.description)}</div>
      <div class="nb-tpl-card-tags">\\\${tpl.tags.map((t) => \\\`<span class="nb-tpl-tag">\\\${escapeHtml(t)}</span>\\\`).join("")}</div>
      <div class="nb-tpl-card-footer">
        <button class="nb-tpl-insert-btn" type="button" data-tpl-id="\\\${escapeHtml(tpl.id)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Insert
        </button>
      </div>
    \\\`;
    const insertBtn = card.querySelector(".nb-tpl-insert-btn");
    if (insertBtn) {
      insertBtn.addEventListener("click", async () => {
        await nbInsertTemplate(tpl);
      });
    }
    grid.appendChild(card);
  });

  if (filtered.length > 200) {
    const msg = document.createElement("div");
    msg.className = "nb-tpl-empty";
    msg.textContent = \\\`Showing 200 of \\\${filtered.length} templates. Use search to find more.\\\`;
    grid.appendChild(msg);
  }
}

async function nbInsertTemplate(tpl) {
  try {
    nbSetStatus(\\\`Loading template: \\\${tpl.name}...\\\`);
    nbCloseTemplatesModal();

    const res = await fetch(tpl.url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    let cellsToInsert = [];
    try {
      const nb = JSON.parse(text);
      if (nb.cells) {
        cellsToInsert = nb.cells.filter(c => c.cell_type === "code" || c.cell_type === "markdown");
      }
    } catch(e) {
      cellsToInsert = [{ cell_type: "code", source: text }];
    }

    if (cellsToInsert.length === 0) throw new Error("No cells found in template.");

    let insertAfterId = nbState.cells.length > 0 ? nbState.cells[nbState.cells.length - 1].id : null;

    for (const cell of cellsToInsert) {
      const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
      const type = cell.cell_type === "code" ? "code" : "markdown";

      const resCell = await fetch("/api/notebook/cells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: getActiveProjectIdOrDefault(),
          type: type,
          source: source,
          afterId: insertAfterId,
        }),
      });
      const data = await readApiResponse(resCell);
      if (data.cell) {
        nbState.cells.push(data.cell);
        insertAfterId = data.cell.id;
      }
    }

    await nbLoadCells();
    nbSetStatus(\\\`✓ Template "\\\${tpl.name}" inserted\\\`, "success");
  } catch (err) {
    nbSetStatus(\\\`⚠ Failed to insert template: \\\${err.message}\\\`, "error");
  }
}

/* ── Community Search (GitHub Code Search API) ── */
async function nbCommunitySearch() {
  const input = document.getElementById("nb-tpl-community-search");
  const btn = document.getElementById("nb-tpl-community-search-btn");
  const grid = document.getElementById("nb-tpl-community-grid");
  if (!input || !grid) return;
  const query = input.value.trim();
  if (!query) return;

  btn && (btn.disabled = true);
  grid.innerHTML = \\\`<div class="nb-tpl-loading">Searching GitHub for "\\\${escapeHtml(query)}"...</div>\\\`;

  try {
    const searchQuery = encodeURIComponent(\\\`\\\${query} language:python extension:py\\\`);
    const res = await fetch(\\\`https://api.github.com/search/code?q=\\\${searchQuery}&per_page=20\\\`, {
      headers: { "Accept": "application/vnd.github.v3.text-match+json" },
    });

    if (res.status === 403) {
      grid.innerHTML = \\\`<div class="nb-tpl-empty">⚠ GitHub API rate limit reached. Please wait and try again.</div>\\\`;
      return;
    }
    if (!res.ok) throw new Error(\\\`GitHub API error: \\\${res.status}\\\`);

    const data = await res.json();
    const items = data.items || [];

    if (items.length === 0) {
      grid.innerHTML = \\\`<div class="nb-tpl-empty">No results found for "\\\${escapeHtml(query)}".</div>\\\`;
      return;
    }

    grid.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "nb-tpl-community-card";
      const textMatch = item.text_matches?.[0]?.fragment || "";
      card.innerHTML = \\\`
        <div class="nb-tpl-community-repo">
          <a href="https://github.com/\\\${escapeHtml(item.repository.full_name)}" target="_blank" rel="noopener">\\\${escapeHtml(item.repository.full_name)}</a>
        </div>
        <div class="nb-tpl-community-path">\\\${escapeHtml(item.name)}</div>
        \\\${textMatch ? \\\`<div class="nb-tpl-community-snippet">\\\${escapeHtml(textMatch)}</div>\\\` : ""}
        <div class="nb-tpl-card-footer">
          <span class="nb-tpl-cells-count">⭐ \\\${item.repository.stargazers_count ?? ""}</span>
          <button class="nb-tpl-insert-btn" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Insert
          </button>
        </div>
      \\\`;
      const insertBtn = card.querySelector(".nb-tpl-insert-btn");
      if (insertBtn) {
        insertBtn.addEventListener("click", async () => {
          await nbImportFromGitHub(item);
        });
      }
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = \\\`<div class="nb-tpl-empty">⚠ \\\${escapeHtml(err.message)}</div>\\\`;
  } finally {
    btn && (btn.disabled = false);
  }
}

async function nbImportFromGitHub(item) {
  try {
    nbSetStatus(\\\`Fetching \\\${item.name} from GitHub...\\\`);
    const rawUrl = item.html_url
      .replace("github.com", "raw.githubusercontent.com")
      .replace("/blob/", "/");
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(\\\`Failed to fetch: \\\${res.status}\\\`);
    const code = await res.text();
    await nbInsertCodeAsCell(code, \\\`GitHub: \\\${item.repository.full_name}/\\\${item.name}\\\`);
  } catch (err) {
    nbSetStatus(\\\`⚠ \\\${err.message}\\\`, "error");
  }
}

/* ── Import from URL ── */
async function nbImportFromUrl() {
  const input = document.getElementById("nb-tpl-import-url");
  const status = document.getElementById("nb-tpl-import-status");
  if (!input) return;
  const url = input.value.trim();
  if (!url) return;

  status && (status.textContent = "Fetching...");

  try {
    let rawUrl = url;
    if (rawUrl.includes("github.com") && rawUrl.includes("/blob/")) {
      rawUrl = rawUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
    }
    if (rawUrl.includes("gist.github.com") && !rawUrl.includes("raw")) {
      rawUrl = rawUrl + "/raw";
    }

    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error(\\\`HTTP \\\${res.status}\\\`);
    const text = await res.text();

    if (url.endsWith(".ipynb") || rawUrl.endsWith(".ipynb")) {
      const nb = JSON.parse(text);
      const cells = (nb.cells || []).filter((c) => c.cell_type === "code" || c.cell_type === "markdown");
      nbCloseTemplatesModal();
      for (const cell of cells) {
        const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
        await nbAddCellWithSource(cell.cell_type === "code" ? "code" : "markdown", source);
      }
      await nbLoadCells();
      nbSetStatus(\\\`✓ Imported \\\${cells.length} cells from notebook\\\`, "success");
    } else {
      nbCloseTemplatesModal();
      await nbInsertCodeAsCell(text, "Imported from URL");
    }
    status && (status.textContent = "✓ Imported successfully!");
  } catch (err) {
    status && (status.textContent = \\\`⚠ \\\${err.message}\\\`);
  }
}

/* ── Paste Code as Cell ── */
async function nbPasteCode() {
  const textarea = document.getElementById("nb-tpl-paste-code");
  if (!textarea || !textarea.value.trim()) return;
  const code = textarea.value;
  nbCloseTemplatesModal();
  await nbInsertCodeAsCell(code, "Pasted code");
  textarea.value = "";
}

async function nbInsertCodeAsCell(code, label) {
  try {
    nbSetStatus(\\\`Inserting \\\${label}...\\\`);
    const res = await fetch("/api/notebook/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: getActiveProjectIdOrDefault(),
        type: "code",
        source: code,
        afterId: nbState.cells.length > 0 ? nbState.cells[nbState.cells.length - 1].id : null,
      }),
    });
    await readApiResponse(res);
    await nbLoadCells();
    nbSetStatus(\\\`✓ \\\${label} inserted\\\`, "success");
  } catch (err) {
    nbSetStatus(\\\`⚠ \\\${err.message}\\\`, "error");
  }
}

async function nbAddCellWithSource(type, source) {
  const res = await fetch("/api/notebook/cells", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: getActiveProjectIdOrDefault(),
      type,
      source,
      afterId: nbState.cells.length > 0 ? nbState.cells[nbState.cells.length - 1].id : null,
    }),
  });
  const data = await readApiResponse(res);
  if (data.cell) nbState.cells.push(data.cell);
}

// Initialize templates on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  initTemplatesFeature();
});
`;

let appJs = fs.readFileSync('public/app.js', 'utf8');

// Fix the triple-escaped backticks for template literals
let jsCode = templateJS
  .replace(/\\\\\\\`/g, '`');

appJs += '\\n' + jsCode;
fs.writeFileSync('public/app.js', appJs, 'utf8');
console.log("SUCCESS: Appended template marketplace JS to app.js");
