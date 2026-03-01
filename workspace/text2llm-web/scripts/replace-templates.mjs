import fs from 'fs';

let content = fs.readFileSync('public/app.js', 'utf8');

const startMarker = "/* ── Notebook Templates Data ── */";
const endMarker = "/* ── Community Search (GitHub Code Search API) ── */";

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1) {
  const newCode = `/* ── Notebook Templates Data ── */
let NB_TEMPLATES = [];
let NB_TEMPLATE_CATEGORIES = ["All"];

let nbTplActiveCategory = "All";

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

/* ── Tab Switching ── */
function nbSwitchTab(tabId) {
  document.querySelectorAll(".nb-tpl-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tplTab === tabId);
  });
  document.querySelectorAll(".nb-tpl-tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === \`nb-tpl-tab-\${tabId}\`);
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
    grid.innerHTML = \`<div class="nb-tpl-empty">No templates match your search.</div>\`;
    return;
  }

  grid.innerHTML = "";
  // Implement a max of 200 cards to keep DOM fast for 3000+ templates
  const toRender = filtered.slice(0, 200);
  
  toRender.forEach((tpl) => {
    const card = document.createElement("div");
    card.className = "nb-tpl-card";
    card.innerHTML = \`
      <div class="nb-tpl-card-top">
        <span class="nb-tpl-card-name">\${escapeHtml(tpl.name)}</span>
        <span class="nb-tpl-card-source" data-source="\${escapeHtml(tpl.source)}">\${escapeHtml(tpl.source)}</span>
      </div>
      <div class="nb-tpl-card-desc">\${escapeHtml(tpl.description)}</div>
      <div class="nb-tpl-card-tags">\${tpl.tags.map((t) => \`<span class="nb-tpl-tag">\${escapeHtml(t)}</span>\`).join("")}</div>
      <div class="nb-tpl-card-footer">
        <button class="nb-tpl-insert-btn" type="button" data-tpl-id="\${escapeHtml(tpl.id)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Insert
        </button>
      </div>
    \`;
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
    msg.textContent = \`Showing 200 of \${filtered.length} templates. Use search to find more.\`;
    grid.appendChild(msg);
  }
}

async function nbInsertTemplate(tpl) {
  try {
    nbSetStatus(\`Loading template: \${tpl.name}...\`);
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

    // Determine target location (after currently selected or at end)
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
    nbSetStatus(\`✓ Template "\${tpl.name}" inserted\`, "success");
  } catch (err) {
    nbSetStatus(\`⚠ Failed to insert template: \${err.message}\`, "error");
  }
}

`;
  
  content = content.substring(0, startIdx) + newCode + content.substring(endIdx);
  fs.writeFileSync('public/app.js', content, 'utf8');
  console.log("SUCCESS: Replaced the massive Javascript array with dynamic URL fetching.");
} else {
  console.log("ERROR: Could not find markers.", startIdx, endIdx);
}
