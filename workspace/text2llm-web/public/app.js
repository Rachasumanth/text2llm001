/* ── Text2LLM Virtual Lab — Chat Interface ── */

/* ── State ── */
let currentSessionId = null;
let isStreaming = false;
let abortController = null;
let chatHistory = []; // conversation context: [{role, content}]
let currentProjectId = getStoredProjectId(); // active project for user.md memory (null = no memory)
let chatThreads = [];
let activeThreadId = null;
let cachedProjects = [];
const CHAT_THREADS_STORAGE_KEY = "text2llm.chatThreads.v1";
const CHAT_LIST_COLLAPSED_STORAGE_KEY = "text2llm.chatListCollapsed.v1";
const ACTIVE_PROJECT_STORAGE_KEY = "text2llm.activeProject.v1";
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;
let lastThinkingStatus = "Thinking...";
let manualMissionStage = null;
let runtimeSocketState = "idle";
let markedConfigured = false;

function getStoredProjectId() {
  try {
    return normalizeProjectId(localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function normalizeProjectId(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function projectIdsEqual(left, right) {
  return normalizeProjectId(left) === normalizeProjectId(right);
}

function setCurrentProjectId(projectId) {
  currentProjectId = normalizeProjectId(projectId);
  manualMissionStage = null;
  try {
    if (currentProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, currentProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }
  } catch (_) {
    // ignore localStorage write errors
  }
  refreshStatusBar();
}

function getActiveProjectIdOrDefault() {
  return normalizeProjectId(currentProjectId) || "default";
}

function withActiveProjectQuery(url) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}projectId=${encodeURIComponent(getActiveProjectIdOrDefault())}`;
}

function renderCurrentProjectLabel(projectName = null) {
  const projectLabel = document.getElementById("current-project-name");
  if (!projectLabel) {
    return;
  }

  projectLabel.innerHTML = "";
  const resolvedName = String(projectName || "").trim();

  const nameSpan = document.createElement("span");
  nameSpan.textContent = resolvedName || "No project selected";
  projectLabel.appendChild(nameSpan);

  if (resolvedName && currentProjectId) {
    const newChatBtn = document.createElement("button");
    newChatBtn.className = "project-new-chat-btn";
    newChatBtn.title = "Start new chat in project";
    newChatBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`;
    newChatBtn.onclick = async (ev) => {
      ev.stopPropagation();
      if (confirm("Start a new chat session for this project?")) {
        await createAndActivateNewThread({
          projectId: currentProjectId,
          title: `${resolvedName} chat`,
          messages: [
            { role: "assistant", content: `Started a new session for project **${resolvedName}**.` },
          ],
        });
      }
    };
    projectLabel.appendChild(newChatBtn);
    projectLabel.style.color = "var(--primary)";
    projectLabel.style.fontWeight = "bold";
    return;
  }

  projectLabel.style.color = "var(--text-secondary)";
  projectLabel.style.fontWeight = "500";
}

function syncCurrentProjectLabelFromCache() {
  if (!currentProjectId) {
    renderCurrentProjectLabel(null);
    refreshLabTelemetry();
    return;
  }

  const project = cachedProjects.find((item) => projectIdsEqual(item?.id, currentProjectId));
  renderCurrentProjectLabel(project?.name || null);
  refreshLabTelemetry();
}

function isDiagnosticLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  return (
    trimmed.startsWith("[tools]") ||
    trimmed.startsWith("[agent/embedded]") ||
    trimmed.startsWith("[diagnostic]") ||
    trimmed.startsWith("🦞 text2llm") ||
    trimmed.includes("google tool schema snapshot") ||
    trimmed.includes("allowlist contains unknown entries") ||
    trimmed.startsWith("At line:") ||
    trimmed.startsWith("CategoryInfo") ||
    trimmed.startsWith("FullyQualifiedErrorId") ||
    trimmed.startsWith("+") ||
    trimmed.startsWith("~") ||
    /\b(Command exited with code|CannotConvertArgumentNoMessage|ParameterBindingException)\b/i.test(trimmed)
  );
}

function sanitizeAgentText(text) {
  const withoutAnsi = String(text || "").replace(ANSI_ESCAPE_REGEX, "");
  const lines = withoutAnsi.split(/\r?\n/);
  const kept = lines.filter((line) => !isDiagnosticLine(line));
  return kept.join("\n");
}

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();

  let parsed = null;
  if (contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok && response.status !== 304) {
    const errorMessage =
      parsed?.error ||
      parsed?.details ||
      `Request failed (${response.status})`;
    const error = new Error(errorMessage);
    error.status = response.status;
    error.rawBody = rawText;
    throw error;
  }

  if (!parsed) {
    const error = new Error("Server returned non-JSON response");
    error.status = response.status;
    error.rawBody = rawText;
    throw error;
  }

  return parsed;
}

/* ── DOM Elements ── */
const ideaForm = document.getElementById("idea-form");
const ideaInput = document.getElementById("idea-input");
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");
const sidebarCloseBtn = document.getElementById("sidebar-close-btn");
const sidebarOpenBtn = document.getElementById("sidebar-open-btn");
const suggestionChips = document.querySelectorAll(".suggestion-chip");
const mainContent = document.querySelector(".main-content");
const chatMessages = document.getElementById("chat-messages");
const welcomeSection = document.getElementById("welcome-section");
const sendBtn = document.getElementById("send-btn");
const stopBtn = document.getElementById("stop-btn");
const homeNewChatBtn = document.getElementById("home-new-chat-btn");
const chatThreadList = document.getElementById("chat-thread-list");
const homeChatLayout = document.querySelector(".home-chat-layout");
const chatListToggleBtn = document.getElementById("chat-list-toggle-btn");
const chatListCloseBtn = document.getElementById("chat-list-close-btn");
const labActiveProjectEl = document.getElementById("lab-active-project");
const labActiveModelEl = document.getElementById("lab-active-model");
const labThreadCountEl = document.getElementById("lab-thread-count");
const labLastSyncEl = document.getElementById("lab-last-sync");
const missionProjectNameEl = document.getElementById("mission-project-name");
const missionStageNameEl = document.getElementById("mission-stage-name");
const missionModelNameEl = document.getElementById("mission-model-name");
const missionThreadCountEl = document.getElementById("mission-thread-count");
const runQueuePrimaryEl = document.getElementById("run-queue-primary");
const runQueueNextActionEl = document.getElementById("run-queue-next-action");
const runQueueCheckpointEl = document.getElementById("run-queue-checkpoint");
const bottomInsightTabButtons = document.querySelectorAll(".bottom-insight-tab");
const bottomInsightPanes = document.querySelectorAll(".bottom-insight-pane");
const pipelineStageButtons = document.querySelectorAll(".pipeline-stage");
const statusNotificationBtn = document.getElementById("status-notification-btn");
const statusNotificationCountEl = document.getElementById("status-notification-count");
const statusBranchEl = document.getElementById("status-git-branch");
const statusPathEl = document.getElementById("status-file-path");
const statusActiveViewEl = document.getElementById("status-active-view");
const statusDocModeEl = document.getElementById("status-doc-mode");
const statusEncodingEl = document.getElementById("status-encoding");
const statusEolEl = document.getElementById("status-eol");
const statusModelEl = document.getElementById("status-model");
const statusRuntimeEl = document.getElementById("status-runtime");
const statusStreamEl = document.getElementById("status-stream");
const statusProjectEl = document.getElementById("status-project");
const statusStageEl = document.getElementById("status-stage");
const statusThreadCountEl = document.getElementById("status-thread-count");
const statusPrimaryActionBtn = document.getElementById("status-primary-action-btn");
const statusPrimaryActionLabelEl = document.getElementById("status-primary-action-label");
const statusRuntimeItemBtn = document.getElementById("status-runtime-item");
const statusFilePathItemBtn = document.getElementById("status-file-path-item");
const mobileToolButtons = document.querySelectorAll(".mobile-tool-btn[data-view], .mobile-tools-sheet-item[data-view]");
const mobileToolsMainButtons = document.querySelectorAll(".mobile-tool-btn[data-view]");
const mobileToolsMoreBtn = document.getElementById("mobile-tools-more-btn");
const mobileToolsSheet = document.getElementById("mobile-tools-sheet");
const mobileToolsBackdrop = document.getElementById("mobile-tools-backdrop");
const COMPACT_LAYOUT_MAX_WIDTH = 1023;

function isCompactLayout() {
  return window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH;
}

const STATUS_VIEW_META = {
  home: {
    label: "Mission Control",
    path: "workspace/projects/mission.md",
    mode: "Markdown",
  },
  clui: {
    label: "Runtime",
    path: "workspace/runtime/console.log",
    mode: "Log",
  },
  notebook: {
    label: "Experiments",
    path: "workspace/notebooks/lab.ipynb",
    mode: "Notebook",
  },
  "dataset-creator": {
    label: "Dataset Creator",
    path: "workspace/data/dataset.csv",
    mode: "Data",
  },
  "data-studio": {
    label: "Data Studio",
    path: "workspace/data/datasets.json",
    mode: "Data",
  },
  projects: {
    label: "Project Vault",
    path: "workspace/projects.json",
    mode: "JSON",
  },
  instances: {
    label: "Infrastructure",
    path: "workspace/infra/instances.json",
    mode: "JSON",
  },
  store: {
    label: "Model Library",
    path: "workspace/store/catalog.md",
    mode: "Markdown",
  },
  settings: {
    label: "Settings",
    path: "workspace/text2llm.json",
    mode: "JSON",
  },
};

function getActiveViewKey() {
  const active = document.querySelector(".nav-item[data-view].active");
  return active?.getAttribute("data-view") || "home";
}

function getActiveModelName() {
  let activeModel = "Auto";
  try {
    activeModel = localStorage.getItem("text2llm.web.proxy.model") || "Auto";
  } catch (_) {
    activeModel = "Auto";
  }
  return activeModel;
}

function getScopedThreadsForStatus() {
  return chatThreads.filter((thread) => projectIdsEqual(thread.projectId, currentProjectId));
}

function getCurrentProjectDisplayName() {
  if (!currentProjectId) {
    return "No project";
  }
  return cachedProjects.find((item) => projectIdsEqual(item?.id, currentProjectId))?.name || String(currentProjectId);
}

function getInferredStageForStatus(scopedThreads) {
  const inferredStage = currentProjectId ? inferMissionStageFromThreads(scopedThreads) : "Define";
  return normalizeMissionStageLabel(currentProjectId ? (manualMissionStage || inferredStage) : "Define");
}

function getRuntimeLabel(viewKey) {
  if (runtimeSocketState === "connected") return "Runtime: Online";
  if (runtimeSocketState === "connecting") return "Runtime: Connecting";
  if (runtimeSocketState === "disconnected") return "Runtime: Offline";
  if (viewKey === "clui") return "Runtime: Starting";
  return "Runtime: Offline";
}

function openViewFromStatusBar(viewKey) {
  const nav = document.querySelector(`.nav-item[data-view="${viewKey}"]`);
  if (nav) {
    nav.click();
  }
}

function closeMobileToolsSheet() {
  if (mobileToolsSheet) {
    mobileToolsSheet.classList.remove("open");
    mobileToolsSheet.setAttribute("aria-hidden", "true");
  }
  if (mobileToolsBackdrop) {
    mobileToolsBackdrop.hidden = true;
  }
}

function setMobileToolsActive(viewKey) {
  if (!mobileToolsMainButtons || mobileToolsMainButtons.length === 0) {
    return;
  }
  mobileToolsMainButtons.forEach((button) => {
    const active = button.getAttribute("data-view") === viewKey;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function initMobileToolDock() {
  if (!mobileToolButtons || mobileToolButtons.length === 0) {
    return;
  }

  mobileToolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const viewKey = button.getAttribute("data-view");
      if (!viewKey) {
        return;
      }
      openViewFromStatusBar(viewKey);
      closeMobileToolsSheet();
    });
  });

  if (mobileToolsMoreBtn) {
    mobileToolsMoreBtn.addEventListener("click", () => {
      if (!mobileToolsSheet) {
        return;
      }
      const opening = !mobileToolsSheet.classList.contains("open");
      mobileToolsSheet.classList.toggle("open", opening);
      mobileToolsSheet.setAttribute("aria-hidden", opening ? "false" : "true");
      if (mobileToolsBackdrop) {
        mobileToolsBackdrop.hidden = !opening;
      }
    });
  }

  if (mobileToolsBackdrop) {
    mobileToolsBackdrop.addEventListener("click", closeMobileToolsSheet);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMobileToolsSheet();
    }
  });

  setMobileToolsActive(getActiveViewKey());
}

function buildStatusNotifications({ hasProject, scopedThreads, activeModel }) {
  const notices = [];
  if (!hasProject) {
    notices.push("Select a project to start a run.");
  }
  if (runtimeSocketState === "disconnected") {
    notices.push("Runtime is offline. Open Runtime to reconnect.");
  }
  if (hasProject && scopedThreads.length === 0) {
    notices.push("No runs yet in this project.");
  }
  if (hasProject && activeModel === "Auto") {
    notices.push("Model is Auto. Choose a specific model for stable output.");
  }
  return notices;
}

function initStatusBarActions() {
  if (statusNotificationBtn) {
    statusNotificationBtn.addEventListener("click", () => {
      const raw = statusNotificationBtn.dataset.messages || "";
      const messages = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (messages.length === 0) {
        window.alert("Workspace status: all clear.");
        return;
      }

      window.alert(`Status alerts:\n\n- ${messages.join("\n- ")}`);
      if (!currentProjectId) {
        openViewFromStatusBar("projects");
      } else if (runtimeSocketState === "disconnected") {
        openViewFromStatusBar("clui");
      }
    });
  }

  if (statusRuntimeItemBtn) {
    statusRuntimeItemBtn.addEventListener("click", () => {
      openViewFromStatusBar("clui");
    });
  }

  if (statusPrimaryActionBtn) {
    statusPrimaryActionBtn.addEventListener("click", async () => {
      if (isStreaming) {
        if (abortController) {
          abortController.abort();
        }
        if (currentSessionId) {
          try {
            await fetch("/api/chat/stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: currentSessionId }),
            });
          } catch (_) {
            // best effort
          }
        }
        setStreamingState(false);
        return;
      }

      if (!ideaInput) {
        return;
      }

      const prompt = ideaInput.value.trim();
      if (prompt) {
        ideaInput.value = "";
        ideaInput.style.height = "";
        sendMessage(prompt);
        return;
      }

      const scopedThreads = getScopedThreadsForStatus();
      const stage = getInferredStageForStatus(scopedThreads);
      const promptByStage = {
        Define: "Help me define objective, constraints, and success metrics for this project.",
        Data: "Help me design a data quality and preparation plan for this project.",
        Train: "Help me design the next training run with safe budget and checkpoint strategy.",
        Evaluate: "Help me create evaluation gates before I deploy this model.",
        Deploy: "Help me prepare a staged deployment and rollback checklist.",
      };
      ideaInput.value = promptByStage[stage] || promptByStage.Define;
      ideaInput.dispatchEvent(new Event("input"));
      ideaInput.focus();
    });
  }
}

function refreshStatusBar(explicitViewKey = null) {
  const viewKey = explicitViewKey || getActiveViewKey();
  const meta = STATUS_VIEW_META[viewKey] || STATUS_VIEW_META.home;
  const scopedThreads = getScopedThreadsForStatus();
  const activeModel = getActiveModelName();
  const projectName = getCurrentProjectDisplayName();
  const stage = getInferredStageForStatus(scopedThreads);
  const hasProject = Boolean(currentProjectId);
  const runtimeLabel = getRuntimeLabel(viewKey);
  const streamLabel = isStreaming ? "Agent: Running" : "Agent: Ready";
  const notifications = buildStatusNotifications({ hasProject, scopedThreads, activeModel });

  if (statusBranchEl) {
    statusBranchEl.textContent = hasProject ? `project/${String(currentProjectId).slice(0, 12)}` : "workspace";
  }
  if (statusPathEl) statusPathEl.textContent = meta.path;
  if (statusActiveViewEl) statusActiveViewEl.textContent = meta.label;
  if (statusDocModeEl) statusDocModeEl.textContent = meta.mode;
  if (statusEncodingEl) statusEncodingEl.textContent = "UTF-8";
  if (statusEolEl) statusEolEl.textContent = "LF";

  if (statusModelEl) statusModelEl.textContent = `Model: ${activeModel}`;

  if (statusRuntimeEl) {
    statusRuntimeEl.textContent = runtimeLabel;
  }
  if (statusStreamEl) {
    statusStreamEl.textContent = streamLabel;
  }
  if (statusProjectEl) {
    statusProjectEl.textContent = projectName;
    statusProjectEl.title = projectName;
  }
  if (statusStageEl) {
    statusStageEl.textContent = `Stage: ${stage}`;
  }
  if (statusThreadCountEl) {
    const count = scopedThreads.length;
    statusThreadCountEl.textContent = `${count} run${count === 1 ? "" : "s"}`;
  }
  if (statusPrimaryActionLabelEl) {
    statusPrimaryActionLabelEl.textContent = isStreaming ? "Stop" : "Run";
  }

  if (statusNotificationCountEl) statusNotificationCountEl.textContent = String(notifications.length);
  if (statusNotificationBtn) {
    statusNotificationBtn.title = notifications.length > 0 ? `${notifications.length} notification(s)` : "No notifications";
    statusNotificationBtn.dataset.messages = notifications.join("\n");
  }

  setMobileToolsActive(viewKey);
}

function normalizeMissionStageLabel(stage) {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "data") return "Data";
  if (value === "train") return "Train";
  if (value === "evaluate" || value === "eval") return "Evaluate";
  if (value === "deploy") return "Deploy";
  return "Define";
}

function inferMissionStageFromThreads(scopedThreads) {
  const combined = scopedThreads
    .flatMap((thread) => (Array.isArray(thread.messages) ? thread.messages : []))
    .map((msg) => String(msg?.content || "").toLowerCase())
    .join(" ");

  if (!combined.trim()) return "Define";
  if (/\b(deploy|serving|production|endpoint|inference api)\b/.test(combined)) return "Deploy";
  if (/\b(evaluate|evaluation|benchmark|metric|accuracy|f1)\b/.test(combined)) return "Evaluate";
  if (/\b(train|finetune|epoch|gpu|lora)\b/.test(combined)) return "Train";
  if (/\b(dataset|clean|chunk|label|split|data quality)\b/.test(combined)) return "Data";
  return "Define";
}

function setPipelineStage(stage) {
  const nextStage = normalizeMissionStageLabel(stage);
  pipelineStageButtons.forEach((button) => {
    const buttonStage = normalizeMissionStageLabel(button.getAttribute("data-stage") || "");
    button.classList.toggle("active", buttonStage === nextStage);
  });
}

function stageNextAction(stage, hasProject) {
  if (!hasProject) {
    return "Select or create a project, then define mission objectives and constraints.";
  }
  switch (normalizeMissionStageLabel(stage)) {
    case "Data":
      return "Finalize dataset cleaning rules, tagging strategy, and train/validation split.";
    case "Train":
      return "Queue the next training run with budget and checkpoint policy.";
    case "Evaluate":
      return "Run benchmark suite and validate acceptance metrics before release.";
    case "Deploy":
      return "Promote the best model version and enable rollout guardrails.";
    default:
      return "Write a crisp project objective and measurable success criteria.";
  }
}

function refreshLabTelemetry() {
  const scopedThreads = chatThreads.filter((thread) => projectIdsEqual(thread.projectId, currentProjectId));
  const projectName = currentProjectId
    ? (cachedProjects.find((item) => projectIdsEqual(item?.id, currentProjectId))?.name || currentProjectId)
    : "No project selected";
  let activeModel = "Auto";
  try {
    activeModel = localStorage.getItem("text2llm.web.proxy.model") || "Auto";
  } catch (_) {
    activeModel = "Auto";
  }

  if (labActiveProjectEl) {
    labActiveProjectEl.textContent = String(projectName || "No project selected");
  }
  if (labActiveModelEl) {
    labActiveModelEl.textContent = String(activeModel || "Auto");
  }
  if (labThreadCountEl) {
    labThreadCountEl.textContent = String(scopedThreads.length || 0);
  }
  if (labLastSyncEl) {
    labLastSyncEl.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (missionProjectNameEl) {
    missionProjectNameEl.textContent = String(projectName || "No project selected");
  }
  if (missionModelNameEl) {
    missionModelNameEl.textContent = String(activeModel || "Auto");
  }
  if (missionThreadCountEl) {
    missionThreadCountEl.textContent = String(scopedThreads.length || 0);
  }

  const inferredStage = currentProjectId ? inferMissionStageFromThreads(scopedThreads) : "Define";
  const resolvedStage = normalizeMissionStageLabel(currentProjectId ? (manualMissionStage || inferredStage) : "Define");
  if (missionStageNameEl) {
    missionStageNameEl.textContent = resolvedStage;
  }
  setPipelineStage(resolvedStage);

  const hasProject = Boolean(currentProjectId);
  const nextAction = stageNextAction(resolvedStage, hasProject);
  const latestThread = [...scopedThreads]
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())[0];

  if (runQueuePrimaryEl) {
    runQueuePrimaryEl.textContent = latestThread?.title ? `Session: ${latestThread.title}` : "No active run";
  }
  if (runQueueNextActionEl) {
    runQueueNextActionEl.textContent = nextAction;
  }
  if (runQueueCheckpointEl) {
    runQueueCheckpointEl.textContent = latestThread?.updatedAt
      ? new Date(latestThread.updatedAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })
      : "--";
  }

  refreshStatusBar();
}

function setChatListCollapsed(collapsed) {
  if (!homeChatLayout || !chatListToggleBtn) {
    return;
  }

  homeChatLayout.classList.toggle("chat-list-collapsed", Boolean(collapsed));
  chatListToggleBtn.textContent = collapsed ? "Chats" : "Close";
  chatListToggleBtn.title = collapsed ? "Open chats" : "Close chats";
  chatListToggleBtn.setAttribute("aria-label", collapsed ? "Open chats" : "Close chats");
  chatListToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");

  try {
    localStorage.setItem(CHAT_LIST_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch (_) {
    // ignore localStorage write errors
  }
}

function initChatListToggle() {
  if (!homeChatLayout || !chatListToggleBtn) {
    return;
  }

  let collapsed = isCompactLayout() ? true : window.innerWidth >= 1024;
  try {
    const storedValue = localStorage.getItem(CHAT_LIST_COLLAPSED_STORAGE_KEY);
    if (isCompactLayout() && (storedValue === "1" || storedValue === "0")) {
      collapsed = storedValue === "1";
    }
  } catch (_) {
    collapsed = isCompactLayout() ? true : window.innerWidth >= 1024;
  }

  setChatListCollapsed(collapsed);

  chatListToggleBtn.addEventListener("click", () => {
    const nextCollapsed = !homeChatLayout.classList.contains("chat-list-collapsed");
    setChatListCollapsed(nextCollapsed);
  });

  if (chatListCloseBtn) {
    chatListCloseBtn.addEventListener("click", () => {
      setChatListCollapsed(true);
    });
  }
}

function initMissionPipelineActions() {
  if (!pipelineStageButtons || pipelineStageButtons.length === 0) {
    return;
  }
  pipelineStageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const stage = normalizeMissionStageLabel(button.getAttribute("data-stage") || "Define");
      manualMissionStage = stage;
      setPipelineStage(stage);
      if (missionStageNameEl) {
        missionStageNameEl.textContent = stage;
      }
      if (runQueueNextActionEl) {
        runQueueNextActionEl.textContent = stageNextAction(stage, Boolean(currentProjectId));
      }
      if (ideaInput && !isStreaming) {
        const promptByStage = {
          Define: "Help me define objective, constraints, and success metrics for this project.",
          Data: "Help me design a data quality and preparation plan for this project.",
          Train: "Help me design the next training run with safe budget and checkpoint strategy.",
          Evaluate: "Help me create evaluation gates before I deploy this model.",
          Deploy: "Help me prepare a staged deployment and rollback checklist.",
        };
        ideaInput.value = promptByStage[stage] || promptByStage.Define;
        ideaInput.dispatchEvent(new Event("input"));
        ideaInput.focus();
      }
    });
  });
}

function initBottomInsightTabs() {
  if (!bottomInsightTabButtons || bottomInsightTabButtons.length === 0) {
    return;
  }

  bottomInsightTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-target");
      if (!targetId) {
        return;
      }

      bottomInsightTabButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", selected ? "true" : "false");
      });

      bottomInsightPanes.forEach((pane) => {
        const selected = pane.id === targetId;
        pane.classList.toggle("active", selected);
        pane.setAttribute("aria-hidden", selected ? "false" : "true");
      });
    });
  });
}

function nowIso() {
  return new Date().toISOString();
}

function createThreadTitleFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return "New chat";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 48);
}

function createChatThread(options = {}) {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = nowIso();
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const inferredTitle = options.title || createThreadTitleFromText(messages.find((msg) => msg.role === "user")?.content || "");
  return {
    id,
    title: inferredTitle || "New chat",
    createdAt,
    updatedAt: createdAt,
    sessionId: options.sessionId || null,
    projectId: normalizeProjectId(options.projectId),
    messages,
  };
}

function saveChatThreads() {
  try {
    const serialized = JSON.stringify({
      activeThreadId,
      threads: chatThreads,
    });
    localStorage.setItem(CHAT_THREADS_STORAGE_KEY, serialized);
  } catch (_) {
    // ignore localStorage write errors
  }
}

function loadChatThreads() {
  try {
    const raw = localStorage.getItem(CHAT_THREADS_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.threads)) {
      return;
    }
    chatThreads = parsed.threads
      .filter((thread) => thread && typeof thread === "object")
      .map((thread) => ({
        id: String(thread.id || ""),
        title: String(thread.title || "New chat"),
        createdAt: String(thread.createdAt || nowIso()),
        updatedAt: String(thread.updatedAt || thread.createdAt || nowIso()),
        sessionId: thread.sessionId ? String(thread.sessionId) : null,
        projectId: normalizeProjectId(thread.projectId),
        messages: Array.isArray(thread.messages)
          ? thread.messages
              .filter((msg) => msg && typeof msg === "object")
              .map((msg) => ({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: String(msg.content || ""),
              }))
          : [],
      }))
      .filter((thread) => thread.id);
    if (typeof parsed.activeThreadId === "string") {
      activeThreadId = parsed.activeThreadId;
    }
  } catch (_) {
    // ignore malformed localStorage
  }
}

function getActiveThread() {
  return chatThreads.find((thread) => thread.id === activeThreadId) || null;
}

function ensureActiveThread() {
  const projectThreads = chatThreads.filter((thread) => projectIdsEqual(thread.projectId, currentProjectId));

  if (projectThreads.length === 0) {
    const firstThread = createChatThread({ projectId: currentProjectId });
    chatThreads.push(firstThread);
    saveChatThreads();
    return firstThread;
  }

  const existingActive = getActiveThread();
  if (existingActive && projectIdsEqual(existingActive.projectId, currentProjectId)) {
    return existingActive;
  }

  return projectThreads[0];
}

function renderThreadList() {
  if (!chatThreadList) {
    return;
  }
  const sorted = [...chatThreads]
    .filter((thread) => projectIdsEqual(thread.projectId, currentProjectId))
    .sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );

  if (!sorted.length) {
    chatThreadList.innerHTML = `<span class="chat-thread-empty">No chats yet</span>`;
    refreshLabTelemetry();
    return;
  }

  chatThreadList.innerHTML = "";

  sorted.forEach((thread) => {
    const item = document.createElement("div");
    item.className = `chat-thread-item ${thread.id === activeThreadId ? "active" : ""}`;

    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "chat-thread-title";
    titleBtn.title = thread.title || "New chat";
    titleBtn.textContent = thread.title || "New chat";
    titleBtn.addEventListener("click", () => {
      activateThread(thread.id);
    });

    const actions = document.createElement("div");
    actions.className = "chat-thread-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "chat-thread-action-btn";
    renameBtn.title = "Rename chat";
    renameBtn.setAttribute("aria-label", "Rename chat");
    renameBtn.innerHTML = "✎";
    renameBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await renameThread(thread.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "chat-thread-action-btn delete";
    deleteBtn.title = "Delete chat";
    deleteBtn.setAttribute("aria-label", "Delete chat");
    deleteBtn.innerHTML = "×";
    deleteBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteThread(thread.id);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(titleBtn);
    item.appendChild(actions);
    chatThreadList.appendChild(item);
  });
  refreshLabTelemetry();
}

async function renameThread(threadId) {
  const thread = chatThreads.find((entry) => entry.id === threadId);
  if (!thread) {
    return;
  }

  const nextTitle = window.prompt("Rename chat", thread.title || "New chat");
  if (nextTitle === null) {
    return;
  }

  const trimmed = nextTitle.trim();
  if (!trimmed) {
    return;
  }

  thread.title = trimmed.slice(0, 80);
  thread.updatedAt = nowIso();
  saveChatThreads();
  renderThreadList();
}

async function deleteThread(threadId) {
  const thread = chatThreads.find((entry) => entry.id === threadId);
  if (!thread) {
    return;
  }

  const label = thread.title || "this chat";
  if (!window.confirm(`Delete chat \"${label}\"?`)) {
    return;
  }

  const deletingActive = thread.id === activeThreadId;
  if (deletingActive) {
    await stopActiveStreamIfNeeded();
  }

  chatThreads = chatThreads.filter((entry) => entry.id !== threadId);
  const projectThreads = chatThreads.filter((thread) => projectIdsEqual(thread.projectId, currentProjectId));

  if (projectThreads.length === 0) {
    const fallback = createChatThread({ projectId: currentProjectId ?? null });
    chatThreads.push(fallback);
    activeThreadId = fallback.id;
    chatHistory = [];
    currentSessionId = null;
  }

  if (deletingActive || !projectThreads.some((entry) => entry.id === activeThreadId)) {
    const nextThread = projectThreads[0];
    activeThreadId = nextThread.id;
    chatHistory = [...nextThread.messages];
    currentSessionId = nextThread.sessionId || null;
    renderCurrentThreadMessages();
    syncViewForCurrentThread();
  }

  saveChatThreads();
  renderThreadList();
}

function renderCurrentThreadMessages() {
  if (!chatMessages) {
    return;
  }
  chatMessages.innerHTML = "";
  for (const msg of chatHistory) {
    const role = msg.role === "assistant" ? "bot" : "user";
    addMessage(role, msg.content || "");
  }
}

function syncViewForCurrentThread() {
  if (chatHistory.length > 0) {
    switchToChatMode();
  } else {
    switchToWelcomeMode();
  }
}

function syncThreadFromRuntime(updateTitle = false) {
  const thread = getActiveThread();
  if (!thread) {
    return;
  }

  thread.messages = chatHistory.map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : "user",
    content: String(msg.content || ""),
  }));
  thread.sessionId = currentSessionId || null;
  thread.projectId = currentProjectId ? String(currentProjectId) : null;
  thread.updatedAt = nowIso();

  if (updateTitle) {
    const firstUserMsg = thread.messages.find((msg) => msg.role === "user");
    if (firstUserMsg) {
      thread.title = createThreadTitleFromText(firstUserMsg.content);
    }
  }

  saveChatThreads();
  renderThreadList();
}

async function stopActiveStreamIfNeeded() {
  if (!isStreaming) {
    return;
  }

  if (abortController) {
    abortController.abort();
  }

  if (currentSessionId) {
    try {
      await fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
    } catch (_) {
      // ignore stop errors
    }
  }
  setStreamingState(false);
}

async function activateThread(threadId) {
  if (!threadId || threadId === activeThreadId) {
    return;
  }

  await stopActiveStreamIfNeeded();

  const thread = chatThreads.find((item) => item.id === threadId);
  if (!thread) {
    return;
  }
  if (!projectIdsEqual(thread.projectId, currentProjectId)) {
    return;
  }

  activeThreadId = thread.id;
  chatHistory = [...thread.messages];
  currentSessionId = thread.sessionId || null;

  renderCurrentThreadMessages();
  syncViewForCurrentThread();
  saveChatThreads();
  renderThreadList();
}

async function createAndActivateNewThread(options = {}) {
  await stopActiveStreamIfNeeded();

  const nextProjectId = normalizeProjectId(options.projectId ?? currentProjectId);

  const thread = createChatThread({
    title: options.title,
    projectId: nextProjectId,
    messages: Array.isArray(options.messages) ? options.messages : [],
    sessionId: null,
  });

  chatThreads.unshift(thread);
  activeThreadId = thread.id;
  chatHistory = [...thread.messages];
  currentSessionId = null;
  setCurrentProjectId(nextProjectId);

  renderCurrentThreadMessages();
  syncViewForCurrentThread();
  saveChatThreads();
  renderThreadList();
  refreshLabTelemetry();

  if (ideaInput) {
    ideaInput.value = "";
    ideaInput.focus();
  }
}

function initializeChatThreads() {
  setCurrentProjectId(currentProjectId);
  loadChatThreads();
  const thread = ensureActiveThread();
  activeThreadId = thread.id;
  chatHistory = [...thread.messages];
  currentSessionId = thread.sessionId || null;
  renderCurrentThreadMessages();
  syncViewForCurrentThread();
  syncCurrentProjectLabelFromCache();
  renderThreadList();
  refreshLabTelemetry();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeChatThreads);
} else {
  initializeChatThreads();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChatListToggle);
} else {
  initChatListToggle();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    refreshLabTelemetry();
    initMissionPipelineActions();
    initBottomInsightTabs();
    initStatusBarActions();
    initMobileToolDock();
    setInterval(refreshLabTelemetry, 30000);
  });
} else {
  refreshLabTelemetry();
  initMissionPipelineActions();
  initBottomInsightTabs();
  initStatusBarActions();
  initMobileToolDock();
  setInterval(refreshLabTelemetry, 30000);
}

/* ── Sidebar ── */
function toggleSidebar() {
  if (!sidebar) {
    return;
  }

  if (isCompactLayout()) {
    sidebar.classList.toggle("open");
    sidebar.classList.remove("closed");
    document.body.classList.remove("sidebar-closed");
    return;
  }

  sidebar.classList.toggle("closed");
  document.body.classList.toggle("sidebar-closed");
}

if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", toggleSidebar);
if (sidebarOpenBtn) sidebarOpenBtn.addEventListener("click", toggleSidebar);

// Mobile menu toggle
if (menuToggle) {
  menuToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    sidebar.classList.toggle("open");
  });
}

// Close sidebar when clicking outside on mobile
document.addEventListener("click", (e) => {
  if (isCompactLayout() &&
      sidebar.classList.contains("open") &&
      !sidebar.contains(e.target) &&
      e.target !== menuToggle) {
    sidebar.classList.remove("open");
  }
});

window.addEventListener("resize", () => {
  if (!sidebar) {
    return;
  }

  if (isCompactLayout()) {
    sidebar.classList.remove("closed");
    document.body.classList.remove("sidebar-closed");
    closeMobileToolsSheet();
  } else {
    sidebar.classList.remove("open");
    closeMobileToolsSheet();
  }
});

/* ── Chat Functions ── */

function switchToChatMode() {
  if (welcomeSection) welcomeSection.style.display = "none";
  if (chatMessages) chatMessages.style.display = "flex";
}

function switchToWelcomeMode() {
  if (welcomeSection) welcomeSection.style.display = "";
  if (chatMessages) {
    chatMessages.style.display = "none";
  }
}

function addMessage(role, content) {
  const msg = document.createElement("div");
  msg.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "U" : "T";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (role === "user") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatMessages.appendChild(msg);
  scrollToBottom();
  return bubble;
}

const TOOL_ICONS = {
  read: "📄", write: "✏️", edit: "✏️", create: "📝",
  exec: "⚡", bash: "⚡", shell: "⚡",
  search: "🔍", grep: "🔍", find: "🔍",
  list: "📂", ls: "📂",
  ask: "💬", chat: "💬",
  web: "🌐", fetch: "🌐", curl: "🌐",
  think: "🧠", plan: "🧠",
  default: "⚙️"
};

function getToolIcon(toolName) {
  if (!toolName) return TOOL_ICONS.default;
  const key = toolName.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(TOOL_ICONS)) {
    if (key.includes(k)) return v;
  }
  return TOOL_ICONS.default;
}

function getToolLabel(toolName, meta) {
  const name = toolName || "action";
  if (meta) {
    // Show short path: last 2 segments
    const parts = meta.replace(/\\/g, "/").split("/");
    const short = parts.length > 2 ? parts.slice(-2).join("/") : meta;
    return `${name} ${short}`;
  }
  return name;
}

function addThinkingIndicator() {
  const msg = document.createElement("div");
  msg.className = "message bot";
  msg.id = "thinking-msg";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "T";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble thinking";
  bubble.innerHTML = `
    <div class="thinking-status">
      <div class="thinking-dots"><span></span><span></span><span></span></div>
      Connecting...
    </div>
    <div class="thinking-actions"></div>
  `;

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatMessages.appendChild(msg);

  scrollToBottom();
}

function updateThinkingIndicator(statusText) {
  const statusEl = document.querySelector("#thinking-msg .thinking-status");
  if (!statusEl) return;
  const next = sanitizeAgentText(statusText || "") || lastThinkingStatus || "Working...";
  lastThinkingStatus = next;
  // Keep the dots + text
  const dots = statusEl.querySelector(".thinking-dots");
  if (dots) {
    // Preserve dots, update text after them
    statusEl.childNodes.forEach(n => { if (n.nodeType === 3) n.remove(); });
    statusEl.appendChild(document.createTextNode(" " + next));
  } else {
    statusEl.textContent = next;
  }
}

function ensureActionContainer() {
  let container = document.getElementById("action-stream-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "action-stream-container";
    container.className = "action-stream-container";

    const header = document.createElement("div");
    header.className = "action-stream-header";
    header.innerHTML = `
      <div class="action-stream-title">
        <span class="action-stream-spinner">⟳</span>
        <span>Agent executing task</span>
      </div>
      <button class="action-stream-toggle">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
    `;
    
    const body = document.createElement("ol");
    body.className = "action-stream-body";

    header.querySelector(".action-stream-toggle").addEventListener("click", () => {
      container.classList.toggle("collapsed");
    });

    container.appendChild(header);
    container.appendChild(body);
    chatMessages.appendChild(container);
  }
  return container.querySelector(".action-stream-body");
}

function deactivatePreviousSteps(bodyContainer) {
  const activeSteps = bodyContainer.querySelectorAll(".action-step.active");
  activeSteps.forEach(step => {
    step.classList.remove("active");
  });
}

function syncWorkspacesWithAgent(tool) {
  if (!tool) return;
  const t = String(tool).toLowerCase();
  
  // Terminal tools
  if (t === "bash" || t === "powershell" || t === "python_script" || t === "run_command" || t === "send_command_input") {
    // Add a subtle indicator or just write to terminal in background
    if (window.terminal) {
      window.terminal.write(`\r\n\x1b[35m[Agent Action]\x1b[0m Executing ${tool}...\r\n`);
    }
  }
  // Notebook tools
  else if (t.includes("notebook") || t.includes("cell") || t.includes("jupyter") || t.includes("multi_replace_file_content") || t.includes("write_to_file") || t.includes("replace_file_content")) {
    // Sync data in background without forcing a tab switch
    try { if (typeof nbLoadCells === "function") nbLoadCells(); } catch (e) {}
  }
  // Dataset tools
  else if (t.includes("dataset") || t.includes("data_studio") || t.includes("clean") || t.includes("chunk")) {
    // Sync data in background without forcing a tab switch
    try { if (typeof refreshDataStudioWorkspace === "function") refreshDataStudioWorkspace(); } catch (e) {}
    try { if (typeof refreshDatasetCreatorWorkspace === "function") refreshDatasetCreatorWorkspace(); } catch (e) {}
  }
}

function handleThinkingEvent(data) {
  const body = ensureActionContainer();

  if (data.phase === "start" && data.tool) {
    syncWorkspacesWithAgent(data.tool);
    deactivatePreviousSteps(body);
    const row = document.createElement("li");
    row.className = "action-step active running";
    row.dataset.tool = data.tool;
    row.innerHTML = `
      <div class="action-step-content">
        <span class="action-label">Running ${getToolLabel(data.tool, data.meta)}</span>
        <span class="action-spinner">⟳</span>
      </div>
    `;
    body.appendChild(row);
    scrollToBottom();
  }

  if (data.phase === "end" && data.tool) {
    const rows = body.querySelectorAll(`.action-step.running[data-tool="${data.tool}"]`);
    const row = rows[rows.length - 1];
    if (row) {
      row.classList.remove("running");
      row.classList.add("done");
      const spinner = row.querySelector(".action-spinner");
      if (spinner) spinner.textContent = "✓";
      const label = row.querySelector(".action-label");
      if (label && label.textContent.startsWith("Running ")) {
        label.textContent = label.textContent.replace("Running ", "Finished ");
      }
    }
  }

  if (data.phase === "info" && data.text) {
    updateThinkingIndicator(data.text);
  }
}

function handleProgressEvent(data) {
  const body = ensureActionContainer();
  const stepId = String(data.id || "").trim();
  const labelText = sanitizeAgentText(data.label || data.detail || stepId || "Working");
  const detailText = sanitizeAgentText(data.detail || "");
  const label = detailText ? `${labelText} — ${detailText}` : labelText;
  const state = String(data.state || "running").toLowerCase();

  if (!stepId) {
    if (label) updateThinkingIndicator(label);
    return;
  }

  let row = body.querySelector(`.action-step[data-progress-id="${stepId}"]`);
  if (!row) {
    deactivatePreviousSteps(body);
    row = document.createElement("li");
    row.className = "action-step active running";
    row.dataset.progressId = stepId;
    row.innerHTML = `
      <div class="action-step-content">
        <span class="action-label"></span>
        <span class="action-spinner">⟳</span>
      </div>
    `;
    body.appendChild(row);
  }

  const labelEl = row.querySelector(".action-label");
  if (labelEl) labelEl.textContent = label || stepId;

  const spinner = row.querySelector(".action-spinner");
  row.classList.remove("running", "done", "error");
  
  if (state === "done") {
    row.classList.add("done");
    if (spinner) spinner.textContent = "✓";
  } else if (state === "error") {
    row.classList.add("error");
    if (spinner) spinner.textContent = "!";
  } else {
    row.classList.add("running");
    if (spinner) spinner.textContent = "⟳";
  }

  scrollToBottom();
}

function finalizeActionContainer() {
  const container = document.getElementById("action-stream-container");
  if (container) {
    container.removeAttribute("id");
    container.classList.add("action-stream-finalized", "collapsed");
    const title = container.querySelector(".action-stream-title span:last-child");
    if (title) title.textContent = "Agent completed runtime tasks";
    const headerSpinner = container.querySelector(".action-stream-spinner");
    if (headerSpinner) headerSpinner.textContent = "✓";
    deactivatePreviousSteps(container.querySelector(".action-stream-body"));
  }
}

function removeThinkingIndicator() {
  lastThinkingStatus = "Connecting...";
  const el = document.getElementById("thinking-msg");
  if (el) el.remove();
}

function scrollToBottom() {
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function configureMarked() {
  if (markedConfigured || typeof marked === "undefined" || !marked.use) return;
  marked.use({
    renderer: {
      code(arg1, arg2) {
        let text, lang;
        if (typeof arg1 === 'object' && arg1 !== null) {
          text = arg1.text || "";
          lang = arg1.lang || "";
        } else {
          text = arg1 || "";
          lang = arg2 || "";
        }
        const validLang = (lang || 'plaintext').toLowerCase();
        const escapedCode = escapeHtml(text);
        const encodedCode = encodeURIComponent(text).replace(/'/g, "%27");
        return `
          <div class="code-canvas">
            <div class="code-canvas-header">
              <span class="code-lang">${validLang}</span>
              <button class="copy-code-btn" type="button" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodedCode}')); this.innerHTML='&check; Copied'; setTimeout(() => this.innerHTML='<svg viewBox=\\'0 0 24 24\\' width=\\'14\\' height=\\'14\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' fill=\\'none\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><rect x=\\'9\\' y=\\'9\\' width=\\'13\\' height=\\'13\\' rx=\\'2\\' ry=\\'2\\'></rect><path d=\\'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\\'></path></svg> Copy', 2000)">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                Copy
              </button>
            </div>
            <pre><code class="language-${validLang}">${escapedCode}</code></pre>
          </div>
        `;
      }
    }
  });
  markedConfigured = true;
}

function renderMarkdown(text) {
  let processed = text;
  const openCount = (processed.match(/<think>/g) || []).length;
  const closedCount = (processed.match(/<\/think>/g) || []).length;
  if (openCount > closedCount) {
    processed += "\n</think>";
  }

  configureMarked();

  if (typeof marked !== "undefined" && marked.parse) {
    try {
      return marked.parse(processed, { breaks: true, gfm: true });
    } catch (_) {
      return escapeHtml(processed);
    }
  }
  return escapeHtml(processed).replace(/\n/g, "<br>");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderChatErrorHTML(data) {
  const title = sanitizeAgentText(data?.title || "Request failed");
  const message = sanitizeAgentText(data?.message || "An error occurred");
  const hints = Array.isArray(data?.hints) ? data.hints.map((item) => sanitizeAgentText(item)).filter(Boolean) : [];

  let html = `<div class="error-message"><div><strong>⚠ ${escapeHtml(title)}</strong></div>`;
  html += `<div>${escapeHtml(message).replace(/\n/g, "<br>")}</div>`;

  if (hints.length > 0) {
    html += "<ul class=\"error-hints\">";
    for (const hint of hints) {
      html += `<li>${escapeHtml(hint)}</li>`;
    }
    html += "</ul>";
  }

  html += "</div>";
  return html;
}

function setStreamingState(streaming) {
  isStreaming = streaming;
  if (sendBtn) sendBtn.style.display = streaming ? "none" : "flex";
  if (stopBtn) stopBtn.style.display = streaming ? "flex" : "none";
  if (ideaInput) ideaInput.disabled = streaming;
  refreshStatusBar();
}

/* ── Finetune Monitor Panel ── */
function appendFinetuneMonitor(parentBubble, jobId, kernelUrl) {
  const panel = document.createElement("div");
  panel.className = "finetune-monitor";
  panel.innerHTML = `
    <div class="ft-header">
      <span class="ft-icon">🔬</span>
      <span class="ft-title">Finetune Job: <code>${escapeHtml(jobId)}</code></span>
      <span class="ft-status ft-status-running">Running</span>
    </div>
    <div class="ft-progress">
      <div class="ft-progress-bar"><div class="ft-progress-fill" style="width: 5%"></div></div>
      <span class="ft-progress-text">Queued for GPU...</span>
    </div>
    <div class="ft-logs-container">
      <details>
        <summary>Live Logs</summary>
        <pre class="ft-logs"></pre>
      </details>
    </div>
    <div class="ft-actions">
      ${kernelUrl ? `<a href="${escapeHtml(kernelUrl)}" target="_blank" class="ft-link">View on Kaggle ↗</a>` : ""}
      <button class="ft-retry-btn" style="display:none">Retry</button>
    </div>
    <div class="ft-result" style="display:none"></div>
  `;
  parentBubble.appendChild(panel);

  // Inject styles if not already added
  if (!document.getElementById("ft-monitor-styles")) {
    const style = document.createElement("style");
    style.id = "ft-monitor-styles";
    style.textContent = `
      .finetune-monitor { margin-top: 12px; border: 1px solid #30363d; border-radius: 8px; padding: 12px; background: #0d1117; }
      .ft-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .ft-icon { font-size: 18px; }
      .ft-title { font-weight: 600; font-size: 13px; color: #c9d1d9; }
      .ft-title code { background: #161b22; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
      .ft-status { font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
      .ft-status-running { background: #1f6feb33; color: #58a6ff; }
      .ft-status-completed { background: #23863533; color: #3fb950; }
      .ft-status-failed { background: #da363433; color: #f85149; }
      .ft-progress { margin-bottom: 8px; }
      .ft-progress-bar { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; }
      .ft-progress-fill { height: 100%; background: linear-gradient(90deg, #1f6feb, #58a6ff); border-radius: 3px; transition: width 0.5s ease; }
      .ft-progress-text { font-size: 11px; color: #8b949e; margin-top: 4px; display: block; }
      .ft-logs-container { margin-bottom: 8px; }
      .ft-logs-container summary { font-size: 12px; color: #8b949e; cursor: pointer; }
      .ft-logs { max-height: 200px; overflow-y: auto; font-size: 11px; color: #8b949e; background: #161b22; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; }
      .ft-actions { display: flex; gap: 8px; align-items: center; }
      .ft-link { font-size: 12px; color: #58a6ff; text-decoration: none; }
      .ft-link:hover { text-decoration: underline; }
      .ft-retry-btn { font-size: 12px; padding: 4px 12px; border: 1px solid #f85149; background: transparent; color: #f85149; border-radius: 4px; cursor: pointer; }
      .ft-retry-btn:hover { background: #f8514922; }
      .ft-result { margin-top: 8px; padding: 8px; background: #23863515; border: 1px solid #23863533; border-radius: 6px; }
      .ft-result h4 { margin: 0 0 6px; color: #3fb950; font-size: 13px; }
      .ft-result .ft-metric { font-size: 12px; color: #c9d1d9; margin: 2px 0; }
      .ft-result .ft-files { margin-top: 6px; }
      .ft-result .ft-file-link { font-size: 11px; color: #58a6ff; display: block; margin: 2px 0; }
    `;
    document.head.appendChild(style);
  }

  // Start polling
  const statusEl = panel.querySelector(".ft-status");
  const progressFill = panel.querySelector(".ft-progress-fill");
  const progressText = panel.querySelector(".ft-progress-text");
  const logsEl = panel.querySelector(".ft-logs");
  const retryBtn = panel.querySelector(".ft-retry-btn");
  const resultEl = panel.querySelector(".ft-result");

  let pollTimer = null;
  let lastLogCount = 0;

  async function pollStatus() {
    try {
      const resp = await fetch(`/api/finetune/status?jobId=${encodeURIComponent(jobId)}`);
      if (!resp.ok) return;
      const { job } = await resp.json();
      if (!job) return;

      // Update status badge
      statusEl.textContent = job.status.charAt(0).toUpperCase() + job.status.slice(1);
      statusEl.className = "ft-status ft-status-" + (job.status === "completed" ? "completed" : job.status === "failed" || job.status === "error" ? "failed" : "running");

      // Update progress
      let pct = 5;
      if (job.status === "pushing") pct = 10;
      else if (job.status === "running") pct = Math.min(90, 15 + (job.pollCount || 0) * 0.5);
      else if (job.status === "completed") pct = 100;
      else if (job.status === "failed" || job.status === "error") pct = 100;
      progressFill.style.width = pct + "%";
      if (job.status === "failed" || job.status === "error") {
        progressFill.style.background = "linear-gradient(90deg, #da3634, #f85149)";
      } else if (job.status === "completed") {
        progressFill.style.background = "linear-gradient(90deg, #238635, #3fb950)";
      }

      // Update progress text
      if (job.status === "running") {
        const elapsed = job.pollCount ? `${(job.pollCount * 10)}s elapsed` : "";
        progressText.textContent = `Training in progress... ${elapsed}`;
      } else if (job.status === "completed") {
        progressText.textContent = "Training completed successfully!";
      } else if (job.status === "failed" || job.status === "error") {
        const errMsg = (job.errors && job.errors.length > 0) ? job.errors[job.errors.length - 1].message : "Unknown error";
        progressText.textContent = "Failed: " + errMsg;
      } else {
        progressText.textContent = job.status + "...";
      }

      // Update logs
      if (job.logs && job.logs.length > lastLogCount) {
        const newLogs = job.logs.slice(lastLogCount);
        for (const log of newLogs) {
          const time = log.time ? log.time.split("T")[1]?.split(".")[0] || "" : "";
          const levelColor = log.level === "error" ? "#f85149" : log.level === "warn" ? "#d29922" : "#8b949e";
          logsEl.innerHTML += `<span style="color:${levelColor}">[${time}] ${escapeHtml(log.message)}</span>\n`;
        }
        lastLogCount = job.logs.length;
        logsEl.scrollTop = logsEl.scrollHeight;
      }

      // Handle completion
      if (job.status === "completed") {
        clearInterval(pollTimer);
        resultEl.style.display = "block";
        let resultHtml = "<h4>✅ Finetuned Model Ready</h4>";
        if (job.metrics) {
          if (job.metrics.finalLoss != null) resultHtml += `<div class="ft-metric">Final Loss: <strong>${job.metrics.finalLoss}</strong></div>`;
          if (job.metrics.totalSteps) resultHtml += `<div class="ft-metric">Total Steps: <strong>${job.metrics.totalSteps}</strong></div>`;
        }
        if (job.modelArtifact?.outputUrl) {
          resultHtml += `<div class="ft-files"><a class="ft-file-link" href="${escapeHtml(job.modelArtifact.outputUrl)}" target="_blank">📦 Download Model Artifacts ↗</a></div>`;
        }
        if (job.outputFiles && job.outputFiles.length > 0) {
          resultHtml += `<div class="ft-files">`;
          for (const f of job.outputFiles) {
            const sizeMb = f.size ? (f.size / 1048576).toFixed(1) + " MB" : "";
            resultHtml += `<a class="ft-file-link" href="${escapeHtml(f.url || '#')}" target="_blank">${escapeHtml(f.name)} ${sizeMb}</a>`;
          }
          resultHtml += `</div>`;
        }
        resultEl.innerHTML = resultHtml;
        scrollToBottom();
      }

      // Handle failure
      if (job.status === "failed" || job.status === "error") {
        clearInterval(pollTimer);
        retryBtn.style.display = "inline-block";
        if (job.recovery?.suggestions) {
          resultEl.style.display = "block";
          let recoveryHtml = "<h4 style='color:#f85149'>❌ Finetune Failed</h4>";
          recoveryHtml += "<div class='ft-metric'>Suggested fixes:</div>";
          for (const s of job.recovery.suggestions) {
            recoveryHtml += `<div class="ft-metric">• ${escapeHtml(s)}</div>`;
          }
          resultEl.innerHTML = recoveryHtml;
        }
        scrollToBottom();
      }

    } catch (_) { /* network error — keep trying */ }
  }

  pollTimer = setInterval(pollStatus, 5000);
  pollStatus(); // immediate first poll

  // Retry button
  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying...";
    try {
      const resp = await fetch("/api/finetune/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (resp.ok) {
        statusEl.textContent = "Running";
        statusEl.className = "ft-status ft-status-running";
        progressFill.style.width = "10%";
        progressFill.style.background = "linear-gradient(90deg, #1f6feb, #58a6ff)";
        progressText.textContent = "Retrying...";
        retryBtn.style.display = "none";
        resultEl.style.display = "none";
        lastLogCount = 0;
        logsEl.innerHTML = "";
        pollTimer = setInterval(pollStatus, 5000);
      } else {
        const { error } = await resp.json().catch(() => ({}));
        retryBtn.textContent = "Retry Failed: " + (error || "Unknown error");
      }
    } catch (err) {
      retryBtn.textContent = "Retry Error: " + err.message;
    }
  });
}

/* ── Stream Chat with Backend ── */
async function sendMessage(prompt) {
  if (!prompt || isStreaming) return;

  switchToChatMode();
  addMessage("user", prompt);
  chatHistory.push({ role: "user", content: prompt });
  syncThreadFromRuntime(true);
  addThinkingIndicator();
  updateThinkingIndicator("Connecting to text2llm...");
  setStreamingState(true);

  abortController = new AbortController();
  let botBubble = null;
  let fullText = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: prompt,
        sessionId: currentSessionId,
        history: chatHistory.slice(0, -1), // prior messages (exclude current)
        projectId: currentProjectId,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    updateThinkingIndicator("Connected. Waiting for first output...");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        }
        if (!line.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(line.slice(6));

          switch (currentEvent) {
            case "session":
              currentSessionId = data.sessionId;
              syncThreadFromRuntime();
              break;

            case "chunk":
              {
              const cleanText = sanitizeAgentText(data.text);
              if (!cleanText) break;
              if (!botBubble) {
                removeThinkingIndicator();
                botBubble = addMessage("bot", "");
              }
              fullText += cleanText;
              botBubble.innerHTML = renderMarkdown(fullText);
              scrollToBottom();
              break;
              }

            case "status":
              {
              const cleanStatus = sanitizeAgentText(data.text);
              if (!cleanStatus) break;
              updateThinkingIndicator(cleanStatus);
              break;
              }

            case "thinking":
              handleThinkingEvent(data);
              break;

            case "progress":
              handleProgressEvent(data);
              break;

            case "heartbeat":
              if (!botBubble) {
                const heartbeatText = sanitizeAgentText(data.text || "");
                updateThinkingIndicator(heartbeatText || lastThinkingStatus || "Still working...");
              }
              break;

            case "error":
              removeThinkingIndicator();
              if (!botBubble) {
                botBubble = addMessage("bot", "");
              }
              botBubble.innerHTML = renderChatErrorHTML(data);
              break;

            case "done":
              if (!botBubble) {
                removeThinkingIndicator();
                botBubble = addMessage("bot", fullText || "No response from the agent.");
              }
              // If this is a finetune workflow, show live monitoring panel
              if (data.workflow === "started" && data.jobId) {
                appendFinetuneMonitor(botBubble, data.jobId, data.kernelUrl);
              }
              break;
          }
        } catch (_) { /* skip malformed JSON lines */ }
      }
    }
  } catch (err) {
    removeThinkingIndicator();
    if (err.name !== "AbortError") {
      if (!botBubble) {
        addMessage("bot", `⚠ Connection error: ${err.message}. Make sure the Text2LLM runtime is configured.`);
      }
    } else {
      if (botBubble && !fullText) {
        botBubble.innerHTML = `<em class="text-dim">Stopped.</em>`;
      }
    }
  } finally {
    setStreamingState(false);
    abortController = null;

    // Record bot response in conversation history
    if (fullText) {
      chatHistory.push({ role: "assistant", content: fullText });
    }

    // Clean up temporary action stream container explicitly so the next message creates a new one
    finalizeActionContainer();

    // If no text was received and no bubble created, show generic message
    if (!botBubble && !document.getElementById("thinking-msg")) {
      addMessage("bot", "The agent didn't produce a response. Check your configuration.");
    }
    removeThinkingIndicator();
    syncThreadFromRuntime();
  }
}

/* ── Stop Button ── */
if (stopBtn) {
  stopBtn.addEventListener("click", async () => {
    if (abortController) abortController.abort();
    if (currentSessionId) {
      try {
        await fetch("/api/chat/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSessionId }),
        });
      } catch (_) { /* best effort */ }
    }
    setStreamingState(false);
  });
}

/* ── New Chat ── */
if (homeNewChatBtn) {
  homeNewChatBtn.addEventListener("click", async () => {
    await createAndActivateNewThread();
  });
}

/* ── Suggestion Chips ── */
if (suggestionChips) {
  suggestionChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const text = chip.textContent.trim();
      if (ideaInput && !isStreaming) {
        ideaInput.value = text;
        sendMessage(text);
        ideaInput.value = "";
      }
    });
  });
}

/* ── Auto-resize textarea ── */
if (ideaInput) {
  ideaInput.addEventListener("input", function() {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 200) + "px";
    if (this.value === "") this.style.height = "";
  });

  // Enter to send (Shift+Enter for newline)
  ideaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) {
        const prompt = ideaInput.value.trim();
        if (prompt) {
          ideaInput.value = "";
          ideaInput.style.height = "";
          sendMessage(prompt);
        }
      }
    }
  });
}

/* ── Form Submission ── */
if (ideaForm) {
  ideaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ideaInput || isStreaming) return;

    const prompt = ideaInput.value.trim();
    if (!prompt) return;

    ideaInput.value = "";
    ideaInput.style.height = "";
    sendMessage(prompt);
  });
}

/* ── Instances View ── */
/* ── Instances View ── */
function initInstanceTabs() {
  console.log("Initializing Instance Tabs");
  const tabBtns = document.querySelectorAll(".instance-tab");
  const tabContents = document.querySelectorAll(".instance-tab-content");

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      tabContents.forEach(c => c.classList.remove("active"));
      const target = document.getElementById(`tab-${targetTab}`);
      if (target) target.classList.add("active");
    });
  });
  // Add GPU provider handling
  const gpuBtn = document.querySelector('.instance-tab[data-tab="gpu"]');
  if (gpuBtn) {
    gpuBtn.addEventListener("click", loadGpuProviders);
  }
  const storageBtn = document.querySelector('.instance-tab[data-tab="storage"]');
  if (storageBtn) {
    storageBtn.addEventListener("click", () => {
      activateStorageTab();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initInstanceTabs);
} else {
  initInstanceTabs();
}

/* ── Projects View ── */
/* ── Projects View ── */

async function renderProjects() {
  const grid = document.getElementById("projects-grid");
  if (!grid) return;
  
  grid.innerHTML = '<div class="provider-loading">Loading projects...</div>';
  
  try {
    const res = await fetch("/api/projects");
    const data = await res.json();
    const projects = data.projects || [];
    cachedProjects = Array.isArray(projects) ? projects : [];
    syncCurrentProjectLabelFromCache();
    
    if (projects.length === 0) {
      grid.innerHTML = `
        <div class="gpu-empty-state">
          <strong>No projects yet</strong>
          <span>Create your first project to get started.</span>
        </div>
      `;
      return;
    }

    grid.innerHTML = "";
    
    projects.forEach(project => {
      const card = document.createElement("div");
      card.className = "provider-card"; // Reusing provider card style
      card.style.cursor = "pointer";
      
      // Status color mapping
      const statusColors = {
        "Active": "var(--primary)",
        "Training": "var(--accent)",
        "Stopped": "var(--text-dim)",
        "Draft": "var(--text-secondary)"
      };
      const statusColor = statusColors[project.status] || "var(--text)";

      // Format date nicely
      const dateStr = project.lastEdited ? new Date(project.lastEdited).toLocaleDateString() : "";

      card.innerHTML = `
        <div class="provider-card-header">
          <div class="provider-icon has-logo" style="background: ${project.color}20; color: ${project.color}; border: 1px solid ${project.color}40; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem;">
            ${getProviderInitials(project.name)}
          </div>
          <div class="provider-status" style="color: ${statusColor}; border-color: ${statusColor}40; background: ${statusColor}10;">
            ${project.status}
          </div>
        </div>
        <div class="provider-card-body">
          <h4 class="provider-name">${project.name}</h4>
          <p class="provider-desc">${project.description || "No description"}</p>
          <div style="margin-top: 12px; font-size: 0.8rem; color: var(--text-dim); display: flex; gap: 12px;">
             <span>${project.model ? "Model: " + project.model : "No model configured"}</span>
             <span>•</span>
             <span>${dateStr}</span>
          </div>
        </div>
        <div class="provider-card-footer">
          <button class="open-btn">
            Open Project
          </button>
          <button class="delete-btn" title="Delete Project">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
          </button>
        </div>
      `;
      
          // Add click handler for "Open Project"
          const openBtn = card.querySelector(".open-btn");
            openBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              // Visual feedback
              document.querySelectorAll(".provider-card").forEach(c => c.style.borderColor = "");
              card.style.borderColor = "var(--primary)";
              
              // Set active project
              setCurrentProjectId(project.id);
              renderCurrentProjectLabel(project.name);

              // Switch context to project's active thread
              const thread = ensureActiveThread();
              await activateThread(thread.id);

              // Switch to Home view
              const homeLink = document.querySelector('a[data-view="home"]');
              if (homeLink) {
                homeLink.click();
              } else {
                switchToChatMode();
              }
          });

      // Add click handler for "Delete Project"
      const deleteBtn = card.querySelector(".delete-btn");
      deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) return;

          try {
            const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
            if (res.ok) {
              renderProjects(); // Refresh list
              addMessage("system", `Project "${project.name}" deleted.`);
            } else {
              alert("Failed to delete project.");
            }
          } catch (err) {
            console.error(err);
            alert("Error deleting project.");
          }
      });

      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="provider-loading error">Failed to load projects: ${err.message}</div>`;
  }
}

// Hook into the view switching logic to render projects when the tab is active
document.addEventListener("DOMContentLoaded", () => {
    // Initial render
    renderProjects();
    
  
// ... (existing code)

  /* ── New Project Logic ── */
  const newProjectBtn = document.querySelector(".new-project-btn");
  if (newProjectBtn) {
    newProjectBtn.addEventListener("click", async () => {
      const name = prompt("Enter project name:");
      if (!name) return;
      
      const description = prompt("Enter project description (optional):");
      
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            name, 
            description,
            name, 
            description,
            model: "", // No default model
            color: "#" + Math.floor(Math.random()*16777215).toString(16) // Random color
          })
        });
        
        if (res.ok) {
          const createdPayload = await res.json();
          const createdProject = createdPayload?.project || createdPayload;
          const projectId = createdProject?.id || null;
          if (!projectId) {
            throw new Error("Project creation response missing id");
          }
          
          // Set active project
          setCurrentProjectId(projectId);
          renderCurrentProjectLabel(name);

          addMessage("system", `Project "**${name}**" created successfully.`);

          // Create welcome thread for this project
          await createAndActivateNewThread({
             projectId: projectId,
             title: `${name} chat`,
             messages: [{ role: "assistant", content: `Welcome to your new project **${name}**!` }]
          });

          // Switch to Home/Chat view
          const homeLink = document.querySelector('a[data-view="home"]');
          if (homeLink) homeLink.click();
          
          // Refresh list (in background)
          renderProjects();
        } else {
          alert("Failed to create project.");
        }
      } catch (err) {
        console.error(err);
        alert("Error creating project.");
      }
    });
  }
});



const PROVIDER_COLORS = {
  anthropic: "#D97706",
  openai: "#10A37F",
  google: "#4285F4",
  openrouter: "#8B5CF6",
  groq: "#F97316",
  xai: "#1DA1F2",
  mistral: "#FF7000",
  "github-copilot": "#6E40C9",
  "amazon-bedrock": "#FF9900",
  ollama: "#0EA5E9",
  together: "#6366F1",
  cerebras: "#EF4444",
  minimax: "#EC4899",
  moonshot: "#14B8A6",
  "qwen-portal": "#3B82F6",
  venice: "#22C55E",
  qianfan: "#EAB308",
};

const PROVIDER_LOGOS = {
  openai: "/logos/openai.png",
  groq: "/logos/groq.png",
  mistral: "/logos/mistral.png",
  xai: "/logos/xai.png",
  cerebras: "/logos/cerebras.png",
  minimax: "/logos/minimax.png",
  moonshot: "/logos/moonshot.png",
  ollama: "/logos/ollama.png",
  together: "/logos/togetherai.png",
  "openrouter": "/logos/openrouter.png",
  "qwen-portal": "/logos/qwen.png",
  venice: "/logos/venice.png",
  "amazon-bedrock": "/logos/amazonbedrock.png",
  // GPU providers — local assets for reliability/trust
  kaggle: "/logos/kaggle.svg",
  "google-colab": "/logos/google-colab.svg",
  colab: "/logos/google-colab.svg",
  aws: "/logos/aws.svg",
  azure: "/logos/azure.svg",
  "google-cloud": "/logos/google-cloud.svg",
  gcp: "/logos/google-cloud.svg",
  google: "/logos/google-cloud.svg",
  runpod: "/logos/runpod.png",
  lambda: "/logos/lambda.png",
  "lambda-cloud": "/logos/lambda.png",
  "lambdalabs": "/logos/lambda.png",
  "vast-ai": "/logos/vastai.png",
  "vast": "/logos/vastai.png",
  "self-hosted": "/logos/self-hosted-ssh.svg",
  "self-hosted-ssh": "/logos/self-hosted-ssh.svg",
  ssh: "/logos/self-hosted-ssh.svg",
  // Storage providers
  "google-drive": "/logos/google-drive.svg",
  dropbox: "/logos/dropbox.svg",
  onedrive: "/logos/onedrive.svg",
  mega: "/logos/mega.svg",
  huggingface: "/logos/huggingface.svg",
  "hugging-face": "/logos/huggingface.svg",
  hf: "/logos/huggingface.svg",
  s3: "/logos/s3.svg",
  "aws-s3": "/logos/s3.svg",
  local: "/logos/local-disk.svg",
  "local-disk": "/logos/local-disk.svg",
  gcs: "/logos/google-cloud.svg",
  "google-cloud-storage": "/logos/google-cloud.svg",
};

function normalizeProviderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function getProviderInitials(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "AI";
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

function resolveProviderLogo(provider) {
  const providedIcon = typeof provider.icon === "string" ? provider.icon.trim() : "";
  if (providedIcon) {
    return { src: providedIcon, isInlineSvg: providedIcon.startsWith("<") };
  }

  const idKey = normalizeProviderKey(provider.id);
  const nameKey = normalizeProviderKey(provider.name);
  const joined = `${idKey} ${nameKey}`;

  const directMatch = PROVIDER_LOGOS[idKey] || PROVIDER_LOGOS[nameKey];
  if (directMatch) {
    return { src: directMatch, isInlineSvg: false };
  }

  if (joined.includes("google") && joined.includes("colab")) {
    return { src: PROVIDER_LOGOS["google-colab"], isInlineSvg: false };
  }
  if (joined.includes("google") && (joined.includes("cloud") || joined.includes("gcp"))) {
    return { src: PROVIDER_LOGOS["google-cloud"], isInlineSvg: false };
  }
  if (joined.includes("aws") || joined.includes("amazon")) {
    return { src: PROVIDER_LOGOS.aws, isInlineSvg: false };
  }
  if (joined.includes("vast")) {
    return { src: PROVIDER_LOGOS["vast-ai"], isInlineSvg: false };
  }
  if (joined.includes("lambda")) {
    return { src: PROVIDER_LOGOS["lambda-cloud"], isInlineSvg: false };
  }
  if (joined.includes("runpod")) {
    return { src: PROVIDER_LOGOS.runpod, isInlineSvg: false };
  }
  if (joined.includes("kaggle")) {
    return { src: PROVIDER_LOGOS.kaggle, isInlineSvg: false };
  }
  if (joined.includes("azure")) {
    return { src: PROVIDER_LOGOS.azure, isInlineSvg: false };
  }
  if (joined.includes("self-hosted") || joined.includes("ssh")) {
    return { src: PROVIDER_LOGOS["self-hosted-ssh"], isInlineSvg: false };
  }
  if (joined.includes("drive") && joined.includes("google")) {
    return { src: PROVIDER_LOGOS["google-drive"], isInlineSvg: false };
  }
  if (joined.includes("dropbox")) {
    return { src: PROVIDER_LOGOS.dropbox, isInlineSvg: false };
  }
  if (joined.includes("onedrive") || joined.includes("microsoft")) {
    return { src: PROVIDER_LOGOS.onedrive, isInlineSvg: false };
  }
  if (joined.includes("mega")) {
    return { src: PROVIDER_LOGOS.mega, isInlineSvg: false };
  }
  if (joined.includes("hugging") || joined.includes("hf")) {
    return { src: PROVIDER_LOGOS.huggingface, isInlineSvg: false };
  }
  if (joined.includes("s3") && !joined.includes("google")) {
    return { src: PROVIDER_LOGOS.s3, isInlineSvg: false };
  }
  if (joined.includes("local")) {
    return { src: PROVIDER_LOGOS["local-disk"], isInlineSvg: false };
  }

  return { src: "", isInlineSvg: false };
}

function buildProviderIcon(provider, color) {
  const logo = resolveProviderLogo(provider);
  const initials = getProviderInitials(provider.name || provider.id);
  const iconClass = `provider-icon ${logo.src ? "has-logo" : "logo-fallback"}`;

  if (logo.isInlineSvg) {
    return {
      className: iconClass,
      style: `background: ${color}20; color: ${color}; border: 1px solid ${color}40;`,
      content: logo.src,
    };
  }

  return {
    className: iconClass,
    style: "",
    content: `
      ${logo.src ? `<img src="${logo.src}" alt="${provider.name} logo" class="provider-icon-image" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.parentElement.classList.add('logo-fallback');">` : ""}
      <span class="provider-icon-fallback">${initials}</span>
    `,
  };
}

async function loadProviders() {
  const grid = document.getElementById("provider-grid");
  if (!grid) return;

  grid.innerHTML = `<div class="provider-loading">Loading providers...</div>`;

  try {
    const res = await fetch("/api/instances/providers");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    grid.innerHTML = "";
    for (const provider of data.providers) {
      const card = createProviderCard(provider);
      grid.appendChild(card);
    }
  } catch (err) {
    grid.innerHTML = `<div class="provider-loading error">Failed to load providers: ${err.message}</div>`;
  }
}

function createProviderCard(provider) {
  const card = document.createElement("div");
  card.className = `provider-card ${provider.configured ? "configured" : ""}`;
  card.dataset.providerId = provider.id;

  const color = PROVIDER_COLORS[provider.id] || "var(--primary)";
  const icon = buildProviderIcon(provider, color);

  card.innerHTML = `
    <div class="provider-card-header">
      <div class="${icon.className}" style="${icon.style}">
        ${icon.content}
      </div>
      <div class="provider-status ${provider.configured ? "active" : ""}">
        ${provider.configured ? "✓ Configured" : "Not configured"}
      </div>
    </div>
    <div class="provider-card-body">
      <h4 class="provider-name">${provider.name}</h4>
      <p class="provider-desc">${provider.description}</p>
      ${provider.url ? `<a href="${provider.url}" target="_blank" class="provider-creds-link" onclick="event.stopPropagation()">Get Credentials ↗</a>` : ""}
    </div>
    <div class="provider-card-footer">
      <button class="provider-configure-btn" data-provider-id="${provider.id}">
        ${provider.configured ? "Update Configuration" : "Configure"}
      </button>
      ${provider.configured ? `
        <button class="provider-test-btn" data-provider-id="${provider.id}" style="margin-left: 8px; background: transparent; border: 1px solid var(--border); color: var(--text-muted); cursor: pointer; padding: 6px 12px; border-radius: 4px; font-size: 12px;">
          Test
        </button>` : ""}
      ${provider.isPrimary ? `
        <div style="margin-left: auto; font-size: 12px; font-weight: 500; color: var(--primary); display: flex; align-items: center; gap: 4px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Primary
        </div>
      ` : (provider.configured ? `
        <button class="provider-primary-btn" data-provider-id="${provider.id}" style="margin-left: 8px; background: transparent; border: 1px solid var(--primary); color: var(--primary); cursor: pointer; padding: 6px 12px; border-radius: 4px; font-size: 12px; transition: all 0.2s;">
          Make Primary
        </button>
      ` : "")}
    </div>
  `;

  const configBtn = card.querySelector(".provider-configure-btn");
  configBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showApiKeyModal(provider);
  });

  const testBtn = card.querySelector(".provider-test-btn");
  if (testBtn) {
    testBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const originalText = testBtn.textContent;
      testBtn.textContent = "Testing...";
      testBtn.disabled = true;

      try {
        const res = await fetch("/api/auth/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId: provider.id,
            optionId: provider.selectedOptionId || undefined,
          })
        });
        const data = await res.json();
        
        if (data.ok) {
           testBtn.textContent = "✓ OK";
           testBtn.style.color = "var(--success)";
           testBtn.style.borderColor = "var(--success)";
           
           // Fetch quota
           try {
             const qRes = await fetch(`/api/auth/quota?providerId=${provider.id}`);
             const qData = await qRes.json();
             if (qData.ok && qData.quota) {
               // Remove existing quota badge if any
               const existingBadge = card.querySelector(".provider-quota-badge");
               if (existingBadge) existingBadge.remove();

               const quotaEl = document.createElement("div");
               quotaEl.className = "provider-quota-badge";
               quotaEl.style.cssText = "font-size: 11px; color: var(--text-dim); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border);";
               quotaEl.innerHTML = `
                 <div style="display:flex; justify-content:space-between;">
                   <span>Quota:</span>
                   <span>${qData.quota.remaining}</span>
                 </div>
               `;
               card.querySelector(".provider-card-body").appendChild(quotaEl);
             }
           } catch (qErr) {
             console.error("Quota fetch failed", qErr);
           }

        } else {
           throw new Error(data.error);
        }
      } catch (err) {
        testBtn.textContent = "✗ Failed";
        testBtn.style.color = "var(--error)";
        testBtn.style.borderColor = "var(--error)";
        alert("Test failed: " + err.message);
      } finally {
        setTimeout(() => {
          if (testBtn.textContent !== "Test") {
             testBtn.disabled = false;
             setTimeout(() => {
               testBtn.textContent = "Test";
               testBtn.style.color = "";
               testBtn.style.borderColor = "";
             }, 3000);
          }
        }, 1000);
      }
    });
  }

  const primaryBtn = card.querySelector(".provider-primary-btn");
  if (primaryBtn) {
    primaryBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const originalText = primaryBtn.textContent;
      primaryBtn.textContent = "Setting...";
      primaryBtn.disabled = true;

      try {
        const res = await fetch("/api/instances/primary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: "ai", providerId: provider.id })
        });
        const data = await res.json();
        
        if (data.ok) {
           loadProviders(); // Refresh list to update UI
        } else {
           throw new Error(data.error);
        }
      } catch (err) {
        primaryBtn.textContent = originalText;
        primaryBtn.disabled = false;
        alert("Failed to set primary provider: " + err.message);
      }
    });
  }

  return card;
}

function showApiKeyModal(provider) {
  // Remove any existing modal
  const existing = document.getElementById("api-key-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "api-key-modal";
  modal.className = "modal-overlay";
  
  // Create options HTML
  const optionsHtml = provider.options.map(opt => 
    `<option value="${opt.id}" ${opt.configured ? "selected" : ""}>${opt.name}${opt.configured ? " (Configured)" : ""}</option>`
  ).join("");

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Configure ${provider.name}</h3>
        <button class="modal-close" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-form-group">
          <label class="modal-label">Authentication Method</label>
          <select id="auth-method-select" class="modal-select">
            ${optionsHtml}
          </select>
        </div>
        
        <div id="option-details-container" class="modal-option-info">
          <!-- Dynamically updated -->
        </div>

        <div id="auth-input-container">
          <!-- Dynamically updated (input or oauth button) -->
        </div>
        
        <p class="modal-hint">Settings are saved locally to your workspace configuration.</p>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" id="modal-cancel">Cancel</button>
        <button class="modal-save-btn" id="modal-save">Save & Activate</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector("#modal-close").addEventListener("click", closeModal);
  modal.querySelector("#modal-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const methodSelect = modal.querySelector("#auth-method-select");
  const detailsContainer = modal.querySelector("#option-details-container");
  const inputContainer = modal.querySelector("#auth-input-container");
  const saveBtn = modal.querySelector("#modal-save");

  const updateModalContent = () => {
    const selectedId = methodSelect.value;
    const option = provider.options.find(o => o.id === selectedId);
    if (!option) return;

    // Update details
    detailsContainer.innerHTML = `
      <div class="modal-option-description">Authentication via ${option.name}</div>
      <div class="modal-option-hint">Key: ${option.envKey}</div>
    `;

    // Update input area
    if (option.type === "oauth") {
      inputContainer.innerHTML = `
        <div class="modal-oauth-container">
          <button class="modal-oauth-btn" id="oauth-connect-btn">
            <span>Connect via Browser</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
          <div id="oauth-logs" class="oauth-logs" style="display:none; margin-top:12px; padding:12px; border-radius:6px; font-size:13px; line-height:1.4;"></div>
        </div>
      `;
      saveBtn.style.display = "none";
      
      modal.querySelector("#oauth-connect-btn").onclick = async () => {
        const oauthBtn = modal.querySelector("#oauth-connect-btn");
        const logsEl = modal.querySelector("#oauth-logs");
        
        oauthBtn.disabled = true;
        oauthBtn.textContent = "Starting...";
        logsEl.style.display = "none";
        logsEl.textContent = "";

        try {
          const res = await fetch("/api/instances/provider/oauth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              providerId: provider.id,
              optionId: selectedId,
            }),
          });

          const data = await readApiResponse(res);
          const jobId = data.jobId;

          if (!jobId) {
             throw new Error(data.error || "Failed to start OAuth job");
          }

          let inputSubmitting = false;

          // Start polling
          const pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(`/api/auth/status?jobId=${jobId}`);
              const statusData = await statusRes.json();
              
              if (!statusData.ok || !statusData.job) return;

              const job = statusData.job;
              
              if (job.status === "completed") {
                clearInterval(pollInterval);
                oauthBtn.textContent = "✓ Connected";
                oauthBtn.classList.add("success");
                logsEl.style.display = "none";
                setTimeout(() => {
                  closeModal();
                  loadProviders();
                }, 1500);
              } else if (job.status === "failed") {
                clearInterval(pollInterval);
                oauthBtn.textContent = "Retry Connection";
                oauthBtn.disabled = false;
                
                logsEl.style.display = "block";
                logsEl.style.background = "#ffebe9";
                logsEl.style.color = "#cf222e";
                logsEl.style.border = "1px solid rgba(255,129,130,0.4)";
                
                const mainErr = job.logs?.find(l => l.level === "error")?.message || "Authentication process failed or timed out.";
                const cleanErr = mainErr.split("\\n")[0].replace(/Process error: /i, "");
                
                logsEl.innerHTML = `
                  <div style="font-weight:600; margin-bottom:4px;">Connection Failed</div>
                  <div>${escapeHtml(cleanErr)}</div>
                  <div style="margin-top:8px; font-size:12px; color:#666;">
                    <strong>Solution:</strong> Check your local system terminal for detailed logs or <a href="#" style="color:#0969da; text-decoration:underline;" onclick="alert('Running text2llm doctor can diagnose local configuration issues.')">run the diagnostic tool</a>.
                  </div>
                `;
              } else {
                oauthBtn.textContent = job.awaitingInput
                  ? "Waiting for Redirect URL..."
                  : "Waiting for Sign-in...";

                if (job.authUrl || job.awaitingInput) {
                  logsEl.style.display = "block";
                  logsEl.style.background = "#eef6ff";
                  logsEl.style.color = "#1f2a44";
                  logsEl.style.border = "1px solid rgba(9,105,218,0.25)";

                  const authUrlHtml = job.authUrl
                    ? `
                      <div style="margin-bottom:8px;">
                        <a href="${escapeHtml(job.authUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0969da; text-decoration:underline; font-weight:600;">
                          Open Google sign-in page
                        </a>
                      </div>
                    `
                    : "";
                  const promptHtml = job.awaitingInput
                    ? `
                      <div style="margin-top:8px; text-align: center; padding: 12px 0;">
                        <div class="oauth-spinner" style="display:inline-block; width:24px; height:24px; border:3px solid rgba(9, 105, 218, 0.3); border-radius:50%; border-top-color:#0969da; animation:oauth-spin 1s linear infinite;"></div>
                        <style>@keyframes oauth-spin { 100% { transform: rotate(360deg); } }</style>
                        <div style="font-weight:600; margin-top:8px; color: var(--text);">Waiting for browser sign-in...</div>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">Please complete the login in the browser window that just opened.</div>
                        
                        <details style="margin-top: 16px; text-align: left; background: var(--bg-surface); border-radius: 6px; padding: 8px;">
                          <summary style="font-size: 11px; cursor: pointer; color: var(--text-dim);">Browser didn't open? Paste URL manually</summary>
                          <div style="margin-top: 8px;">
                            <div style="font-weight:600; margin-bottom:6px; font-size:11px; color: var(--text-muted);">${escapeHtml(job.inputPrompt || "Paste the full redirect URL from your browser.")}</div>
                            <textarea id="oauth-callback-input-${jobId}" style="width:100%; min-height:68px; border:1px solid var(--border); border-radius:6px; padding:8px; font-size:12px; background: var(--bg); color: var(--text);" placeholder="http://localhost:8085/oauth2callback?code=...&state=..."></textarea>
                            <button id="oauth-callback-submit-${jobId}" style="margin-top:8px; background:var(--primary); color:white; border:0; border-radius:6px; padding:8px 10px; font-weight:600; cursor:pointer; width: 100%;">
                              Submit Redirect URL
                            </button>
                          </div>
                        </details>
                      </div>
                    `
                    : `<div style="font-size:12px;">Complete Google sign-in in your browser. This dialog will continue automatically.</div>`;

                  logsEl.innerHTML = `
                    <div style="font-weight:600; margin-bottom:4px;">OAuth in progress</div>
                    ${authUrlHtml}
                    ${promptHtml}
                  `;

                  if (job.awaitingInput) {
                    const submitBtn = logsEl.querySelector(`#oauth-callback-submit-${jobId}`);
                    if (submitBtn && !submitBtn.dataset.bound) {
                      submitBtn.dataset.bound = "1";
                      submitBtn.addEventListener("click", async () => {
                        if (inputSubmitting) return;
                        const inputEl = logsEl.querySelector(`#oauth-callback-input-${jobId}`);
                        const value = (inputEl?.value || "").trim();
                        if (!value) {
                          inputEl?.focus();
                          return;
                        }
                        inputSubmitting = true;
                        submitBtn.disabled = true;
                        submitBtn.textContent = "Submitting...";

                        try {
                          const submitRes = await fetch("/api/auth/input", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ jobId, input: value }),
                          });
                          const submitData = await readApiResponse(submitRes);
                          if (!submitData.ok) {
                            throw new Error(submitData.error || "Failed to submit redirect URL");
                          }
                          oauthBtn.textContent = "Continuing...";
                          logsEl.style.background = "#fff8c5";
                          logsEl.style.color = "#5a4a00";
                          logsEl.style.border = "1px solid rgba(154,103,0,0.25)";
                          logsEl.innerHTML = "<div>Redirect URL received. Finishing authentication...</div>";
                        } catch (submitErr) {
                          submitBtn.disabled = false;
                          submitBtn.textContent = "Submit Redirect URL";
                          alert(`Failed to submit callback URL: ${submitErr.message}`);
                        } finally {
                          inputSubmitting = false;
                        }
                      });
                    }
                  }
                }
              }
            } catch (err) {
              console.error("Poll error", err);
            }
          }, 1000);

        } catch (err) {
          const needsRestart = err.status === 404 || err.rawBody?.includes("<!DOCTYPE");
          const suffix = needsRestart
            ? "\nTip: restart text2llm-web server so new OAuth API routes are loaded."
            : "";
          alert(`OAuth failed: ${err.message}${suffix}`);
          oauthBtn.disabled = false;
          oauthBtn.textContent = "Connect via Browser";
        }
      };
    } else {
      inputContainer.innerHTML = `
        <label class="modal-label">
          Enter ${option.name}
          <input type="${option.type}" id="api-key-input" class="modal-input" placeholder="Enter value..." autocomplete="off" />
        </label>
      `;
      saveBtn.style.display = "block";
      const input = modal.querySelector("#api-key-input");
      input.focus();
      
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveBtn.click();
      });
    }
  };

  methodSelect.addEventListener("change", updateModalContent);
  updateModalContent(); // Initial render

  saveBtn.addEventListener("click", async () => {
    const optionId = methodSelect.value;
    const input = modal.querySelector("#api-key-input");
    const key = input ? input.value.trim() : "";

    if (!key && saveBtn.textContent !== "Error — Retry") {
      input.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const res = await fetch("/api/instances/provider/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          providerId: provider.id, 
          optionId: optionId,
          apiKey: key 
        })
      });

      const data = await readApiResponse(res);
      if (!data.ok) throw new Error(data.error);

      closeModal();
      loadProviders(); // Refresh cards
    } catch (err) {
      saveBtn.textContent = "Error — Retry";
      saveBtn.disabled = false;
    }
  });
}

const gpuState = {
  providers: [],
  instances: [],
  runtimeTemplates: [],
  selectedProviderId: null,
  initialized: false,
};

function getGpuElements() {
  return {
    // providerSelect: document.getElementById("gpu-provider-select"), // Removed
    // providerFields: document.getElementById("gpu-provider-fields"), // Removed
    // saveCredentialsBtn: document.getElementById("gpu-save-credentials-btn"), // Removed
    // testCredentialsBtn: document.getElementById("gpu-test-credentials-btn"), // Removed
    readinessState: document.getElementById("gpu-readiness-state"),
    credentialsStatus: document.getElementById("gpu-credentials-status"),
    regionSelect: document.getElementById("gpu-region-select"),
    typeSelect: document.getElementById("gpu-type-select"),
    countInput: document.getElementById("gpu-count-input"),
    nameInput: document.getElementById("gpu-name-input"),
    launchBtn: document.getElementById("gpu-launch-btn"),
    launchStatus: document.getElementById("gpu-launch-status"),
    instanceList: document.getElementById("gpu-instance-list"),
    inferInstanceSelect: document.getElementById("gpu-infer-instance-select"),
    inferPrompt: document.getElementById("gpu-infer-prompt"),
    inferBtn: document.getElementById("gpu-infer-btn"),
    inferStatus: document.getElementById("gpu-infer-status"),
    inferOutput: document.getElementById("gpu-infer-output"),
  };
}

function setGpuReadinessState(state, isError = false) {
  const el = document.getElementById("gpu-readiness-state");
  const banner = document.getElementById("gpu-readiness-banner");
  if (!el) return;

  el.textContent = state;
  if (banner) {
    banner.classList.remove("connected", "error");
    if (isError) {
      banner.classList.add("error");
    } else if (state && !state.toLowerCase().includes("not connected")) {
      banner.classList.add("connected");
    }
  }
}

function computeReadinessFromProvider(provider) {
  if (!provider) {
    return { text: "Not connected", error: false };
  }

  const status = String(provider.credentialStatus || "").toLowerCase();
  if (!provider.configured) {
    return { text: "Not connected", error: false };
  }
  if (status === "permissions-missing") {
    return { text: "Error", error: true };
  }
  if (status === "valid") {
    return { text: "Credentials valid", error: false };
  }

  return { text: "Credentials valid", error: false };
}

function computeReadinessFromInstances(instances) {
  if (!Array.isArray(instances) || instances.length === 0) {
    return null;
  }

  const hasReady = instances.some((instance) => instance.status === "running" && instance.health === "ready");
  if (hasReady) {
    return { text: "Ready", error: false };
  }

  const hasProvisioning = instances.some((instance) => instance.status === "provisioning");
  if (hasProvisioning) {
    return { text: "Instance provisioning", error: false };
  }

  const hasError = instances.some((instance) => String(instance.health || "").toLowerCase() === "error");
  if (hasError) {
    return { text: "Error", error: true };
  }

  return null;
}

function selectedGpuProvider() {
  if (!Array.isArray(gpuState.providers) || gpuState.providers.length === 0) {
    return null;
  }

  if (gpuState.selectedProviderId) {
    const selected = gpuState.providers.find((provider) => provider.id === gpuState.selectedProviderId);
    if (selected) {
      return selected;
    }
  }

  const configured = gpuState.providers.find((provider) => provider.configured);
  return configured || gpuState.providers[0] || null;
}

function setActiveGpuProvider(providerId) {
  const next = gpuState.providers.find((provider) => provider.id === providerId)
    || gpuState.providers.find((provider) => provider.configured)
    || gpuState.providers[0]
    || null;

  gpuState.selectedProviderId = next?.id || null;

  document.querySelectorAll("#gpu-provider-grid .gpu-provider-card-v2").forEach((card) => {
    card.classList.toggle("selected", card.dataset.providerId === gpuState.selectedProviderId);
  });

  const { credentialsStatus } = getGpuElements();
  if (!next) {
    setGpuStatus(credentialsStatus, "No GPU provider available.", true);
    setGpuReadinessState("Not connected", false);
    return;
  }

  updateGpuLaunchChoices(next);
  const readiness = computeReadinessFromProvider(next);
  setGpuReadinessState(readiness.text, readiness.error);
  setGpuStatus(
    credentialsStatus,
    next.configured ? `${next.name} selected.` : `${next.name} selected. Configure credentials to launch instances.`,
    false,
  );
}

function setGpuStatus(element, message, isError = false) {
  if (!element) {
    return;
  }
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
}

// function renderGpuCredentialFields(provider) { ... } // Removed

function updateGpuLaunchChoices(provider) {
  const { regionSelect, typeSelect } = getGpuElements();
  if (!provider || !regionSelect || !typeSelect) {
    return;
  }

  regionSelect.innerHTML = provider.regions
    .map((region) => `<option value="${region}">${region}</option>`)
    .join("");

  typeSelect.innerHTML = provider.gpuTypes
    .map((type) => `<option value="${type}">${type}</option>`)
    .join("");
}

async function loadGpuProvidersLegacy() {
  const { providerSelect, credentialsStatus } = getGpuElements();
  if (!providerSelect) {
    return;
  }

  try {
    const response = await fetch("/api/instances/gpu/providers");
    const data = await readApiResponse(response);
    gpuState.providers = Array.isArray(data.providers) ? data.providers : [];

    providerSelect.innerHTML = gpuState.providers
      .map((provider) => {
        const suffix = provider.configured ? " (configured)" : "";
        return `<option value="${provider.id}">${provider.name}${suffix}</option>`;
      })
      .join("");

    const provider = selectedGpuProvider();
    if (provider) {
      renderGpuCredentialFields(provider);
      updateGpuLaunchChoices(provider);
      setGpuStatus(credentialsStatus, provider.configured ? `${provider.name} is already configured.` : "");
      const readiness = computeReadinessFromProvider(provider);
      setGpuReadinessState(readiness.text, readiness.error);
    }
  } catch (error) {
    setGpuStatus(credentialsStatus, `Failed to load GPU providers: ${error.message}`, true);
    setGpuReadinessState("Error", true);
  }
}

async function loadGpuRuntimeTemplates() {
  try {
    const response = await fetch("/api/instances/gpu/runtime/templates");
    const data = await readApiResponse(response);
    gpuState.runtimeTemplates = Array.isArray(data.templates) ? data.templates : [];
  } catch {
    gpuState.runtimeTemplates = [];
  }
}

async function loadGpuInstances() {
  const { instanceList, inferInstanceSelect, inferStatus } = getGpuElements();
  if (!instanceList || !inferInstanceSelect) {
    return;
  }

  try {
    const response = await fetch("/api/instances/gpu/instances");
    const data = await readApiResponse(response);
    gpuState.instances = Array.isArray(data.instances) ? data.instances : [];

    if (gpuState.instances.length === 0) {
      instanceList.innerHTML = `
        <div class="gpu-empty-state">
          <strong>No GPU instances yet</strong>
          <span>Launch your first instance to run inference.</span>
        </div>
      `;
      inferInstanceSelect.innerHTML = `<option value="">No instances available</option>`;
      const providerReadiness = computeReadinessFromProvider(selectedGpuProvider());
      setGpuReadinessState(providerReadiness.text, providerReadiness.error);
      return;
    }

    instanceList.innerHTML = gpuState.instances
      .map((instance) => {
        const canStart = instance.status === "stopped";
        const canStop = instance.status === "running";
        const canTerminate = instance.status !== "terminated";
        const label = instance.status === "running" && instance.health === "ready"
          ? "ready"
          : (instance.status === "provisioning" ? "provisioning" : instance.status);
        const providerName = escapeHtml(instance.providerName || "GPU Provider");
        const region = escapeHtml(instance.region || "region");
        const gpuType = escapeHtml(instance.gpuType || "GPU");
        const instanceType = escapeHtml(instance.instanceType || "custom");
        const instanceName = escapeHtml(instance.name || "instance");
        return `
          <div class="gpu-instance-card" data-instance-id="${instance.id}">
            <div class="gpu-instance-top">
              <div class="gpu-instance-meta">
                <strong>${instanceName}</strong>
                <span>${providerName} · ${region}</span>
              </div>
              <div class="gpu-instance-state ${label}">${label}</div>
            </div>
            <div class="gpu-instance-specs">
              <div class="gpu-spec-chip"><span>GPU</span><strong>${gpuType}</strong></div>
              <div class="gpu-spec-chip"><span>Count</span><strong>x${instance.gpuCount}</strong></div>
              <div class="gpu-spec-chip"><span>Plan</span><strong>${instanceType}</strong></div>
            </div>
            <div class="gpu-instance-actions">
              <button class="gpu-action-btn" data-action="start" ${canStart ? "" : "disabled"}>Start</button>
              <button class="gpu-action-btn" data-action="stop" ${canStop ? "" : "disabled"}>Stop</button>
              <button class="gpu-action-btn danger" data-action="terminate" ${canTerminate ? "" : "disabled"}>Terminate</button>
            </div>
          </div>
        `;
      })
      .join("");

    inferInstanceSelect.innerHTML = gpuState.instances
      .filter((instance) => instance.status === "running")
      .map((instance) => `<option value="${instance.id}">${instance.name} (${instance.providerName})</option>`)
      .join("");

    if (!inferInstanceSelect.innerHTML) {
      inferInstanceSelect.innerHTML = `<option value="">No running instances</option>`;
      setGpuStatus(inferStatus, "Start a GPU instance to run inference.");
    }

    const instanceReadiness = computeReadinessFromInstances(gpuState.instances);
    if (instanceReadiness) {
      setGpuReadinessState(instanceReadiness.text, instanceReadiness.error);
    }

    instanceList.querySelectorAll(".gpu-action-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest(".gpu-instance-card");
        const instanceId = card?.dataset.instanceId;
        const action = button.dataset.action;
        if (!instanceId || !action) {
          return;
        }

        button.disabled = true;
        try {
          const response = await fetch("/api/instances/gpu/instance/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId, action }),
          });
          await readApiResponse(response);
          await loadGpuInstances();
        } catch (error) {
          setGpuStatus(inferStatus, error.message, true);
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    setGpuStatus(inferStatus, `Failed to load instances: ${error.message}`, true);
    setGpuReadinessState("Error", true);
  }
}

async function saveGpuCredentials() {
  const { saveCredentialsBtn, credentialsStatus } = getGpuElements();
  const provider = selectedGpuProvider();
  if (!provider || !saveCredentialsBtn) {
    return;
  }

  const payload = {};
  const inputs = Array.from(document.querySelectorAll(".gpu-credential-input"));
  for (const input of inputs) {
    const key = input.dataset.key;
    if (key) {
      payload[key] = input.value.trim();
    }
  }

  saveCredentialsBtn.disabled = true;
  saveCredentialsBtn.textContent = "Saving...";

  try {
    const response = await fetch("/api/instances/gpu/provider/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: provider.id,
        credentials: payload,
      }),
    });
    const data = await readApiResponse(response);
    setGpuStatus(credentialsStatus, data.message || "Credentials saved.");
    setGpuReadinessState("Credentials valid");
    await loadGpuProviders();
  } catch (error) {
    setGpuStatus(credentialsStatus, error.message, true);
    setGpuReadinessState("Error", true);
  } finally {
    saveCredentialsBtn.disabled = false;
    saveCredentialsBtn.textContent = "Save Credentials";
  }
}

async function testGpuCredentials() {
  const { testCredentialsBtn, credentialsStatus } = getGpuElements();
  const provider = selectedGpuProvider();
  if (!provider || !testCredentialsBtn) {
    return;
  }

  const payload = {};
  const inputs = Array.from(document.querySelectorAll(".gpu-credential-input"));
  for (const input of inputs) {
    const key = input.dataset.key;
    if (!key) {
      continue;
    }
    const value = input.value.trim();
    if (value) {
      payload[key] = value;
    }
  }

  testCredentialsBtn.disabled = true;
  testCredentialsBtn.textContent = "Testing...";

  try {
    const hasInlineCredentials = Object.keys(payload).length > 0;
    const response = await fetch("/api/instances/gpu/provider/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: provider.id,
        credentials: hasInlineCredentials ? payload : undefined,
      }),
    });
    const data = await readApiResponse(response);
    const missing = Array.isArray(data.permissions?.missing) ? data.permissions.missing : [];
    const latency = Number(data.reachability?.latencyMs || 0);

    if (missing.length > 0) {
      setGpuStatus(credentialsStatus, `Reachable (${latency} ms), but missing permissions: ${missing.join(", ")}`, true);
      setGpuReadinessState("Error", true);
      return;
    }

    setGpuStatus(credentialsStatus, `Credentials valid. Reachable in ${latency} ms. Permissions verified.`);
    setGpuReadinessState("Credentials valid");
    await loadGpuProviders();
  } catch (error) {
    setGpuStatus(credentialsStatus, error.message, true);
    setGpuReadinessState("Error", true);
  } finally {
    testCredentialsBtn.disabled = false;
    testCredentialsBtn.textContent = "Test Credentials";
  }
}

async function launchGpuInstance() {
  const {
    launchBtn,
    launchStatus,
    regionSelect,
    typeSelect,
    countInput,
    nameInput,
  } = getGpuElements();
  const provider = selectedGpuProvider();
  if (!launchBtn) {
    return;
  }

  if (!provider) {
    setGpuStatus(launchStatus, "Select a GPU provider first.", true);
    return;
  }

  if (!provider.configured) {
    setGpuStatus(launchStatus, `Configure ${provider.name} credentials before launching.`, true);
    return;
  }

  launchBtn.disabled = true;
  launchBtn.textContent = "Launching...";
  setGpuReadinessState("Instance provisioning");

  try {
    const template = gpuState.runtimeTemplates.find((item) => item.id === "vllm") || gpuState.runtimeTemplates[0];
    const response = await fetch("/api/instances/gpu/instance/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: provider.id,
        region: regionSelect?.value,
        gpuType: typeSelect?.value,
        gpuCount: Number(countInput?.value || "1"),
        name: nameInput?.value || "",
        runtime: {
          templateId: template?.id || "vllm",
          image: template?.image,
          model: "open-source-default",
        },
      }),
    });
    const data = await readApiResponse(response);
    const readinessText = data.readiness?.state || "Ready";
    setGpuStatus(launchStatus, `Instance launched: ${data.instance.name}. ${readinessText}.`);
    setGpuReadinessState(readinessText, readinessText === "Error");
    await loadGpuInstances();
  } catch (error) {
    setGpuStatus(launchStatus, error.message, true);
    setGpuReadinessState("Error", true);
  } finally {
    launchBtn.disabled = false;
    launchBtn.textContent = "Launch Instance";
  }
}

async function runGpuInference() {
  const { inferInstanceSelect, inferPrompt, inferBtn, inferStatus, inferOutput } = getGpuElements();
  if (!inferInstanceSelect || !inferPrompt || !inferBtn || !inferOutput) {
    return;
  }

  const instanceId = inferInstanceSelect.value;
  const prompt = inferPrompt.value.trim();
  if (!instanceId || !prompt) {
    setGpuStatus(inferStatus, "Select a running instance and enter a prompt.", true);
    return;
  }

  inferBtn.disabled = true;
  inferBtn.textContent = "Running...";

  try {
    const response = await fetch("/api/instances/gpu/inference", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId, prompt }),
    });
    const data = await readApiResponse(response);
    setGpuStatus(inferStatus, `Inference complete in ${data.result.latencyMs} ms.`);
    inferOutput.textContent = data.result.output;
    setGpuReadinessState("Ready");
  } catch (error) {
    setGpuStatus(inferStatus, error.message, true);
    setGpuReadinessState("Error", true);
  } finally {
    inferBtn.disabled = false;
    inferBtn.textContent = "Run Inference";
  }
}

function initGpuTab() {
  if (gpuState.initialized) {
    return;
  }

  const { launchBtn, inferBtn } = getGpuElements();

  if (launchBtn) {
    launchBtn.addEventListener("click", launchGpuInstance);
  }
  if (inferBtn) {
    inferBtn.addEventListener("click", runGpuInference);
  }

  gpuState.initialized = true;
}

async function activateGpuTab() {
  initGpuTab();
  initGpuDrawer();
  await loadGpuRuntimeTemplates();
  await loadGpuProviders();
  await loadGpuInstances();
}

function initGpuDrawer() {
  const openBtn = document.getElementById("gpu-launch-open-btn");
  const closeBtn = document.getElementById("gpu-launch-close-btn");
  const drawer = document.getElementById("gpu-launch-drawer");
  if (!openBtn || !closeBtn || !drawer) return;
  openBtn.onclick = () => drawer.classList.remove("hidden");
  closeBtn.onclick = () => drawer.classList.add("hidden");
}

// Load providers when instances view becomes active
const viewObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.target.id === "instances-view" && m.target.classList.contains("active")) {
      loadProviders();
      const activeTab = document.querySelector(".instance-tab.active")?.getAttribute("data-tab");
      if (activeTab === "gpu") {
        activateGpuTab();
      } else if (activeTab === "storage") {
        activateStorageTab();
      }
    }
  }
});
document.addEventListener("DOMContentLoaded", () => {
  const instancesView = document.getElementById("instances-view");
  if (instancesView) {
    viewObserver.observe(instancesView, { attributes: true, attributeFilter: ["class"] });
  }

  const gpuTabButton = document.querySelector('.instance-tab[data-tab="gpu"]');
  if (gpuTabButton) {
    gpuTabButton.addEventListener("click", () => {
      activateGpuTab();
    });
  }
  const storageTabButton = document.querySelector('.instance-tab[data-tab="storage"]');
  if (storageTabButton) {
    storageTabButton.addEventListener("click", () => {
      activateStorageTab();
    });
  }
});

/* ── Theme Toggle Logic ── */
/* ── Theme Toggle Logic ── */
function initTheme() {
  console.log("Initializing Theme");
  const themeToggleBtn = document.getElementById("theme-toggle");
  const sunIcon = document.querySelector(".sun-icon");
  const moonIcon = document.querySelector(".moon-icon");
  const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  // Determine initial theme: saved preference > OS preference
  const savedTheme = localStorage.getItem("theme");
  let currentTheme = savedTheme || (systemDarkQuery.matches ? "dark" : "light");
  applyTheme(currentTheme);

  // Listen for OS theme changes — auto-follow unless user has manually overridden
  systemDarkQuery.addEventListener("change", (e) => {
    if (!localStorage.getItem("theme")) {
      currentTheme = e.matches ? "dark" : "light";
      applyTheme(currentTheme);
    }
  });

  // Manual toggle: sets localStorage so OS changes are ignored until cleared
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      currentTheme = currentTheme === "dark" ? "light" : "dark";
      applyTheme(currentTheme);
      localStorage.setItem("theme", currentTheme);
    });
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      if (moonIcon) moonIcon.style.display = "none";
      if (sunIcon) sunIcon.style.display = "block";
    } else {
      document.documentElement.removeAttribute("data-theme");
      if (moonIcon) moonIcon.style.display = "block";
      if (sunIcon) sunIcon.style.display = "none";
    }
  }

  // Expose globally for terminal theme hook
  window.applyTheme = applyTheme;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme);
} else {
  initTheme();
}

/* ── View Navigation ── */
/* ── View Navigation ── */
function initViewNavigation() {
  console.log("Initializing View Navigation");
  const navItems = document.querySelectorAll(".nav-item[data-view]");
  const views = document.querySelectorAll(".view");

  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const targetView = item.getAttribute("data-view");

      navItems.forEach(nav => nav.classList.remove("active"));
      item.classList.add("active");

      views.forEach(view => view.classList.remove("active"));
      const targetElement = document.getElementById(`${targetView}-view`);
      if (targetElement) {
        targetElement.classList.add("active");

        if (targetView === "clui" && !window.terminalInitialized) {
          initTerminal();
        }
        if (targetView === "notebook") {
          activateNotebookWorkspace();
        }
        if (targetView === "dataset-creator") {
          activateDatasetCreatorWorkspace();
        }
        if (targetView === "data-studio") {
          activateDataStudioWorkspace();
        }
        if (targetView === "store") {
          activateStore();
        }
        if (targetView === "home") {
          refreshLabTelemetry();
        }
        refreshStatusBar(targetView);
        closeMobileToolsSheet();
      }

      if (isCompactLayout()) {
        sidebar.classList.remove("open");
      }
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initViewNavigation);
} else {
  initViewNavigation();
}

/* ── Terminal Initialization ── */
let terminal = null;
let fitAddon = null;
let ws = null;
let terminalIoHandlersBound = false;
const runtimeViewState = {
  filter: "all",
  replayTail: 200,
};

window.terminal = terminal;
window.fitAddon = fitAddon;
window.ws = ws;

function parseTerminalFrame(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function initRuntimeControls() {
  const filterEl = document.getElementById("runtime-filter-select");
  const replayTailEl = document.getElementById("runtime-replay-tail");
  const replayBtn = document.getElementById("runtime-replay-btn");

  if (!filterEl || filterEl.dataset.bound === "1") {
    return;
  }

  filterEl.value = runtimeViewState.filter;
  if (replayTailEl) {
    replayTailEl.value = String(runtimeViewState.replayTail);
  }

  filterEl.addEventListener("change", () => {
    runtimeViewState.filter = filterEl.value || "all";
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "runtime:filter", filter: runtimeViewState.filter }));
    }
  });

  if (replayTailEl) {
    replayTailEl.addEventListener("change", () => {
      runtimeViewState.replayTail = Number(replayTailEl.value || 200);
    });
  }

  if (replayBtn) {
    replayBtn.addEventListener("click", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "runtime:replay",
            tail: runtimeViewState.replayTail,
          }),
        );
      }
    });
  }

  filterEl.dataset.bound = "1";
}

function renderTerminalFrame(frame, rawFallback = "") {
  if (!frame || typeof frame !== "object") {
    if (rawFallback) terminal.write(rawFallback);
    return;
  }

  if (typeof frame.line === "string") {
    terminal.write(frame.line);
    return;
  }

  if (frame.type === "shell" && frame.payload && typeof frame.payload.text === "string") {
    terminal.write(frame.payload.text);
    return;
  }

  if (frame.type === "shell-output") {
    terminal.write(String(frame.data || ""));
    return;
  }

  if (frame.type === "runtime-event") {
    terminal.write(String(frame.line || ""));
    return;
  }

  if (frame.type === "runtime-replay-start") {
    terminal.write(`\r\n\x1b[90m[Runtime]\x1b[0m replay start (${frame.count || 0} events)\r\n`);
    return;
  }

  if (frame.type === "runtime-replay-end") {
    terminal.write(`\r\n\x1b[90m[Runtime]\x1b[0m replay complete (${frame.count || 0} events)\r\n`);
    return;
  }

  if (frame.type === "runtime-filter-ack") {
    terminal.write(`\r\n\x1b[90m[Runtime]\x1b[0m filter set to ${frame.filter || "all"}\r\n`);
    return;
  }

  if (typeof frame.data === "string") {
    terminal.write(frame.data);
    return;
  }

  if (rawFallback) {
    terminal.write(rawFallback);
  }
}

function initTerminal() {
  if (window.terminalInitialized) return;

  if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
    console.error('xterm.js not loaded from CDN');
    return;
  }

  window.terminalInitialized = true;

  const terminalElement = document.getElementById('terminal');
  if (!terminalElement) return;

  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: 'transparent',
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
      cursor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      selection: 'rgba(45, 106, 79, 0.3)',
    },
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
    fontSize: 14,
  });

  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalElement);
  fitAddon.fit();

  initRuntimeControls();

  window.addEventListener('resize', () => {
    if (fitAddon) fitAddon.fit();
  });

  connectTerminalWebSocket();

  const originalApplyTheme = window.applyTheme;
  window.applyTheme = function(theme) {
    if (originalApplyTheme) originalApplyTheme(theme);
    if (terminal) {
      terminal.options.theme = {
        ...terminal.options.theme,
        foreground: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
        cursor: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      };
    }
  };
}

window.initTerminal = initTerminal;

function connectTerminalWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/terminal`;

  runtimeSocketState = "connecting";
  refreshStatusBar("clui");
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    runtimeSocketState = "connected";
    refreshStatusBar("clui");
    console.log('Terminal WebSocket connected');
    terminal.write('\r\n\x1b[1;32m✓ Connected to terminal\x1b[0m\r\n\r\n');
    ws.send(JSON.stringify({ type: "runtime:filter", filter: runtimeViewState.filter }));
    ws.send(JSON.stringify({ type: "runtime:replay", tail: runtimeViewState.replayTail }));
    ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
  };

  ws.onmessage = (event) => {
    const raw = typeof event.data === "string" ? event.data : "";
    const frame = parseTerminalFrame(raw);
    renderTerminalFrame(frame, raw);
  };

  ws.onerror = (error) => {
    runtimeSocketState = "disconnected";
    refreshStatusBar("clui");
    console.error('WebSocket error:', error);
    terminal.write('\r\n\x1b[1;31m✗ Connection error\x1b[0m\r\n');
  };

  ws.onclose = () => {
    runtimeSocketState = "disconnected";
    refreshStatusBar("clui");
    console.log('Terminal WebSocket disconnected');
    terminal.write('\r\n\x1b[1;33m⚠ Disconnected from terminal\x1b[0m\r\n');
    setTimeout(() => {
      if (document.getElementById('clui-view')?.classList.contains('active')) {
        terminal.write('\r\n\x1b[1;36m↻ Reconnecting...\x1b[0m\r\n');
        connectTerminalWebSocket();
      }
    }, 3000);
  };

  if (!terminalIoHandlersBound) {
    terminalIoHandlersBound = true;

    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    terminal.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  }
}

window.connectTerminalWebSocket = connectTerminalWebSocket;

/* ── New GPU Card Functions ── */

async function loadGpuProviders() {
  const grid = document.getElementById("gpu-provider-grid");
  if (!grid) return;

  grid.innerHTML = `<div class="provider-loading">Loading GPU providers...</div>`;

  try {
    const res = await fetch("/api/instances/gpu/providers");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    gpuState.providers = data.providers;

    grid.innerHTML = "";
    for (const provider of data.providers) {
      const card = createGpuProviderCard(provider);
      grid.appendChild(card);
    }

    const preferred = gpuState.selectedProviderId
      || data.providers.find((provider) => provider.configured)?.id
      || data.providers[0]?.id
      || null;
    if (preferred) {
      setActiveGpuProvider(preferred);
    }
    
  } catch (err) {
    grid.innerHTML = `<div class="provider-loading error">Failed to load GPU providers: ${err.message}</div>`;
  }
}

function createGpuProviderCard(provider) {
  const card = document.createElement("div");
  const isConfigured = provider.credentialStatus === "valid" || provider.configured;
  
  card.className = `gpu-provider-card-v2 ${isConfigured ? "configured" : ""}`;
  card.dataset.providerId = provider.id;

  const logo = resolveProviderLogo(provider);
  const initials = getProviderInitials(provider.name || provider.id);
  const logoHtml = logo.src
    ? `<img src="${logo.src}" alt="${provider.name} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
    : "";

  card.innerHTML = `
    <span class="gpu-prov-badge">${isConfigured ? "✓ Connected" : "Not configured"}</span>
    <div class="gpu-provider-logo">
      ${logoHtml}
      <span class="gpu-logo-initials" style="${logo.src ? 'display:none' : 'display:flex'}">${initials}</span>
    </div>
    <div class="gpu-prov-info">
      <h4 class="gpu-prov-name">${provider.name}</h4>
      <p class="gpu-prov-desc">${provider.description}</p>
      ${provider.url ? `<a href="${provider.url}" target="_blank" class="provider-creds-link" onclick="event.stopPropagation()">Get Credentials ↗</a>` : ""}
    </div>
    <div style="display: flex; gap: 8px; margin-top: 12px; width: 100%;">
      <button class="gpu-prov-action" data-provider-id="${provider.id}" style="flex: 1;">
        ${isConfigured ? "Update Credentials" : "Configure"}
      </button>
      ${provider.isPrimary ? `
        <div style="font-size: 12px; font-weight: 500; color: var(--primary); display: flex; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--primary); padding: 0 12px; border-radius: 6px; background: transparent;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Primary
        </div>
      ` : (isConfigured ? `
        <button class="gpu-prov-primary-btn" data-provider-id="${provider.id}" style="background: transparent; border: 1px solid var(--primary); color: var(--primary); cursor: pointer; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 500; transition: all 0.2s;">
          Make Primary
        </button>
      ` : "")}
    </div>
  `;

  const configBtn = card.querySelector(".gpu-prov-action");
  configBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setActiveGpuProvider(provider.id);
    showGpuConfigModal(provider);
  });

  // Clicking the card selects the active provider for launch/inference flow.
  card.addEventListener("click", () => {
    setActiveGpuProvider(provider.id);
  });

  const primaryBtn = card.querySelector(".gpu-prov-primary-btn");
  if (primaryBtn) {
    primaryBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const originalText = primaryBtn.textContent;
      primaryBtn.textContent = "Setting...";
      primaryBtn.disabled = true;

      try {
        const res = await fetch("/api/instances/primary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: "gpu", providerId: provider.id })
        });
        const data = await res.json();
        
        if (data.ok) {
           loadGpuProviders(); // Refresh list to update UI
        } else {
           throw new Error(data.error);
        }
      } catch (err) {
        primaryBtn.textContent = originalText;
        primaryBtn.disabled = false;
        alert("Failed to set primary GPU provider: " + err.message);
      }
    });
  }

  return card;
}

function showGpuConfigModal(provider) {
  setActiveGpuProvider(provider.id);

  const existing = document.getElementById("gpu-config-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "gpu-config-modal";
  modal.className = "modal-overlay";

  const fieldsHtml = provider.authFields.map(field => {
    const inputId = `modal-gpu-${field.key}`;
    const placeholder = field.type === "textarea" ? "Paste value..." : "Enter value...";
    if (field.type === "textarea") {
      return `
        <div class="modal-form-group">
          <label class="modal-label" for="${inputId}">${field.label}</label>
          <textarea id="${inputId}" class="modal-input" data-key="${field.key}" rows="3" placeholder="${placeholder}"></textarea>
        </div>
      `;
    }
    return `
      <div class="modal-form-group">
        <label class="modal-label" for="${inputId}">${field.label}</label>
        <input type="${field.type}" id="${inputId}" class="modal-input" data-key="${field.key}" placeholder="${placeholder}" />
      </div>
    `;
  }).join("");

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Configure ${provider.name}</h3>
        <button class="modal-close" id="gpu-modal-close">&times;</button>
      </div>
      <div class="modal-body">
         <p class="modal-hint" style="margin-bottom:16px;">${provider.tokenGuidance || "Securely stored in your workspace."}</p>
         ${fieldsHtml}
         <div id="gpu-modal-status" class="gpu-inline-status" style="margin-top:12px;"></div>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" id="gpu-modal-cancel">Cancel</button>
        <button class="modal-test-btn" id="gpu-modal-test" style="margin-right:auto;">Test Connection</button>
        <button class="modal-save-btn" id="gpu-modal-save">Save Credentials</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector("#gpu-modal-close").addEventListener("click", closeModal);
  modal.querySelector("#gpu-modal-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const statusEl = modal.querySelector("#gpu-modal-status");
  const saveBtn = modal.querySelector("#gpu-modal-save");
  const testBtn = modal.querySelector("#gpu-modal-test");

  const getCredentials = () => {
    const inputs = modal.querySelectorAll(".modal-input");
    const creds = {};
    inputs.forEach(input => {
      const key = input.dataset.key;
      creds[key] = input.value.trim();
    });
    return creds;
  };

  testBtn.addEventListener("click", async () => {
    testBtn.disabled = true;
    testBtn.textContent = "Testing...";
    statusEl.textContent = "";
    statusEl.className = "gpu-inline-status";

    const credentials = getCredentials();
    try {
      const res = await fetch("/api/instances/gpu/provider/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, credentials }),
      });
      const data = await res.json();
      
      if (data.ok) {
        statusEl.textContent = "✓ Connection successful!";
        statusEl.classList.add("success");
      } else {
        throw new Error(data.error || "Connection failed");
      }
    } catch (err) {
      statusEl.textContent = `⚠ ${err.message}`;
      statusEl.classList.add("error");
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test Connection";
    }
  });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    statusEl.textContent = "";
    statusEl.className = "gpu-inline-status";

    const credentials = getCredentials();
    try {
      const res = await fetch("/api/instances/gpu/provider/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, credentials }),
      });
      const data = await res.json();

      if (data.ok) {
        closeModal();
        await loadGpuProviders(); // Refresh grid
        setActiveGpuProvider(provider.id);
      } else {
        throw new Error(data.error || "Failed to save");
      }
    } catch (err) {
      statusEl.textContent = `⚠ ${err.message}`;
      statusEl.classList.add("error");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Credentials";
    }
  });
}

/* ── Storage ── */
const storageState = {
  initialized: false,
  providers: [],
  project: null,
  totalMonthlyCostUsd: 0,
  syncJobs: [],
  restoreJobs: [],
};

function storageEls() {
  return {
    refreshBtn: document.getElementById("storage-refresh-btn"),
    status: document.getElementById("storage-status"),
    providerGrid: document.getElementById("storage-provider-grid"),
    readinessBanner: document.getElementById("storage-readiness-banner"),
    readinessState: document.getElementById("storage-readiness-state"),
    settingsOpenBtn: document.getElementById("storage-settings-open-btn"),
    settingsCloseBtn: document.getElementById("storage-settings-close-btn"),
    settingsDrawer: document.getElementById("storage-settings-drawer"),
    projectName: document.getElementById("storage-project-name"),
    defaultProvider: document.getElementById("storage-default-provider"),
    rootPath: document.getElementById("storage-root-path"),
    saveProjectBtn: document.getElementById("storage-save-project-btn"),
    containerGrid: document.getElementById("storage-container-grid"),
    syncMode: document.getElementById("storage-sync-mode"),
    syncSteps: document.getElementById("storage-sync-steps"),
    syncMinutes: document.getElementById("storage-sync-minutes"),
    retentionKeep: document.getElementById("storage-retention-keep"),
    savePolicyBtn: document.getElementById("storage-save-policy-btn"),
    syncNowBtn: document.getElementById("storage-sync-now-btn"),
    primaryProvider: document.getElementById("storage-primary-provider"),
    backupProvider: document.getElementById("storage-backup-provider"),
    replicationEnabled: document.getElementById("storage-replication-enabled"),
    saveReplicationBtn: document.getElementById("storage-save-replication-btn"),
    restoreLatestBtn: document.getElementById("storage-restore-latest-btn"),
    summary: document.getElementById("storage-cost-summary"),
  };
}

function formatStorageBytes(bytes) {
  const value = Math.max(0, Number(bytes || 0));
  if (value >= 1024 ** 4) {
    return `${(value / (1024 ** 4)).toFixed(2)} TB`;
  }
  if (value >= 1024 ** 3) {
    return `${(value / (1024 ** 3)).toFixed(2)} GB`;
  }
  if (value >= 1024 ** 2) {
    return `${(value / (1024 ** 2)).toFixed(2)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  return `${value} B`;
}

function setStorageStatus(message, isError = false) {
  const { status } = storageEls();
  if (!status) {
    return;
  }
  status.textContent = message || "";
  status.className = "gpu-inline-status";
  if (isError) {
    status.classList.add("error");
  }
  // Auto-clear success messages after 5s
  if (message && !isError) {
    clearTimeout(setStorageStatus._timer);
    setStorageStatus._timer = setTimeout(() => {
      if (status.textContent === message) {
        status.textContent = "";
      }
    }, 5000);
  }
}

function setStorageReadiness(text, isError = false) {
  const { readinessState, readinessBanner } = storageEls();
  if (!readinessState) return;
  readinessState.textContent = text;
  if (readinessBanner) {
    readinessBanner.classList.remove("connected", "error");
    if (isError) {
      readinessBanner.classList.add("error");
    } else if (text && !text.toLowerCase().includes("no providers")) {
      readinessBanner.classList.add("connected");
    }
  }
}

function renderStorageProviderGrid() {
  const { providerGrid } = storageEls();
  if (!providerGrid) {
    return;
  }

  if (!Array.isArray(storageState.providers) || storageState.providers.length === 0) {
    providerGrid.innerHTML = `<div class="provider-loading">No storage providers available.</div>`;
    setStorageReadiness("No providers connected", false);
    return;
  }

  providerGrid.innerHTML = "";
  let configuredCount = 0;

  storageState.providers.forEach((provider) => {
    const card = document.createElement("div");
    const isConfigured = provider.configured;
    if (isConfigured) configuredCount++;

    card.className = `gpu-provider-card-v2 ${isConfigured ? "configured" : ""}`;
    card.dataset.providerId = provider.id;

    const logo = resolveProviderLogo(provider);
    const initials = getProviderInitials(provider.name || provider.id);
    const logoHtml = logo.src
      ? `<img src="${logo.src}" alt="${provider.name} logo" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
      : "";

    const usagePercent = Math.round((provider.quota?.usageRatio || 0) * 100);
    const usedText = formatStorageBytes(provider.quota?.bytesUsed || 0);
    const modeLabel = provider.supportsOAuth ? "OAuth" : "Token";

    let badgeContent = isConfigured ? "✓ Connected" : "Not configured";
    let badgeStyle = "";
    if (isConfigured && provider.lowSpace) {
      badgeContent = "⚠ Low space";
      badgeStyle = "background: rgba(239,68,68,0.12); color: #ef4444;";
    } else if (isConfigured) {
      badgeStyle = "background: rgba(34, 197, 94, 0.12); color: #22c55e;";
    }

    card.innerHTML = `
      <span class="gpu-prov-badge" style="${badgeStyle}">${badgeContent}</span>
      <div class="gpu-provider-logo">
        ${logoHtml}
        <span class="gpu-logo-initials" style="${logo.src ? 'display:none' : 'display:flex'}">${initials}</span>
      </div>
      <div class="gpu-prov-info">
        <h4 class="gpu-prov-name">${escapeHtml(provider.name)}</h4>
        <p class="gpu-prov-desc">${modeLabel}${isConfigured ? ` · ${usedText} used` : ""}</p>
        ${provider.url ? `<a href="${provider.url}" target="_blank" class="provider-creds-link" onclick="event.stopPropagation()">Get Credentials ↗</a>` : ""}
      </div>
      </div>
      <div style="display: flex; gap: 8px; margin-top: 12px; width: 100%;">
        <button class="gpu-prov-action" data-provider-id="${provider.id}" style="flex: 1;">
          ${isConfigured ? "Settings" : (provider.supportsOAuth ? "Connect OAuth" : "Configure")}
        </button>
        ${provider.isPrimary ? `
          <div style="font-size: 12px; font-weight: 500; color: var(--primary); display: flex; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--primary); padding: 0 12px; border-radius: 6px; background: transparent;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Primary
          </div>
        ` : (isConfigured ? `
          <button class="gpu-prov-primary-btn" data-provider-id="${provider.id}" style="background: transparent; border: 1px solid var(--primary); color: var(--primary); cursor: pointer; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 500; transition: all 0.2s;">
            Make Primary
          </button>
        ` : "")}
      </div>
    `;

    const configBtn = card.querySelector(".gpu-prov-action");
    configBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showStorageProviderModal(provider);
    });

    const primaryBtn = card.querySelector(".gpu-prov-primary-btn");
    if (primaryBtn) {
      primaryBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const originalText = primaryBtn.textContent;
        primaryBtn.textContent = "Setting...";
        primaryBtn.disabled = true;

        try {
          const res = await fetch("/api/instances/primary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: "storage", providerId: provider.id })
          });
          const data = await res.json();
          
          if (data.ok) {
             loadStorageState(); // Refresh list to update UI
          } else {
             throw new Error(data.error);
          }
        } catch (err) {
          primaryBtn.textContent = originalText;
          primaryBtn.disabled = false;
          alert("Failed to set primary Storage provider: " + err.message);
        }
      });
    }

    providerGrid.appendChild(card);
  });

  // Update readiness banner
  if (configuredCount > 0) {
    const lowSpace = storageState.providers.filter((p) => p.lowSpace);
    if (lowSpace.length > 0) {
      setStorageReadiness(`${configuredCount} connected · ${lowSpace.length} low space`, true);
    } else {
      setStorageReadiness(`${configuredCount} provider${configuredCount > 1 ? "s" : ""} connected`, false);
    }
  } else {
    setStorageReadiness("No providers connected", false);
  }
}

function renderStorageProjectForm() {
  const {
    projectName,
    defaultProvider,
    rootPath,
    syncMode,
    syncSteps,
    syncMinutes,
    retentionKeep,
    primaryProvider,
    backupProvider,
    replicationEnabled,
  } = storageEls();

  const project = storageState.project;
  if (!project || !defaultProvider || !projectName || !rootPath || !syncMode || !syncSteps || !syncMinutes || !retentionKeep || !primaryProvider || !backupProvider || !replicationEnabled) {
    return;
  }

  const providerOptions = storageState.providers
    .map((provider) => `<option value="${provider.id}">${escapeHtml(provider.name)}${provider.configured ? "" : " (not configured)"}</option>`)
    .join("");

  defaultProvider.innerHTML = providerOptions;
  primaryProvider.innerHTML = providerOptions;
  backupProvider.innerHTML = `<option value="">None</option>${providerOptions}`;

  projectName.value = project.name || "default";
  rootPath.value = project.rootPath || `Text2LLM/${project.name || "default"}`;
  defaultProvider.value = project.defaultProviderId || "local";

  syncMode.value = project.policies?.syncMode || "manual";
  syncSteps.value = Number(project.policies?.syncEverySteps || 500);
  syncMinutes.value = Number(project.policies?.syncEveryMinutes || 15);
  retentionKeep.value = Number(project.policies?.retentionKeepLast || 5);

  primaryProvider.value = project.replication?.primaryProviderId || project.defaultProviderId || "local";
  backupProvider.value = project.replication?.backupProviderId || "";
  replicationEnabled.value = project.replication?.enabled ? "true" : "false";
}

function renderStorageContainers() {
  const { containerGrid } = storageEls();
  const project = storageState.project;
  if (!containerGrid || !project) {
    return;
  }

  const containers = Object.values(project.containers || {});
  if (containers.length === 0) {
    containerGrid.innerHTML = `<div class="provider-loading">No containers available.</div>`;
    return;
  }

  containerGrid.innerHTML = containers
    .map((container) => `
      <div class="storage-container-card" data-container-id="${container.id}">
        <div class="storage-container-header">
          <h4>${escapeHtml(container.name || container.id)}</h4>
          <div class="storage-container-actions">
            <button class="storage-action-btn storage-upload-btn" data-container="${container.id}" title="Upload artifact">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
            </button>
            <button class="storage-action-btn storage-browse-btn" data-container="${container.id}" title="Browse artifacts">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="storage-action-btn storage-clear-btn" data-container="${container.id}" title="Clear container">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <p>${escapeHtml(container.purpose || "")}</p>
        <div class="storage-container-path">${escapeHtml(container.path || "")}</div>
        <div class="storage-container-meta">
          <span class="gpu-spec-chip"><span>Artifacts</span><strong>${Number(container.artifactCount || 0)}</strong></span>
          <span class="gpu-spec-chip"><span>Used</span><strong>${formatStorageBytes(container.bytesUsed || 0)}</strong></span>
        </div>
        <div class="storage-artifacts-drawer hidden" id="artifacts-drawer-${container.id}"></div>
      </div>
    `)
    .join("");

  // Wire container action buttons
  containerGrid.querySelectorAll(".storage-upload-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showUploadArtifactDialog(btn.dataset.container);
    });
  });

  containerGrid.querySelectorAll(".storage-browse-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleArtifactBrowser(btn.dataset.container);
    });
  });

  containerGrid.querySelectorAll(".storage-clear-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const containerId = btn.dataset.container;
      if (!confirm(`Clear all artifacts from "${containerId}"?`)) return;
      btn.disabled = true;
      try {
        const response = await fetch("/api/instances/storage/container/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ containerId }),
        });
        await readApiResponse(response);
        await loadStorageState();
        setStorageStatus(`Container "${containerId}" cleared.`);
      } catch (err) {
        setStorageStatus(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function toggleArtifactBrowser(containerId) {
  const drawer = document.getElementById(`artifacts-drawer-${containerId}`);
  if (!drawer) return;

  if (!drawer.classList.contains("hidden")) {
    drawer.classList.add("hidden");
    drawer.innerHTML = "";
    return;
  }

  drawer.classList.remove("hidden");
  drawer.innerHTML = `<div class="provider-loading">Loading artifacts...</div>`;

  try {
    const response = await fetch(`/api/instances/storage/artifacts?containerId=${encodeURIComponent(containerId)}`);
    const data = await readApiResponse(response);
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];

    if (artifacts.length === 0) {
      drawer.innerHTML = `<div class="storage-artifact-empty">No artifacts in this container.</div>`;
      return;
    }

    drawer.innerHTML = `
      <div class="storage-artifact-list">
        <div class="storage-artifact-list-header">
          <span>Name</span><span>Provider</span><span>Size</span><span>Date</span><span></span>
        </div>
        ${artifacts.map((a) => {
          const nameSegments = String(a.key || a.id).split("/");
          const displayName = nameSegments[nameSegments.length - 1] || a.id;
          const providerName = storageState.providers.find((p) => p.id === a.providerId)?.name || a.providerId;
          return `
            <div class="storage-artifact-row" data-artifact-id="${escapeHtml(a.id)}" data-provider-id="${escapeHtml(a.providerId)}">
              <span class="storage-artifact-name" title="${escapeHtml(a.key || "")}">${escapeHtml(displayName)}</span>
              <span class="storage-artifact-provider">${escapeHtml(providerName)}</span>
              <span class="storage-artifact-size">${formatStorageBytes(a.sizeBytes || 0)}</span>
              <span class="storage-artifact-date">${a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</span>
              <button class="storage-artifact-delete-btn" data-artifact-id="${escapeHtml(a.id)}" data-provider-id="${escapeHtml(a.providerId)}" title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>`;
        }).join("")}
      </div>`;

    drawer.querySelectorAll(".storage-artifact-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const artifactId = btn.dataset.artifactId;
        const providerId = btn.dataset.providerId;
        if (!confirm("Delete this artifact?")) return;
        btn.disabled = true;
        try {
          const res = await fetch("/api/instances/storage/artifact/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artifactId, providerId }),
          });
          await readApiResponse(res);
          await loadStorageState();
          // Re-expand the drawer
          const refreshedDrawer = document.getElementById(`artifacts-drawer-${containerId}`);
          if (refreshedDrawer) {
            refreshedDrawer.classList.add("hidden");
            await toggleArtifactBrowser(containerId);
          }
          setStorageStatus("Artifact deleted.");
        } catch (err) {
          setStorageStatus(err.message, true);
        }
      });
    });
  } catch (err) {
    drawer.innerHTML = `<div class="storage-artifact-empty" style="color:var(--error-color);">${escapeHtml(err.message)}</div>`;
  }
}

function showUploadArtifactDialog(containerId) {
  const existing = document.getElementById("storage-upload-modal");
  if (existing) existing.remove();

  const defaultProvider = storageState.project?.defaultProviderId || "local";
  const providerOptions = storageState.providers
    .filter((p) => p.configured)
    .map((p) => `<option value="${p.id}" ${p.id === defaultProvider ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");

  const modal = document.createElement("div");
  modal.id = "storage-upload-modal";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content" style="max-width:420px;">
      <div class="modal-header">
        <h3 style="margin:0;">Upload Artifact to ${escapeHtml(containerId)}</h3>
        <button class="modal-close" id="upload-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="modal-form-group">
          <label class="modal-label">Artifact Name</label>
          <input id="upload-artifact-name" class="modal-input" type="text" placeholder="e.g. training-data-v2.jsonl" />
        </div>
        <div class="modal-form-group">
          <label class="modal-label">Size (bytes, simulated)</label>
          <input id="upload-artifact-size" class="modal-input" type="number" min="1" value="${1024 * 1024}" />
        </div>
        <div class="modal-form-group">
          <label class="modal-label">Target Provider</label>
          <select id="upload-artifact-provider" class="modal-input">${providerOptions}</select>
        </div>
        <div id="upload-modal-status" class="gpu-inline-status"></div>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" id="upload-modal-cancel">Cancel</button>
        <button class="modal-save-btn" id="upload-modal-submit">Upload</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector("#upload-modal-close")?.addEventListener("click", closeModal);
  modal.querySelector("#upload-modal-cancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  const submitBtn = modal.querySelector("#upload-modal-submit");
  const statusEl = modal.querySelector("#upload-modal-status");

  submitBtn.addEventListener("click", async () => {
    const name = modal.querySelector("#upload-artifact-name").value.trim();
    const sizeBytes = Number(modal.querySelector("#upload-artifact-size").value) || (1024 * 1024);
    const providerId = modal.querySelector("#upload-artifact-provider").value;

    if (!name) {
      statusEl.textContent = "Name is required.";
      statusEl.className = "gpu-inline-status error";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading...";
    statusEl.textContent = "";
    statusEl.className = "gpu-inline-status";

    try {
      const response = await fetch("/api/instances/storage/artifact/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId, name, sizeBytes, providerId }),
      });
      await readApiResponse(response);
      closeModal();
      await loadStorageState();
      setStorageStatus(`Artifact "${name}" uploaded to ${containerId}.`);
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = "gpu-inline-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload";
    }
  });
}

function renderStorageSummary() {
  const { summary } = storageEls();
  if (!summary) {
    return;
  }

  const connectedCount = storageState.providers.filter((p) => p.configured).length;
  const totalProviders = storageState.providers.length;
  const lowSpace = storageState.providers.filter((provider) => provider.lowSpace);
  const latestSync = Array.isArray(storageState.syncJobs) ? storageState.syncJobs[0] : null;
  const latestRestore = Array.isArray(storageState.restoreJobs) ? storageState.restoreJobs[0] : null;
  const latestSyncText = latestSync
    ? `${escapeHtml(latestSync.kind || "sync")} · step ${Number(latestSync.step || 0)}`
    : "None";
  const latestRestoreText = latestRestore
    ? `${escapeHtml(latestRestore.checkpointId || "checkpoint")}`
    : "None";

  const projectName = storageState.project?.name || "—";
  const totalUsed = storageState.providers.reduce((sum, p) => sum + Number(p.quota?.bytesUsed || 0), 0);

  summary.innerHTML = `
    <div class="storage-overview-chips">
      <div class="storage-chip">
        <span class="storage-chip-label">Providers</span>
        <strong>${connectedCount}/${totalProviders}</strong>
      </div>
      <div class="storage-chip">
        <span class="storage-chip-label">Total Used</span>
        <strong>${formatStorageBytes(totalUsed)}</strong>
      </div>
      <div class="storage-chip">
        <span class="storage-chip-label">Est. Cost</span>
        <strong>$${Number(storageState.totalMonthlyCostUsd || 0).toFixed(2)}/mo</strong>
      </div>
      <div class="storage-chip">
        <span class="storage-chip-label">Project</span>
        <strong>${escapeHtml(projectName)}</strong>
      </div>
      <div class="storage-chip">
        <span class="storage-chip-label">Last Sync</span>
        <strong>${latestSyncText}</strong>
      </div>
      <div class="storage-chip">
        <span class="storage-chip-label">Last Restore</span>
        <strong>${latestRestoreText}</strong>
      </div>
    </div>
  `;
}

function renderStorageHistory() {
  const syncHistoryEl = document.getElementById("storage-sync-history");
  const restoreHistoryEl = document.getElementById("storage-restore-history");

  if (syncHistoryEl) {
    const jobs = storageState.syncJobs || [];
    if (jobs.length === 0) {
      syncHistoryEl.innerHTML = `<div class="storage-history-empty">No sync jobs yet.</div>`;
    } else {
      syncHistoryEl.innerHTML = jobs.slice(0, 20).map((job) => {
        const providerName = storageState.providers.find((p) => p.id === job.primaryProvider)?.name || job.primaryProvider || "—";
        const backupName = job.backupProvider ? (storageState.providers.find((p) => p.id === job.backupProvider)?.name || job.backupProvider) : null;
        const date = job.createdAt ? new Date(job.createdAt).toLocaleString() : "—";
        return `
          <div class="storage-history-item ${job.status === "completed" ? "success" : ""}">
            <div class="storage-history-main">
              <span class="storage-history-kind">${escapeHtml(job.kind || "sync")}</span>
              <span class="storage-history-step">Step ${Number(job.step || 0)}</span>
              <span class="storage-history-provider">${escapeHtml(providerName)}${backupName ? ` → ${escapeHtml(backupName)}` : ""}</span>
            </div>
            <div class="storage-history-meta">
              <span>${formatStorageBytes(job.checkpointSize || 0)}</span>
              <span>${date}</span>
              <span class="storage-history-status">${job.status || "unknown"}</span>
            </div>
          </div>`;
      }).join("");
    }
  }

  if (restoreHistoryEl) {
    const jobs = storageState.restoreJobs || [];
    if (jobs.length === 0) {
      restoreHistoryEl.innerHTML = `<div class="storage-history-empty">No restore jobs yet.</div>`;
    } else {
      restoreHistoryEl.innerHTML = jobs.slice(0, 20).map((job) => {
        const providerName = storageState.providers.find((p) => p.id === job.providerId)?.name || job.providerId || "—";
        const date = job.restoredAt ? new Date(job.restoredAt).toLocaleString() : "—";
        return `
          <div class="storage-history-item ${job.status === "completed" ? "success" : ""}">
            <div class="storage-history-main">
              <span class="storage-history-kind">restore</span>
              <span class="storage-history-step">${escapeHtml(job.checkpointId || "—")}</span>
              <span class="storage-history-provider">${escapeHtml(providerName)}</span>
            </div>
            <div class="storage-history-meta">
              <span>${job.checksum ? job.checksum.slice(0, 12) + "…" : "—"}</span>
              <span>${date}</span>
              <span class="storage-history-status">${job.status || "unknown"}</span>
            </div>
          </div>`;
      }).join("");
    }
  }
}

async function loadStorageState() {
  try {
    const response = await fetch("/api/instances/storage/state");
    const data = await readApiResponse(response);
    storageState.providers = Array.isArray(data.providers) ? data.providers : [];
    storageState.project = data.project || null;
    storageState.totalMonthlyCostUsd = Number(data.totalMonthlyCostUsd || 0);
    storageState.syncJobs = Array.isArray(data.syncJobs) ? data.syncJobs : [];
    storageState.restoreJobs = Array.isArray(data.restoreJobs) ? data.restoreJobs : [];

    renderStorageProviderGrid();
    renderStorageProjectForm();
    renderStorageContainers();
    renderStorageSummary();
    renderStorageHistory();
  } catch (error) {
    setStorageStatus(`Failed to load storage state: ${error.message}`, true);
  }
}

function showStorageProviderModal(provider) {
  const existing = document.getElementById("storage-provider-modal");
  if (existing) {
    existing.remove();
  }

  const modal = document.createElement("div");
  modal.id = "storage-provider-modal";
  modal.className = "modal-overlay";

  // Build logo for modal header
  const logo = resolveProviderLogo(provider);
  const initials = getProviderInitials(provider.name || provider.id);
  const modalLogoHtml = logo.src
    ? `<img src="${logo.src}" alt="${provider.name}" style="width:28px;height:28px;object-fit:contain;border-radius:6px;">`
    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:var(--hover-overlay);font-weight:700;font-size:0.75rem;color:var(--text-secondary);">${initials}</span>`;

  const tokenFields = Array.isArray(provider.authFields) && provider.authFields.length > 0
    ? provider.authFields.map((field) => `
        <div class="modal-form-group">
          <label class="modal-label" for="storage-${field.key}">${escapeHtml(field.label)}</label>
          <input id="storage-${field.key}" class="modal-input" data-key="${field.key}" type="password" placeholder="Enter value" />
        </div>
      `).join("")
    : "";

  const usedText = provider.configured ? formatStorageBytes(provider.quota?.bytesUsed || 0) : "—";
  const quotaText = provider.quota?.quotaGb ? `${provider.quota.quotaGb} GB` : "—";

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          ${modalLogoHtml}
          <h3 style="margin:0;">${escapeHtml(provider.name)}</h3>
        </div>
        <button class="modal-close" id="storage-modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <div class="gpu-spec-chip"><span>Status</span><strong>${provider.configured ? "Connected" : "Not configured"}</strong></div>
          <div class="gpu-spec-chip"><span>Used</span><strong>${usedText}</strong></div>
          <div class="gpu-spec-chip"><span>Quota</span><strong>${quotaText}</strong></div>
        </div>
        ${tokenFields}
        ${!tokenFields && provider.supportsOAuth ? '<p class="modal-hint">This provider uses browser-based OAuth for authentication.</p>' : ""}
        <div id="storage-modal-status" class="gpu-inline-status"></div>
      </div>
      <div class="modal-footer">
        <button class="modal-cancel-btn" id="storage-modal-cancel">Cancel</button>
        ${provider.configured && provider.id !== "local" ? '<button class="modal-test-btn" id="storage-modal-disconnect" style="color:#ef4444;">Disconnect</button>' : ""}
        ${provider.supportsOAuth ? '<button class="modal-test-btn" id="storage-modal-oauth" style="margin-right:auto;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Connect OAuth</button>' : '<span style="margin-right:auto;"></span>'}
        ${tokenFields ? '<button class="modal-save-btn" id="storage-modal-save">Save Credentials</button>' : ""}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector("#storage-modal-close")?.addEventListener("click", closeModal);
  modal.querySelector("#storage-modal-cancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  const statusEl = modal.querySelector("#storage-modal-status");

  const oauthBtn = modal.querySelector("#storage-modal-oauth");
  oauthBtn?.addEventListener("click", async () => {
    oauthBtn.disabled = true;
    oauthBtn.textContent = "Connecting...";
    try {
      const response = await fetch("/api/instances/storage/provider/oauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
      });
      const data = await readApiResponse(response);
      
      if (data.url) {
          window.location.href = data.url;
          return;
      }

      closeModal();
      await loadStorageState();
      setStorageStatus(`${provider.name} connected via OAuth.`);
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.className = "gpu-inline-status error";
      oauthBtn.disabled = false;
      oauthBtn.textContent = "Connect OAuth";
    }
  });

  const saveBtn = modal.querySelector("#storage-modal-save");
  saveBtn?.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const inputs = modal.querySelectorAll(".modal-input[data-key]");
    const credentials = {};
    inputs.forEach((input) => {
      credentials[input.dataset.key] = input.value.trim();
    });

    try {
      const response = await fetch("/api/instances/storage/provider/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, credentials }),
      });
      await readApiResponse(response);
      closeModal();
      await loadStorageState();
      setStorageStatus(`${provider.name} configured.`);
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.className = "gpu-inline-status error";
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  const disconnectBtn = modal.querySelector("#storage-modal-disconnect");
  disconnectBtn?.addEventListener("click", async () => {
    if (!confirm(`Disconnect ${provider.name}? All artifacts stored in this provider will be removed.`)) return;
    disconnectBtn.disabled = true;
    disconnectBtn.textContent = "Disconnecting...";
    try {
      const response = await fetch("/api/instances/storage/provider/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
      });
      await readApiResponse(response);
      closeModal();
      await loadStorageState();
      setStorageStatus(`${provider.name} disconnected.`);
    } catch (error) {
      statusEl.textContent = error.message;
      statusEl.className = "gpu-inline-status error";
      disconnectBtn.disabled = false;
      disconnectBtn.textContent = "Disconnect";
    }
  });
}

function initStorageTab() {
  if (storageState.initialized) {
    return;
  }

  const {
    refreshBtn,
    settingsOpenBtn,
    settingsCloseBtn,
    settingsDrawer,
    saveProjectBtn,
    savePolicyBtn,
    syncNowBtn,
    saveReplicationBtn,
    restoreLatestBtn,
    projectName,
    defaultProvider,
    rootPath,
    syncMode,
    syncSteps,
    syncMinutes,
    retentionKeep,
    primaryProvider,
    backupProvider,
    replicationEnabled,
  } = storageEls();

  // Settings drawer open/close
  if (settingsOpenBtn && settingsDrawer) {
    settingsOpenBtn.onclick = () => settingsDrawer.classList.remove("hidden");
  }
  if (settingsCloseBtn && settingsDrawer) {
    settingsCloseBtn.onclick = () => settingsDrawer.classList.add("hidden");
  }

  // Settings sub-tabs
  document.querySelectorAll(".storage-settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".storage-settings-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".storage-settings-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const target = document.getElementById(`storage-panel-${tab.dataset.stab}`);
      if (target) target.classList.add("active");
    });
  });

  refreshBtn?.addEventListener("click", () => {
    loadStorageState();
  });

  saveProjectBtn?.addEventListener("click", async () => {
    saveProjectBtn.disabled = true;
    saveProjectBtn.textContent = "Saving...";
    try {
      const response = await fetch("/api/instances/storage/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName?.value,
          defaultProviderId: defaultProvider?.value,
          rootPath: rootPath?.value,
        }),
      });
      await readApiResponse(response);
      await loadStorageState();
      setStorageStatus("Project mapping updated.");
    } catch (error) {
      setStorageStatus(error.message, true);
    } finally {
      saveProjectBtn.disabled = false;
      saveProjectBtn.textContent = "Save Mapping";
    }
  });

  savePolicyBtn?.addEventListener("click", async () => {
    savePolicyBtn.disabled = true;
    savePolicyBtn.textContent = "Saving...";
    try {
      const response = await fetch("/api/instances/storage/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncMode: syncMode?.value,
          syncEverySteps: Number(syncSteps?.value || 500),
          syncEveryMinutes: Number(syncMinutes?.value || 15),
          retentionKeepLast: Number(retentionKeep?.value || 5),
        }),
      });
      await readApiResponse(response);
      await loadStorageState();
      setStorageStatus("Sync and retention policy saved.");
    } catch (error) {
      setStorageStatus(error.message, true);
    } finally {
      savePolicyBtn.disabled = false;
      savePolicyBtn.textContent = "Save Policy";
    }
  });

  syncNowBtn?.addEventListener("click", async () => {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = "Syncing...";
    try {
      const lastStep = Number(storageState.syncJobs?.[0]?.step || 0);
      const nextStep = Math.max(1, lastStep + Number(syncSteps?.value || 500));
      const response = await fetch("/api/instances/storage/checkpoint/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: nextStep,
          sizeBytes: 2 * 1024 * 1024 * 1024,
        }),
      });
      await readApiResponse(response);
      await loadStorageState();
      setStorageStatus(`Checkpoint synced at step ${nextStep}.`);
    } catch (error) {
      setStorageStatus(error.message, true);
    } finally {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync Checkpoint Now";
    }
  });

  saveReplicationBtn?.addEventListener("click", async () => {
    saveReplicationBtn.disabled = true;
    saveReplicationBtn.textContent = "Saving...";
    try {
      const response = await fetch("/api/instances/storage/replication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: replicationEnabled?.value === "true",
          primaryProviderId: primaryProvider?.value,
          backupProviderId: backupProvider?.value || null,
        }),
      });
      await readApiResponse(response);
      await loadStorageState();
      setStorageStatus("Replication policy saved.");
    } catch (error) {
      setStorageStatus(error.message, true);
    } finally {
      saveReplicationBtn.disabled = false;
      saveReplicationBtn.textContent = "Save Replication";
    }
  });

  restoreLatestBtn?.addEventListener("click", async () => {
    restoreLatestBtn.disabled = true;
    restoreLatestBtn.textContent = "Restoring...";
    try {
      const response = await fetch("/api/instances/storage/restore/latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: primaryProvider?.value || null }),
      });
      await readApiResponse(response);
      await loadStorageState();
      setStorageStatus("Latest checkpoint restored.");
    } catch (error) {
      setStorageStatus(error.message, true);
    } finally {
      restoreLatestBtn.disabled = false;
      restoreLatestBtn.textContent = "Restore Latest Checkpoint";
    }
  });

  storageState.initialized = true;
}

async function activateStorageTab() {
  initStorageTab();
  await loadStorageState();
}

/* ── Dataset Creator (minimized) ── */
const datasetCreatorState = {
  initialized: false,
  loading: false,
  uploadProgress: 0,
  activeJob: null,
  error: null,
};

function datasetCreatorEls() {
  return {
    errorBanner: document.getElementById("dataset-error-banner"),
    errorText: document.getElementById("dataset-error-text"),
    formatSelect: document.getElementById("dataset-format-select"),
    fileInput: document.getElementById("dataset-file-input"),
    uploadBtn: document.getElementById("dataset-upload-btn"),
    progressWrap: document.getElementById("dataset-upload-progress-wrap"),
    progressBar: document.getElementById("dataset-upload-progress-bar"),
    statusIdle: document.getElementById("dataset-status-idle"),
    statusPending: document.getElementById("dataset-status-pending"),
    statusCompleted: document.getElementById("dataset-status-completed"),
    statusFailed: document.getElementById("dataset-status-failed"),
    jobMeta: document.getElementById("dataset-job-meta"),
    downloadLink: document.getElementById("dataset-download-link"),
    premiumBanner: document.getElementById("dataset-premium-banner"),
  };
}

function setDatasetCreatorError(message) {
  const { errorBanner, errorText } = datasetCreatorEls();
  if (!errorBanner || !errorText) return;
  if (message) {
    errorText.textContent = message;
    errorBanner.style.display = "flex";
  } else {
    errorBanner.style.display = "none";
    errorText.textContent = "";
  }
  datasetCreatorState.error = message || null;
}

function renderDatasetCreatorStatus() {
  const { statusIdle, statusPending, statusCompleted, statusFailed, jobMeta, downloadLink } = datasetCreatorEls();
  if (!statusIdle) return;

  const job = datasetCreatorState.activeJob;
  const isPending = job && (job.status === "pending" || job.status === "processing");
  const isCompleted = job && job.status === "completed";
  const isFailed = job && job.status === "failed";

  statusIdle.style.display = (!job) ? "flex" : "none";
  statusPending.style.display = isPending ? "flex" : "none";
  statusCompleted.style.display = isCompleted ? "flex" : "none";
  statusFailed.style.display = isFailed ? "flex" : "none";

  if (isPending && jobMeta) {
    jobMeta.textContent = `Job ID: ${(job.id || "").slice(0, 8)} | Format: ${(job.output_format || "jsonl").toUpperCase()}`;
  }
  if (isCompleted && downloadLink && job.output_url) {
    downloadLink.href = job.output_url;
  }
}

async function handleDatasetUpload() {
  const { formatSelect, fileInput, uploadBtn, progressWrap, progressBar } = datasetCreatorEls();
  const file = fileInput?.files?.[0];
  if (!file) {
    setDatasetCreatorError("Please select a file first.");
    return;
  }

  setDatasetCreatorError(null);
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";
  progressWrap.style.display = "block";
  progressBar.style.width = "0%";
  datasetCreatorState.loading = true;

  try {
    const format = formatSelect?.value || "jsonl";
    const content = await file.text();

    // Simulate upload progress
    let pct = 0;
    const progressInterval = setInterval(() => {
      pct = Math.min(pct + 8, 90);
      progressBar.style.width = pct + "%";
      datasetCreatorState.uploadProgress = pct;
    }, 200);

    const response = await fetch("/api/data-studio/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: typeof getActiveProjectIdOrDefault === "function" ? getActiveProjectIdOrDefault() : "default",
        name: file.name.replace(/\.[^.]+$/, ""),
        sourceType: "upload",
        format,
        content,
        uploadAsset: {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          source: "upload",
          dataUrl: "",
        },
      }),
    });

    clearInterval(progressInterval);
    progressBar.style.width = "100%";

    const payload = await readApiResponse(response);
    datasetCreatorState.activeJob = {
      id: payload?.dataset?.id || "unknown",
      status: "completed",
      output_format: format,
      output_url: payload?.dataset?.downloadUrl || "#",
    };
    renderDatasetCreatorStatus();
  } catch (error) {
    setDatasetCreatorError(error.message || "Upload failed");
    datasetCreatorState.activeJob = {
      id: "error",
      status: "failed",
      output_format: formatSelect?.value || "jsonl",
    };
    renderDatasetCreatorStatus();
  } finally {
    datasetCreatorState.loading = false;
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Secure Upload & Process";
    setTimeout(() => {
      progressWrap.style.display = "none";
      progressBar.style.width = "0%";
    }, 1500);
  }
}

function initDatasetCreator() {
  if (datasetCreatorState.initialized) return;

  const { uploadBtn } = datasetCreatorEls();
  if (!uploadBtn) return;

  uploadBtn.addEventListener("click", handleDatasetUpload);
  datasetCreatorState.initialized = true;
}

function setDatasetCreatorStatus(message, level) {
  if (level === "error") {
    setDatasetCreatorError(message);
  }
}

async function refreshDatasetCreatorWorkspace() {
  renderDatasetCreatorStatus();
}

function initDatasetCreatorWorkspace() {
  initDatasetCreator();
}

async function activateDatasetCreatorWorkspace() {
  initDatasetCreator();
  renderDatasetCreatorStatus();
}

const dataStudioEditorState = {
  initialized: false,
  loading: false,
  datasets: [],
  selectedDatasetId: null,
  rows: [],
  columns: [],
  page: 1,
  pageSize: 25,
  totalRows: 0,
  totalPages: 1,
  query: "",
};

function dataStudioEditorEls() {
  return {
    refreshBtn: document.getElementById("studio-refresh-btn"),
    searchInput: document.getElementById("studio-search-input"),
    datasetList: document.getElementById("studio-dataset-list"),
    activeName: document.getElementById("studio-active-name"),
    activeMeta: document.getElementById("studio-active-meta"),
    addRowBtn: document.getElementById("studio-add-row-btn"),
    addColBtn: document.getElementById("studio-add-col-btn"),
    deleteDatasetBtn: document.getElementById("studio-delete-dataset-btn"),
    status: document.getElementById("studio-status"),
    empty: document.getElementById("studio-empty"),
    tableWrap: document.getElementById("studio-table-wrap"),
    tableHead: document.getElementById("studio-table-head"),
    tableBody: document.getElementById("studio-table-body"),
    pagination: document.getElementById("studio-pagination"),
    prevBtn: document.getElementById("studio-prev-btn"),
    nextBtn: document.getElementById("studio-next-btn"),
    pageLabel: document.getElementById("studio-page-label"),
  };
}

function setDataStudioEditorStatus(message, level = "") {
  const { status } = dataStudioEditorEls();
  if (!status) return;
  status.textContent = message || "";
  status.style.color = level === "error" ? "var(--danger, #ef4444)" : "";
}

function getDataStudioSelectedDataset() {
  return dataStudioEditorState.datasets.find((dataset) => dataset.id === dataStudioEditorState.selectedDatasetId) || null;
}

function getDataStudioColumns(rows) {
  const columns = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key && !key.startsWith("__")) {
        columns.add(key);
      }
    });
  });
  return Array.from(columns);
}

function renderDataStudioDatasetList() {
  const { datasetList } = dataStudioEditorEls();
  if (!datasetList) return;

  if (!Array.isArray(dataStudioEditorState.datasets) || dataStudioEditorState.datasets.length === 0) {
    datasetList.innerHTML = `<div class="studio-list-empty">No datasets yet</div>`;
    return;
  }

  datasetList.innerHTML = dataStudioEditorState.datasets
    .map((dataset) => {
      const active = dataset.id === dataStudioEditorState.selectedDatasetId ? " active" : "";
      const rowCount = Number(dataset?.stats?.rowCount || 0);
      const colCount = Number(dataset?.stats?.columnCount || 0);
      return `
        <button type="button" class="studio-dataset-item${active}" data-dataset-id="${escapeHtml(dataset.id)}">
          <span class="studio-dataset-name">${escapeHtml(dataset.name || "Untitled Dataset")}</span>
          <span class="studio-dataset-meta">${rowCount} rows • ${colCount} cols</span>
        </button>
      `;
    })
    .join("");
}

function renderDataStudioTable() {
  const { activeName, activeMeta, empty, tableWrap, tableHead, tableBody, pagination, prevBtn, nextBtn, pageLabel } = dataStudioEditorEls();
  const selected = getDataStudioSelectedDataset();

  if (!selected) {
    if (activeName) activeName.textContent = "No dataset selected";
    if (activeMeta) activeMeta.textContent = "Pick a dataset to start editing";
    if (empty) empty.classList.remove("hidden");
    if (tableWrap) tableWrap.classList.add("hidden");
    if (pagination) pagination.classList.add("hidden");
    return;
  }

  if (activeName) activeName.textContent = selected.name || "Untitled Dataset";
  if (activeMeta) {
    const rows = Number(selected?.stats?.rowCount || dataStudioEditorState.totalRows || 0);
    const cols = Number(selected?.stats?.columnCount || dataStudioEditorState.columns.length || 0);
    activeMeta.textContent = `${rows} rows • ${cols} columns • format: ${selected.format || "auto"}`;
  }

  if (empty) empty.classList.add("hidden");
  if (tableWrap) tableWrap.classList.remove("hidden");
  if (pagination) pagination.classList.remove("hidden");
  if (pageLabel) pageLabel.textContent = `Page ${dataStudioEditorState.page} / ${dataStudioEditorState.totalPages}`;
  if (prevBtn) prevBtn.disabled = dataStudioEditorState.page <= 1;
  if (nextBtn) nextBtn.disabled = dataStudioEditorState.page >= dataStudioEditorState.totalPages;

  const columns = dataStudioEditorState.columns;
  if (tableHead) {
    tableHead.innerHTML = `
      <tr>
        ${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
        <th class="studio-actions-col">Actions</th>
      </tr>
    `;
  }

  if (!tableBody) return;
  if (!Array.isArray(dataStudioEditorState.rows) || dataStudioEditorState.rows.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="${Math.max(1, columns.length + 1)}" class="studio-table-empty">No rows for this page.</td></tr>`;
    return;
  }

  tableBody.innerHTML = dataStudioEditorState.rows
    .map((row) => {
      const rowId = String(row?.__rowId || "");
      return `
        <tr>
          ${columns
            .map((column) => {
              const value = row?.[column] == null ? "" : String(row[column]);
              return `
                <td>
                  <input
                    class="studio-cell-input"
                    type="text"
                    value="${escapeHtml(value)}"
                    data-row-id="${escapeHtml(rowId)}"
                    data-column="${escapeHtml(column)}"
                    data-initial="${escapeHtml(value)}"
                  />
                </td>
              `;
            })
            .join("")}
          <td>
            <button type="button" class="studio-row-delete" data-row-delete="${escapeHtml(rowId)}">Delete</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadDataStudioRows() {
  const selected = getDataStudioSelectedDataset();
  if (!selected) {
    dataStudioEditorState.rows = [];
    dataStudioEditorState.columns = [];
    dataStudioEditorState.page = 1;
    dataStudioEditorState.totalRows = 0;
    dataStudioEditorState.totalPages = 1;
    renderDataStudioTable();
    return;
  }

  const params = new URLSearchParams({
    page: String(dataStudioEditorState.page || 1),
    pageSize: String(dataStudioEditorState.pageSize || 25),
  });
  if (dataStudioEditorState.query) {
    params.set("q", dataStudioEditorState.query);
  }

  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}/rows?${params.toString()}`));
  const payload = await readApiResponse(response);
  dataStudioEditorState.rows = Array.isArray(payload?.rows) ? payload.rows : [];
  dataStudioEditorState.page = Number(payload?.page || 1);
  dataStudioEditorState.totalRows = Number(payload?.totalRows || 0);
  dataStudioEditorState.totalPages = Number(payload?.totalPages || 1);
  dataStudioEditorState.columns = getDataStudioColumns(dataStudioEditorState.rows);

  if (dataStudioEditorState.columns.length === 0) {
    dataStudioEditorState.columns = Array.isArray(selected?.stats?.columns) ? selected.stats.columns : [];
  }
  renderDataStudioTable();
}

async function loadDataStudioDatasets(options = {}) {
  const { keepSelection = true } = options;
  const response = await fetch(withActiveProjectQuery("/api/data-studio/datasets"));
  const payload = await readApiResponse(response);
  dataStudioEditorState.datasets = Array.isArray(payload?.datasets) ? payload.datasets : [];

  if (!keepSelection || !dataStudioEditorState.datasets.some((dataset) => dataset.id === dataStudioEditorState.selectedDatasetId)) {
    dataStudioEditorState.selectedDatasetId = dataStudioEditorState.datasets[0]?.id || null;
  }

  renderDataStudioDatasetList();
  await loadDataStudioRows();
}

async function updateDataStudioCell(rowId, column, value) {
  const selected = getDataStudioSelectedDataset();
  if (!selected || !rowId || !column) return;
  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}/rows/${encodeURIComponent(rowId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates: { [column]: value } }),
  });
  await readApiResponse(response);
}

async function addDataStudioRow() {
  const selected = getDataStudioSelectedDataset();
  if (!selected) return;
  const baseColumns = dataStudioEditorState.columns.length > 0
    ? dataStudioEditorState.columns
    : (Array.isArray(selected?.stats?.columns) ? selected.stats.columns : []);
  const row = Object.fromEntries(baseColumns.map((column) => [column, ""]));
  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}/rows`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row }),
  });
  await readApiResponse(response);
  await loadDataStudioDatasets({ keepSelection: true });
  setDataStudioEditorStatus("Row added", "success");
}

async function deleteDataStudioRow(rowId) {
  const selected = getDataStudioSelectedDataset();
  if (!selected || !rowId) return;
  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}/rows/${encodeURIComponent(rowId)}`), {
    method: "DELETE",
  });
  await readApiResponse(response);
  await loadDataStudioDatasets({ keepSelection: true });
  setDataStudioEditorStatus("Row deleted", "success");
}

async function addDataStudioColumn() {
  const selected = getDataStudioSelectedDataset();
  if (!selected) return;
  const name = window.prompt("Column name");
  if (!name || !name.trim()) return;
  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}/columns`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim(), defaultValue: "" }),
  });
  await readApiResponse(response);
  await loadDataStudioDatasets({ keepSelection: true });
  setDataStudioEditorStatus("Column added", "success");
}

async function deleteDataStudioDataset() {
  const selected = getDataStudioSelectedDataset();
  if (!selected) return;
  const confirmed = window.confirm(`Delete dataset \"${selected.name}\"? This cannot be undone.`);
  if (!confirmed) return;
  const response = await fetch(withActiveProjectQuery(`/api/data-studio/datasets/${encodeURIComponent(selected.id)}`), {
    method: "DELETE",
  });
  await readApiResponse(response);
  dataStudioEditorState.selectedDatasetId = null;
  await loadDataStudioDatasets({ keepSelection: false });
  setDataStudioEditorStatus("Dataset deleted", "success");
}

function initDataStudioWorkspace() {
  if (dataStudioEditorState.initialized) return;

  const {
    refreshBtn,
    searchInput,
    datasetList,
    addRowBtn,
    addColBtn,
    deleteDatasetBtn,
    prevBtn,
    nextBtn,
    tableBody,
  } = dataStudioEditorEls();

  refreshBtn?.addEventListener("click", async () => {
    try {
      await loadDataStudioDatasets({ keepSelection: true });
      setDataStudioEditorStatus("Workspace refreshed", "success");
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to refresh", "error");
    }
  });

  searchInput?.addEventListener("input", async () => {
    dataStudioEditorState.query = String(searchInput.value || "").trim();
    dataStudioEditorState.page = 1;
    try {
      await loadDataStudioRows();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Search failed", "error");
    }
  });

  datasetList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-dataset-id]");
    if (!button) return;
    dataStudioEditorState.selectedDatasetId = button.getAttribute("data-dataset-id") || null;
    dataStudioEditorState.page = 1;
    renderDataStudioDatasetList();
    try {
      await loadDataStudioRows();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to load rows", "error");
    }
  });

  addRowBtn?.addEventListener("click", async () => {
    try {
      await addDataStudioRow();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to add row", "error");
    }
  });

  addColBtn?.addEventListener("click", async () => {
    try {
      await addDataStudioColumn();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to add column", "error");
    }
  });

  deleteDatasetBtn?.addEventListener("click", async () => {
    try {
      await deleteDataStudioDataset();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to delete dataset", "error");
    }
  });

  prevBtn?.addEventListener("click", async () => {
    if (dataStudioEditorState.page <= 1) return;
    dataStudioEditorState.page -= 1;
    try {
      await loadDataStudioRows();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to load previous page", "error");
    }
  });

  nextBtn?.addEventListener("click", async () => {
    if (dataStudioEditorState.page >= dataStudioEditorState.totalPages) return;
    dataStudioEditorState.page += 1;
    try {
      await loadDataStudioRows();
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to load next page", "error");
    }
  });

  tableBody?.addEventListener("change", async (event) => {
    const input = event.target.closest(".studio-cell-input");
    if (!input) return;
    const rowId = input.getAttribute("data-row-id") || "";
    const column = input.getAttribute("data-column") || "";
    const nextValue = String(input.value || "");
    const initialValue = String(input.getAttribute("data-initial") || "");
    if (nextValue === initialValue) return;
    try {
      await updateDataStudioCell(rowId, column, nextValue);
      input.setAttribute("data-initial", nextValue);
      setDataStudioEditorStatus("Cell updated", "success");
    } catch (error) {
      input.value = initialValue;
      setDataStudioEditorStatus(error.message || "Failed to update cell", "error");
    }
  });

  tableBody?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-row-delete]");
    if (!button) return;
    const rowId = button.getAttribute("data-row-delete") || "";
    if (!rowId) return;
    try {
      await deleteDataStudioRow(rowId);
    } catch (error) {
      setDataStudioEditorStatus(error.message || "Failed to delete row", "error");
    }
  });

  dataStudioEditorState.initialized = true;
}

async function refreshDataStudioWorkspace() {
  if (!dataStudioEditorState.initialized) return;
  await loadDataStudioDatasets({ keepSelection: true });
}

async function activateDataStudioWorkspace() {
  initDataStudioWorkspace();
  await loadDataStudioDatasets({ keepSelection: true });
}

function setDataStudioStatus(message, level) {
  const activeView = getActiveViewKey();
  if (activeView === "dataset-creator") {
    setDatasetCreatorStatus(message, level);
    return;
  }
  setDataStudioEditorStatus(message, level);
}

/* ── Notebook (inline cell editor) ── */
const nbState = {
  initialized: false,
  loading: false,
  cells: [],
};

function nbSetStatus(msg, level = "") {
  const el = document.getElementById("nb-status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "nb-status-msg";
  if (level === "error") el.classList.add("error");
  else if (level === "success") el.classList.add("success");
}

function nbRenderMarkdown(src) {
  if (typeof marked !== "undefined" && marked.parse) {
    try { return marked.parse(String(src)); } catch { /* fallback */ }
  }
  return escapeHtml(String(src)).replace(/\n/g, "<br>");
}

function nbAutoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.max(textarea.scrollHeight, 48) + "px";
}

function nbRenderCells() {
  const container = document.getElementById("nb-cells");
  if (!container) return;

  if (nbState.cells.length === 0) {
    container.innerHTML = `<div class="nb-empty">No cells yet. Add a code or markdown cell to begin.</div>`;
    return;
  }

  container.innerHTML = "";
  nbState.cells.forEach((cell, index) => {
    const cellEl = document.createElement("div");
    cellEl.className = `nb-cell nb-cell--${cell.type}`;
    cellEl.dataset.cellId = cell.id;

    const isCode = cell.type === "code";
    const execLabel = cell.executionCount != null ? `[${cell.executionCount}]` : "[ ]";
    const statusClass = cell.status === "running" ? " nb-cell--running" : cell.status === "error" ? " nb-cell--error" : "";
    if (statusClass) cellEl.className += statusClass;

    // Cell gutter + badge
    const gutter = document.createElement("div");
    gutter.className = "nb-cell-gutter";
    if (isCode) {
      gutter.innerHTML = `<span class="nb-exec-count">${escapeHtml(execLabel)}</span>`;
    } else {
      gutter.innerHTML = `<span class="nb-cell-badge">MD</span>`;
    }
    cellEl.appendChild(gutter);

    // Cell body
    const body = document.createElement("div");
    body.className = "nb-cell-body";

    // Cell toolbar (per-cell actions)
    const toolbar = document.createElement("div");
    toolbar.className = "nb-cell-actions";
    toolbar.innerHTML = `
      ${isCode ? `<button class="nb-cell-btn nb-run-cell" title="Run cell"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>` : ""}
      <button class="nb-cell-btn nb-move-up" title="Move up" ${index === 0 ? "disabled" : ""}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg></button>
      <button class="nb-cell-btn nb-move-down" title="Move down" ${index === nbState.cells.length - 1 ? "disabled" : ""}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></button>
      <button class="nb-cell-btn nb-delete-cell" title="Delete cell"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
    `;
    body.appendChild(toolbar);

    // Source editor
    const editor = document.createElement("textarea");
    editor.className = "nb-cell-editor";
    editor.spellcheck = false;
    editor.value = cell.source;
    editor.rows = Math.max(cell.source.split("\n").length, 2);
    editor.addEventListener("input", () => {
      nbAutoResize(editor);
    });
    editor.addEventListener("blur", () => {
      if (editor.value !== cell.source) {
        nbUpdateCellSource(cell.id, editor.value);
      }
    });
    // Shift+Enter to run code cell
    if (isCode) {
      editor.addEventListener("keydown", (e) => {
        if (e.shiftKey && e.key === "Enter") {
          e.preventDefault();
          nbUpdateCellSource(cell.id, editor.value).then(() => nbRunCell(cell.id));
        }
      });
    }
    body.appendChild(editor);

    // Output area (code cells only)
    if (isCode && cell.outputs && cell.outputs.length > 0) {
      const outputEl = document.createElement("div");
      outputEl.className = "nb-cell-output";
      const text = cell.outputs.map((o) => o.text || "").join("");
      outputEl.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
      body.appendChild(outputEl);
    }

    // Rendered markdown preview (markdown cells only, collapsed)
    if (!isCode && cell.source.trim()) {
      const preview = document.createElement("div");
      preview.className = "nb-md-preview";
      preview.innerHTML = nbRenderMarkdown(cell.source);
      body.appendChild(preview);
    }

    cellEl.appendChild(body);

    // Wire per-cell button events
    const runBtn = cellEl.querySelector(".nb-run-cell");
    if (runBtn) runBtn.addEventListener("click", () => nbRunCell(cell.id));

    const delBtn = cellEl.querySelector(".nb-delete-cell");
    if (delBtn) delBtn.addEventListener("click", () => nbDeleteCell(cell.id));

    const upBtn = cellEl.querySelector(".nb-move-up");
    if (upBtn) upBtn.addEventListener("click", () => nbMoveCell(cell.id, -1));

    const downBtn = cellEl.querySelector(".nb-move-down");
    if (downBtn) downBtn.addEventListener("click", () => nbMoveCell(cell.id, 1));

    // Add-cell insert button between cells
    const insertBar = document.createElement("div");
    insertBar.className = "nb-insert-bar";
    insertBar.innerHTML = `<button class="nb-insert-btn" title="Insert cell below"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
    insertBar.querySelector(".nb-insert-btn").addEventListener("click", () => nbAddCell("code", cell.id));

    container.appendChild(cellEl);
    container.appendChild(insertBar);
  });

  // Auto-resize all editors
  container.querySelectorAll(".nb-cell-editor").forEach(nbAutoResize);
}

async function nbLoadCells() {
  if (nbState.loading) return;
  nbState.loading = true;
  try {
    const res = await fetch(withActiveProjectQuery("/api/notebook/cells"));
    const data = await readApiResponse(res);
    nbState.cells = Array.isArray(data.cells) ? data.cells : [];
    nbRenderCells();
  } catch (err) {
    nbSetStatus(`⚠ ${err.message || "Failed to load cells"}`, "error");
  } finally {
    nbState.loading = false;
  }
}

async function nbAddCell(type = "code", afterId = null) {
  try {
    const res = await fetch("/api/notebook/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault(), type, source: type === "code" ? "" : "", afterId }),
    });
    await readApiResponse(res);
    await nbLoadCells();
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
  }
}

async function nbUpdateCellSource(cellId, source) {
  try {
    await fetch(withActiveProjectQuery(`/api/notebook/cells/${encodeURIComponent(cellId)}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    // Update local state without full re-render
    const cell = nbState.cells.find((c) => c.id === cellId);
    if (cell) cell.source = source;
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
  }
}

async function nbDeleteCell(cellId) {
  try {
    await fetch(withActiveProjectQuery(`/api/notebook/cells/${encodeURIComponent(cellId)}`), { method: "DELETE" });
    await nbLoadCells();
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
  }
}

async function nbRunCell(cellId) {
  try {
    const cell = nbState.cells.find((c) => c.id === cellId);
    if (cell) cell.status = "running";
    nbRenderCells();

    const res = await fetch(withActiveProjectQuery(`/api/notebook/cells/${encodeURIComponent(cellId)}/run`), {
      method: "POST",
    });
    const data = await readApiResponse(res);
    if (data.cell) {
      nbState.cells = nbState.cells.map((c) => (c.id === data.cell.id ? data.cell : c));
    }
    nbRenderCells();
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
    await nbLoadCells();
  }
}

async function nbRunAll() {
  try {
    nbSetStatus("Running all cells...");
    nbState.cells.forEach(c => {
      if (c.type === "code") c.status = "running";
    });
    nbRenderCells();

    const res = await fetch(withActiveProjectQuery("/api/notebook/run-all"), { method: "POST" });
    const data = await readApiResponse(res);
    nbState.cells = Array.isArray(data.cells) ? data.cells : nbState.cells;
    nbRenderCells();
    nbSetStatus("All cells executed", "success");
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
    await nbLoadCells();
  }
}

async function nbClearOutputs() {
  try {
    const res = await fetch(withActiveProjectQuery("/api/notebook/clear-outputs"), { method: "POST" });
    const data = await readApiResponse(res);
    nbState.cells = Array.isArray(data.cells) ? data.cells : nbState.cells;
    nbRenderCells();
    nbSetStatus("Outputs cleared", "success");
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
  }
}

async function nbMoveCell(cellId, direction) {
  const idx = nbState.cells.findIndex((c) => c.id === cellId);
  if (idx === -1) return;
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= nbState.cells.length) return;

  // Swap locally and re-save order via delete+insert
  const [moved] = nbState.cells.splice(idx, 1);
  nbState.cells.splice(swapIdx, 0, moved);
  nbRenderCells();

  // Persist: delete then re-add at correct position
  try {
    await fetch(withActiveProjectQuery(`/api/notebook/cells/${encodeURIComponent(cellId)}`), { method: "DELETE" });
    const afterId = swapIdx > 0 ? nbState.cells[swapIdx - 1].id : null;
    const res = await fetch("/api/notebook/cells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault(), type: moved.type, source: moved.source, afterId }),
    });
    const data = await readApiResponse(res);
    // Update ID from server
    if (data.cell) {
      nbState.cells[swapIdx] = { ...moved, ...data.cell };
    }
    nbRenderCells();
  } catch (err) {
    nbSetStatus(`⚠ ${err.message}`, "error");
    await nbLoadCells();
  }
}

// === EXPOSE GLOBALS FOR TEMPLATES.JS ===
window.nbState = nbState;
window.nbSetStatus = nbSetStatus;
window.nbLoadCells = nbLoadCells;
window.getActiveProjectIdOrDefault = getActiveProjectIdOrDefault;
window.readApiResponse = readApiResponse;
window.escapeHtml = escapeHtml;
// =======================================

function initNotebookWorkspace() {
  if (nbState.initialized) return;

  const runAllBtn = document.getElementById("nb-run-all-btn");
  const clearBtn = document.getElementById("nb-clear-btn");
  const addCodeBtn = document.getElementById("nb-add-code-btn");
  const addMdBtn = document.getElementById("nb-add-md-btn");
  if (!runAllBtn || !clearBtn || !addCodeBtn || !addMdBtn) return;

  runAllBtn.addEventListener("click", () => nbRunAll());
  clearBtn.addEventListener("click", () => nbClearOutputs());
  addCodeBtn.addEventListener("click", () => nbAddCell("code"));
  addMdBtn.addEventListener("click", () => nbAddCell("markdown"));

  nbState.initialized = true;
}

async function activateNotebookWorkspace() {
  initNotebookWorkspace();
  await nbLoadCells();
}

document.addEventListener("DOMContentLoaded", () => {
  const notebookView = document.getElementById("notebook-view");
  if (notebookView && notebookView.classList.contains("active")) {
    activateNotebookWorkspace();
  }
});

/* ═══════════════════════════════════════════════
   Store — AI Resource Marketplace
   ═══════════════════════════════════════════════ */

const storeState = {
  initialized: false,
  query: "",
  type: "all",       // all | model | dataset | paper | code
  source: "all",     // all | huggingface | github | arxiv | kaggle | paperswithcode | semanticscholar | civitai | zenodo | dblp | ollama | replicate
  sort: "trending",
  page: 1,
  totalPages: 1,
  totalCount: null,
  hasMore: false,
  results: [],
  projectResources: [],
  loading: false,
  selectedResource: null,
  featuredData: null,   // cached storefront sections
  showingFeatured: true, // whether showing storefront vs search results
};

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function getSourceIcon(source) {
  const icons = {
    huggingface: "🤗",
    github: "⌨",
    arxiv: "📄",
    kaggle: "📊",
    paperswithcode: "📝",
    semanticscholar: "🎓",
    civitai: "🎨",
    zenodo: "🔬",
    dblp: "📚",
    ollama: "🦙",
    replicate: "🔄",
  };
  return icons[source] || "🔗";
}

function getSourceLabel(source) {
  const labels = {
    huggingface: "Hugging Face",
    github: "GitHub",
    arxiv: "arXiv",
    kaggle: "Kaggle",
    paperswithcode: "Papers With Code",
    semanticscholar: "Semantic Scholar",
    civitai: "Civitai",
    zenodo: "Zenodo",
    dblp: "DBLP",
    ollama: "Ollama",
    replicate: "Replicate",
  };
  return labels[source] || source;
}

function isResourceAdded(resourceId) {
  return storeState.projectResources.some(r => r.id === resourceId);
}

function storeRenderCard(resource) {
  const added = isResourceAdded(resource.id);
  const metrics = resource.metrics || {};

  let metricsHtml = "";
  if (metrics.downloads != null) {
    metricsHtml += `<span class="store-metric"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${formatNumber(metrics.downloads)}</span>`;
  }
  if (metrics.stars != null) {
    metricsHtml += `<span class="store-metric"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${formatNumber(metrics.stars || metrics.likes)}</span>`;
  }
  if (metrics.citations != null) {
    metricsHtml += `<span class="store-metric"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${formatNumber(metrics.citations)} cited</span>`;
  }
  if (metrics.forks != null) {
    metricsHtml += `<span class="store-metric"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><line x1="12" y1="12" x2="12" y2="15"/></svg> ${formatNumber(metrics.forks)}</span>`;
  }

  const tagsHtml = (resource.tags || []).slice(0, 4).map(t =>
    `<span class="store-tag">${escapeHtml(t)}</span>`
  ).join("");

  const addBtnText = added
    ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Added`
    : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to project`;

  return `
    <div class="store-card" data-resource-id="${escapeHtml(resource.id)}">
      <div class="store-card-head">
        <span class="store-card-source">${getSourceIcon(resource.source)} ${getSourceLabel(resource.source)}</span>
        <span class="store-card-type-badge type-${resource.type}">${resource.type}</span>
      </div>
      <div class="store-card-body" data-action="detail">
        <p class="store-card-title">${escapeHtml(resource.name)}</p>
        <p class="store-card-author">${escapeHtml(resource.author || "")}</p>
        <p class="store-card-desc">${escapeHtml(resource.description || "")}</p>
      </div>
      ${metricsHtml ? `<div class="store-card-metrics">${metricsHtml}</div>` : ""}
      ${tagsHtml ? `<div class="store-card-tags">${tagsHtml}</div>` : ""}
      <div class="store-card-footer">
        <button class="store-add-btn ${added ? "added" : ""}" data-action="add" data-resource-id="${escapeHtml(resource.id)}">${addBtnText}</button>
      </div>
    </div>
  `;
}

function storeRenderGrid() {
  const grid = document.getElementById("store-grid");
  const empty = document.getElementById("store-empty");
  const loading = document.getElementById("store-loading");
  const pagination = document.getElementById("store-pagination");
  const summary = document.getElementById("store-results-summary");
  const featured = document.getElementById("store-featured");

  if (!grid) return;

  loading.style.display = "none";

  // If showing featured storefront (no search query)
  if (storeState.showingFeatured && storeState.featuredData) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "none";
    pagination.style.display = "none";
    summary.style.display = "none";
    if (featured) {
      featured.style.display = "";
      storeRenderFeatured(storeState.featuredData, storeState.type, storeState.source);
    }
    return;
  }

  // Hide featured when showing search results
  if (featured) featured.style.display = "none";

  if (storeState.results.length === 0 && !storeState.query) {
    grid.innerHTML = "";
    empty.style.display = "";
    pagination.style.display = "none";
    summary.style.display = "none";
    return;
  }

  if (storeState.results.length === 0) {
    grid.innerHTML = `
      <div class="coming-soon" style="grid-column: 1 / -1;">
        <h3>No results found</h3>
        <p>Try a different search query or change your filters.</p>
      </div>`;
    empty.style.display = "none";
    pagination.style.display = "none";
    summary.style.display = "flex";
    document.getElementById("store-results-count").textContent = "0 results";
    document.getElementById("store-results-query").textContent = `for "${storeState.query}"`;
    return;
  }

  empty.style.display = "none";
  grid.innerHTML = storeState.results.map(r => storeRenderCard(r)).join("");
  summary.style.display = "flex";
  // Result count text
  if (storeState.totalCount != null) {
    document.getElementById("store-results-count").textContent = `${formatNumber(storeState.totalCount)} results`;
  } else {
    document.getElementById("store-results-count").textContent = `${storeState.results.length}${storeState.hasMore ? "+" : ""} results`;
  }
  document.getElementById("store-results-query").textContent = storeState.query ? `for "${storeState.query}"` : "";

  // Pagination
  // Show if multi-page OR if explicit next page available
  const showPagination = storeState.totalPages > 1 || storeState.hasMore || storeState.page > 1;
  pagination.style.display = showPagination ? "flex" : "none";
  
  if (storeState.totalCount != null) {
    document.getElementById("store-page-label").textContent = `Page ${storeState.page} of ${storeState.totalPages}`;
  } else {
    document.getElementById("store-page-label").textContent = `Page ${storeState.page}`;
  }
  
  document.getElementById("store-prev-btn").disabled = storeState.page <= 1;
  document.getElementById("store-next-btn").disabled = !storeState.hasMore && storeState.page >= storeState.totalPages;
}

/**
 * Render the featured storefront — category cards + trending sections.
 */
function storeRenderFeatured(data, typeFilter, sourceFilter) {
  const container = document.getElementById("store-featured");
  if (!container) return;

  typeFilter = typeFilter || "all";
  sourceFilter = sourceFilter || "all";

  let html = "";

  // Category browsing grid (always shown unless source filter is active)
  if (data.categories && data.categories.length > 0 && sourceFilter === "all") {
    // Filter categories by type if needed
    let cats = data.categories;
    html += `<div class="store-featured-section">
      <h3 class="store-featured-title">🧭 Browse by Category</h3>
      <div class="store-categories-grid">`;
    for (const cat of cats) {
      html += `
        <button class="store-category-card" data-query="${escapeHtml(cat.query)}" style="--cat-color: ${cat.color}">
          <span class="store-category-icon">${cat.icon}</span>
          <span class="store-category-name">${escapeHtml(cat.name)}</span>
        </button>`;
    }
    html += `</div></div>`;
  }

  // Trending sections — apply type and source filters
  let sectionsRendered = 0;
  for (const section of (data.sections || [])) {
    // Filter section by type tab
    if (typeFilter !== "all" && section.category !== typeFilter) continue;

    // Filter items by source
    let items = section.items;
    if (sourceFilter !== "all") {
      items = items.filter(item => item.source === sourceFilter);
    }
    if (items.length === 0) continue;

    sectionsRendered++;
    html += `<div class="store-featured-section">
      <h3 class="store-featured-title">${section.icon} ${escapeHtml(section.title)}</h3>
      <div class="store-featured-scroll">`;
    for (const item of items) {
      // Track items for detail view & add-to-project
      if (!storeState.results.find(r => r.id === item.id)) {
        storeState.results.push(item);
      }
      html += storeRenderCard(item);
    }
    html += `</div></div>`;
  }

  // Show message if filters exclude everything
  if (sectionsRendered === 0 && (typeFilter !== "all" || sourceFilter !== "all")) {
    html += `<div class="store-featured-section" style="text-align:center; padding:32px 0; color: var(--text-dim);">
      <p>No featured content for this filter. Try searching or change filters.</p>
    </div>`;
  }

  container.innerHTML = html;

  // Add click listeners to category cards
  container.querySelectorAll(".store-category-card[data-query]").forEach(card => {
    card.addEventListener("click", () => {
      const q = card.getAttribute("data-query");
      const searchInput = document.getElementById("store-search-input");
      if (searchInput) searchInput.value = q;
      storeState.query = q;
      storeState.showingFeatured = false;
      storeState.page = 1;
      storeSearch();
    });
  });

  // Card interactions within featured sections (delegated on container)
  // Remove prior listeners by re-setting via a single delegated handler
  container.onclick = (e) => {
    const addBtn = e.target.closest("[data-action='add']");
    if (addBtn) {
      e.stopPropagation();
      storeAddToProject(addBtn.getAttribute("data-resource-id"));
      return;
    }
    const card = e.target.closest(".store-card");
    if (card) {
      storeShowDetail(card.getAttribute("data-resource-id"));
    }
  };
}

function storeRenderProjectResources() {
  const section = document.getElementById("store-project-resources");
  const list = document.getElementById("store-project-list");
  const badge = document.getElementById("store-project-count");

  if (!section || !list) return;

  if (storeState.projectResources.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  badge.textContent = storeState.projectResources.length;

  list.innerHTML = storeState.projectResources.map(r => `
    <div class="store-project-item" data-resource-id="${escapeHtml(r.id)}">
      <span class="store-card-type-badge type-${r.type}" style="flex-shrink:0;">${r.type}</span>
      <div class="store-project-item-info">
        <div class="store-project-item-name">${escapeHtml(r.name)}</div>
        <div class="store-project-item-source">${getSourceIcon(r.source)} ${getSourceLabel(r.source)} · ${escapeHtml(r.author || "")}</div>
      </div>
      <button class="store-project-item-remove" data-action="remove" data-resource-id="${escapeHtml(r.id)}">Remove</button>
    </div>
  `).join("");
}

async function storeSearch() {
  if (storeState.loading) return;
  storeState.loading = true;
  storeState.showingFeatured = false;

  const loading = document.getElementById("store-loading");
  const grid = document.getElementById("store-grid");
  const empty = document.getElementById("store-empty");
  const featured = document.getElementById("store-featured");

  if (loading) loading.style.display = "";
  if (grid) grid.innerHTML = "";
  if (empty) empty.style.display = "none";
  if (featured) featured.style.display = "none";

  try {
    const params = new URLSearchParams({
      q: storeState.query,
      type: storeState.type,
      source: storeState.source,
      sort: storeState.sort,
      page: String(storeState.page),
      limit: "12",
    });

    const response = await fetch(`/api/store/search?${params}`);
    const data = await readApiResponse(response);

    storeState.results = data.results || [];
    storeState.totalCount = data.totalCount; // can be null
    storeState.hasMore = data.hasMore || false;
    storeState.totalPages = data.totalPages || 1;
  } catch (err) {
    console.error("Store search failed:", err);
    storeState.results = [];
    storeState.totalCount = null;
    storeState.totalPages = 1;
  } finally {
    storeState.loading = false;
    storeRenderGrid();
  }
}

async function storeAddToProject(resourceId) {
  const resource = storeState.results.find(r => r.id === resourceId);
  if (!resource || isResourceAdded(resourceId)) return;

  try {
    const response = await fetch("/api/store/add-to-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault(), resource }),
    });
    await readApiResponse(response);

    storeState.projectResources.push(resource);

    // Update the Add button in-place without full re-render (preserves scroll & featured layout)
    document.querySelectorAll(`.store-add-btn[data-resource-id="${CSS.escape(resourceId)}"]`).forEach(btn => {
      btn.classList.add("added");
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Added`;
    });
    storeRenderProjectResources();
  } catch (err) {
    console.error("Failed to add resource:", err);
  }
}

async function storeRemoveFromProject(resourceId) {
  try {
    const response = await fetch("/api/store/remove-from-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: getActiveProjectIdOrDefault(), resourceId }),
    });
    await readApiResponse(response);

    storeState.projectResources = storeState.projectResources.filter(r => r.id !== resourceId);

    // Update the Add button back to "Add to project" in-place
    document.querySelectorAll(`.store-add-btn[data-resource-id="${CSS.escape(resourceId)}"]`).forEach(btn => {
      btn.classList.remove("added");
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to project`;
    });
    storeRenderProjectResources();
  } catch (err) {
    console.error("Failed to remove resource:", err);
  }
}

async function storeLoadProjectResources() {
  try {
    const response = await fetch(withActiveProjectQuery("/api/store/project-resources"));
    const data = await readApiResponse(response);
    storeState.projectResources = data.resources || [];
    storeRenderProjectResources();
  } catch (err) {
    console.error("Failed to load project resources:", err);
  }
}

function storeShowDetail(resourceId) {
  const resource = storeState.results.find(r => r.id === resourceId);
  if (!resource) return;

  storeState.selectedResource = resource;
  const modal = document.getElementById("store-detail-modal");
  const metrics = resource.metrics || {};

  document.getElementById("store-detail-source-badge").textContent = `${getSourceIcon(resource.source)} ${getSourceLabel(resource.source)}`;
  document.getElementById("store-detail-title").textContent = resource.name;
  document.getElementById("store-detail-author").textContent = resource.author ? `by ${resource.author}` : "";
  document.getElementById("store-detail-description").textContent = resource.description || "No description available.";
  document.getElementById("store-detail-link").href = resource.url || "#";

  // Metrics
  let metricsHtml = "";
  if (metrics.downloads != null) {
    metricsHtml += `<span class="store-detail-metric"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> <strong>${formatNumber(metrics.downloads)}</strong> downloads</span>`;
  }
  if (metrics.stars != null || metrics.likes != null) {
    metricsHtml += `<span class="store-detail-metric"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> <strong>${formatNumber(metrics.stars || metrics.likes)}</strong> stars</span>`;
  }
  if (metrics.citations != null) {
    metricsHtml += `<span class="store-detail-metric"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> <strong>${formatNumber(metrics.citations)}</strong> citations</span>`;
  }
  if (metrics.forks != null) {
    metricsHtml += `<span class="store-detail-metric"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/><line x1="12" y1="12" x2="12" y2="15"/></svg> <strong>${formatNumber(metrics.forks)}</strong> forks</span>`;
  }
  document.getElementById("store-detail-metrics").innerHTML = metricsHtml;

  // Tags
  document.getElementById("store-detail-tags").innerHTML = (resource.tags || []).map(t =>
    `<span class="store-detail-tag">${escapeHtml(t)}</span>`
  ).join("");

  // Meta
  document.getElementById("store-detail-license").textContent = resource.license ? `License: ${resource.license}` : "";
  document.getElementById("store-detail-updated").textContent = resource.updatedAt ? `Updated: ${new Date(resource.updatedAt).toLocaleDateString()}` : "";

  // Add button state
  const addBtn = document.getElementById("store-detail-add-btn");
  const added = isResourceAdded(resource.id);
  addBtn.innerHTML = added
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Added to project`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to project`;
  addBtn.disabled = added;

  modal.style.display = "";
}

function initStore() {
  if (storeState.initialized) return;
  storeState.initialized = true;

  const searchInput = document.getElementById("store-search-input");
  const searchBtn = document.getElementById("store-search-btn");
  const sortSelect = document.getElementById("store-sort-select");
  const prevBtn = document.getElementById("store-prev-btn");
  const nextBtn = document.getElementById("store-next-btn");
  const detailModal = document.getElementById("store-detail-modal");
  const detailClose = document.getElementById("store-detail-close");
  const detailAddBtn = document.getElementById("store-detail-add-btn");
  const grid = document.getElementById("store-grid");
  const projectList = document.getElementById("store-project-list");

  if (!searchInput || !searchBtn) return;

  // Search
  function doSearch() {
    storeState.query = searchInput.value.trim();
    storeState.showingFeatured = false;
    storeState.page = 1;
    storeSearch();
  }

  searchBtn.addEventListener("click", doSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });

  // Clear search → return to featured storefront
  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim() === "" && !storeState.showingFeatured && storeState.featuredData) {
      storeState.query = "";
      storeState.showingFeatured = true;
      storeState.page = 1;
      storeRenderGrid();
    }
  });

  function shouldShowFeaturedStorefront() {
    return !storeState.query && storeState.type === "all" && storeState.source === "all" && storeState.sort === "trending";
  }

  // Category tabs — always trigger action
  document.querySelectorAll(".store-tab[data-store-type]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".store-tab[data-store-type]").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      storeState.type = tab.getAttribute("data-store-type");
      storeState.page = 1;
      if (shouldShowFeaturedStorefront() && storeState.featuredData) {
        storeState.showingFeatured = true;
        storeRenderGrid();
      } else {
        storeSearch();
      }
    });
  });

  // Source chips — always trigger action
  document.querySelectorAll(".store-source-chip[data-store-source]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".store-source-chip[data-store-source]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      storeState.source = chip.getAttribute("data-store-source");
      storeState.page = 1;
      if (shouldShowFeaturedStorefront() && storeState.featuredData) {
        storeState.showingFeatured = true;
        storeRenderGrid();
      } else {
        storeSearch();
      }
    });
  });

  // Sort — always trigger action
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      storeState.sort = sortSelect.value;
      storeState.page = 1;
      if (shouldShowFeaturedStorefront() && storeState.featuredData) {
        storeState.showingFeatured = true;
        storeRenderGrid();
      } else {
        storeSearch();
      }
    });
  }

  // Pagination
  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (storeState.page > 1) {
      storeState.page--;
      storeSearch();
    }
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (storeState.page < storeState.totalPages) {
      storeState.page++;
      storeSearch();
    }
  });

  // Card interactions (delegated)
  if (grid) grid.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-action='add']");
    if (addBtn) {
      e.stopPropagation();
      const resourceId = addBtn.getAttribute("data-resource-id");
      storeAddToProject(resourceId);
      return;
    }
    const card = e.target.closest(".store-card");
    if (card) {
      storeShowDetail(card.getAttribute("data-resource-id"));
    }
  });

  // Project list interactions
  if (projectList) projectList.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-action='remove']");
    if (removeBtn) {
      storeRemoveFromProject(removeBtn.getAttribute("data-resource-id"));
    }
  });

  // Detail modal
  if (detailClose) detailClose.addEventListener("click", () => {
    detailModal.style.display = "none";
    storeState.selectedResource = null;
  });
  if (detailModal) detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) {
      detailModal.style.display = "none";
      storeState.selectedResource = null;
    }
  });
  if (detailAddBtn) detailAddBtn.addEventListener("click", () => {
    if (storeState.selectedResource) {
      storeAddToProject(storeState.selectedResource.id);
      detailModal.style.display = "none";
      storeState.selectedResource = null;
    }
  });

  // Share button — copies resource URL to clipboard
  const detailShareBtn = document.getElementById("store-detail-share-btn");
  if (detailShareBtn) detailShareBtn.addEventListener("click", async () => {
    const resource = storeState.selectedResource;
    if (!resource || !resource.url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: resource.name, url: resource.url });
      } else {
        await navigator.clipboard.writeText(resource.url);
        const original = detailShareBtn.innerHTML;
        detailShareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => { detailShareBtn.innerHTML = original; }, 1500);
      }
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = resource.url;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      const original = detailShareBtn.innerHTML;
      detailShareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
      setTimeout(() => { detailShareBtn.innerHTML = original; }, 1500);
    }
  });

  // Quick search chips
  document.querySelectorAll(".store-quick-chip[data-query]").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-query");
      searchInput.value = q;
      storeState.query = q;
      storeState.showingFeatured = false;
      storeState.page = 1;
      storeSearch();
    });
  });

  // Load project resources
  storeLoadProjectResources();

  // Auto-load featured storefront
  storeLoadFeatured();
}

/**
 * Load featured/trending content for the storefront (Amazon/Flipkart psychology).
 */
async function storeLoadFeatured() {
  const loading = document.getElementById("store-loading");
  const empty = document.getElementById("store-empty");

  if (loading) loading.style.display = "";
  if (empty) empty.style.display = "none";

  try {
    const response = await fetch("/api/store/featured");
    const data = await readApiResponse(response);
    storeState.featuredData = data;
    storeState.showingFeatured = true;
    storeState.results = []; // clear for fresh featured items
    storeRenderGrid();
  } catch (err) {
    console.error("Failed to load featured content:", err);
    // Fallback: show empty state with quick chips
    if (loading) loading.style.display = "none";
    if (empty) empty.style.display = "";
  }
}

function activateStore() {
  initStore();
  // If search is empty, show featured storefront
  if (!storeState.query && storeState.showingFeatured && storeState.featuredData) {
    storeRenderGrid();
  }
}

// Hook into view navigation
document.addEventListener("DOMContentLoaded", () => {
  const storeView = document.getElementById("store-view");
  if (storeView && storeView.classList.contains("active")) {
    activateStore();
  }
});

/* ── Settings — 3-Tier Field Maps ── */

// tier: "config"  → saved to text2llm.json via POST /api/config
// tier: "local"   → saved to localStorage (Appearance + Web Proxy)
// Supabase account fields are handled separately (no map needed, see loadAccountFromSupabase)

const SETTINGS_FIELD_MAP = {
  // ── Tier: config (text2llm.json) ─────────────────────────────────────
  // Text2LLM Agent
  "setting-agent-model":           { tier: "config", path: ["agents", "defaults", "model", "primary"], type: "text" },
  "setting-agent-workspace":       { tier: "config", path: ["agents", "defaults", "workspace"], type: "text" },
  "setting-tools-profile":         { tier: "config", path: ["tools", "profile"], type: "text" },
  "setting-commands-native":       { tier: "config", path: ["commands", "native"], type: "text" },
  "setting-commands-native-skills":{ tier: "config", path: ["commands", "nativeSkills"], type: "text" },
  // Tools & Execution
  "setting-shell-enabled":         { tier: "config", path: ["env", "shellEnv", "enabled"], type: "bool" },
  "setting-shell-timeout":         { tier: "config", path: ["env", "shellEnv", "timeoutMs"], type: "number" },
  "setting-tools-allow":           { tier: "config", path: ["tools", "alsoAllow"], type: "csv" },
  "setting-tools-deny":            { tier: "config", path: ["tools", "deny"], type: "csv" },
  "setting-browser-enabled":       { tier: "config", path: ["browser", "enabled"], type: "bool" },
  "setting-browser-headless":      { tier: "config", path: ["browser", "headless"], type: "bool" },
  // Skills & Extensions
  "setting-skills-dirs":           { tier: "config", path: ["skills", "load", "extraDirs"], type: "csv" },
  "setting-skills-watch":          { tier: "config", path: ["skills", "load", "watch"], type: "bool" },
  "setting-skills-npm":            { tier: "config", path: ["skills", "install", "nodeManager"], type: "text" },
  // Diagnostics
  "setting-log-level":             { tier: "config", path: ["logging", "level"], type: "text" },
  "setting-log-style":             { tier: "config", path: ["logging", "consoleStyle"], type: "text" },
  "setting-log-redact":            { tier: "config", path: ["logging", "redactSensitive"], type: "text" },
  "setting-otel-enabled":          { tier: "config", path: ["diagnostics", "otel", "enabled"], type: "bool" },

  // ── Tier: local (localStorage) ─────────────────────────────────────
  // Appearance
  "setting-ui-seam":               { tier: "local", lsKey: "text2llm.ui.accentColor", type: "color" },
  "setting-assistant-name":        { tier: "local", lsKey: "text2llm.ui.assistantName", type: "text" },
  "setting-assistant-avatar":      { tier: "local", lsKey: "text2llm.ui.assistantAvatar", type: "text" },
  // Web Proxy
  "setting-proxy-url":             { tier: "local", lsKey: "text2llm.web.proxy.url", type: "text" },
  "setting-proxy-provider":        { tier: "local", lsKey: "text2llm.web.proxy.provider", type: "text" },
  "setting-proxy-api-key":         { tier: "local", lsKey: "text2llm.web.proxy.key", type: "text" },
  "setting-proxy-supabase-token":  { tier: "local", lsKey: "text2llm.web.supabase.access_token", type: "text" },
  "setting-proxy-model":           { tier: "local", lsKey: "text2llm.web.proxy.model", type: "text" },
};

// Skill toggle checkboxes mapped to skills.entries keys (config tier)
const SKILL_TOGGLES = {
  "skill-data-pipeline":    "data-pipeline",
  "skill-tokenizer-trainer":"tokenizer-trainer",
  "skill-model-architect":  "model-architect",
  "skill-gpu-provisioner":  "gpu-provisioner",
  "skill-training-runner":  "training-runner",
  "skill-wandb-tracker":    "wandb-tracker",
  "skill-eval-bench":       "eval-bench",
  "skill-model-publisher":  "model-publisher",
  "skill-cloud-storage":    "cloud-storage",
};


function getNestedValue(obj, pathArr) {
  let current = obj;
  for (const key of pathArr) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, pathArr, value) {
  let current = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const key = pathArr[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[pathArr[pathArr.length - 1]] = value;
}


/* ─────────────────────────────────────────
   Settings Panel — Full Functionality
   ───────────────────────────────────────── */
let _settingsInitialized = false;
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.6/+esm";

let _settingsDirty = false;

function _markSettingsDirty() {
  _settingsDirty = true;
  const saveBtn = document.getElementById("settings-save-btn");
  const statusEl = document.getElementById("settings-save-status");
  if (saveBtn && !saveBtn.disabled) {
    saveBtn.textContent = "Save Preferences ●";
    saveBtn.style.opacity = "1";
  }
  if (statusEl) statusEl.textContent = "";
}

function _markSettingsClean() {
  _settingsDirty = false;
  const saveBtn = document.getElementById("settings-save-btn");
  if (saveBtn) saveBtn.textContent = "Save Preferences";
}

/** Apply accent color to all CSS custom properties that use --primary */
function _applyAccentColor(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  document.documentElement.style.setProperty("--primary", hex);
  // Derive a dimmer version (50% opacity approximation)
  document.documentElement.style.setProperty("--primary-glow", hex + "40");
}

/** Populate a <select> correctly — set value then reflect via option */
function _setSelect(el, value) {
  el.value = value;
  // If no option matched, try case-insensitive
  if (el.value !== String(value)) {
    const lower = String(value).toLowerCase();
    for (const opt of el.options) {
      if (opt.value.toLowerCase() === lower) { opt.selected = true; break; }
    }
  }
}

function populateSettingsFromConfig(data) {
  // data.config = backend text2llm.json config
  const config = data.config || {};

  for (const [elementId, meta] of Object.entries(SETTINGS_FIELD_MAP)) {
    const el = document.getElementById(elementId);
    if (!el) continue;

    let raw;
    if (meta.tier === "local") {
      raw = localStorage.getItem(meta.lsKey) ?? undefined;
    } else {
      raw = getNestedValue(config, meta.path);
    }
    if (raw === undefined || raw === null) continue;

    if (meta.type === "bool") {
      _setSelect(el, raw === true || raw === "true" ? "true" : "false");
    } else if (meta.type === "number") {
      el.value = String(raw);
    } else if (meta.type === "csv") {
      el.value = Array.isArray(raw) ? raw.join(", ") : String(raw);
    } else if (meta.type === "color") {
      el.value = String(raw);
      _applyAccentColor(String(raw));
    } else {
      if (el.tagName === "SELECT") {
        _setSelect(el, String(raw));
      } else {
        el.value = String(raw);
      }
    }
  }

  // Populate skill toggles (always config tier)
  const skillEntries = config?.skills?.entries;
  if (skillEntries && typeof skillEntries === "object") {
    for (const [checkboxId, skillKey] of Object.entries(SKILL_TOGGLES)) {
      const el = document.getElementById(checkboxId);
      if (!el) continue;
      const entry = skillEntries[skillKey];
      el.checked = entry ? !!entry.enabled : false;
    }
  }
}

function collectSettingsToConfig() {
  const configPatch = {};   // → POST /api/config (text2llm.json)

  for (const [elementId, meta] of Object.entries(SETTINGS_FIELD_MAP)) {
    const el = document.getElementById(elementId);
    if (!el) continue;
    const rawValue = el.value.trim();
    if (!rawValue && meta.type !== "bool") continue;

    let parsed;
    if (meta.type === "bool") {
      parsed = rawValue === "true";
    } else if (meta.type === "number") {
      parsed = rawValue ? Number(rawValue) : undefined;
      if (parsed !== undefined && isNaN(parsed)) continue;
    } else if (meta.type === "csv") {
      parsed = rawValue ? rawValue.split(",").map(s => s.trim()).filter(Boolean) : [];
    } else {
      parsed = rawValue || undefined;
    }
    if (parsed === undefined) continue;

    if (meta.tier === "local") {
      // Save to localStorage immediately when collecting
      localStorage.setItem(meta.lsKey, String(parsed));
    } else {
      // tier === "config" → accumulate in patch for the backend
      setNestedValue(configPatch, meta.path, parsed);
    }
  }

  // Collect skill toggles (always config tier)
  for (const [checkboxId, skillKey] of Object.entries(SKILL_TOGGLES)) {
    const el = document.getElementById(checkboxId);
    if (!el) continue;
    setNestedValue(configPatch, ["skills", "entries", skillKey, "enabled"], el.checked);
  }

  return configPatch;
}

/* ── Account (Supabase tier) ── */
async function loadAccountFromSupabase() {
  const statusEl = document.getElementById("account-load-status");
  const token = localStorage.getItem("text2llm.web.supabase.access_token");
  if (!statusEl) return;

  if (!token) {
    statusEl.textContent = "ⓘ Set your Supabase Access Token in the Web Proxy tab to sync account data.";
    statusEl.style.color = "var(--text-dim)";
    return;
  }

  statusEl.textContent = "Loading account…";
  statusEl.style.color = "var(--text-dim)";

  try {
    const res = await fetch("/api/account", {
      headers: { "Authorization": "Bearer " + token }
    });
    const data = await res.json();
    if (data.ok) {
      const el = document.getElementById("setting-account-display-name");
      if (el && data.displayName) el.value = data.displayName;
      const emailEl = document.getElementById("setting-account-email");
      if (emailEl && data.email) emailEl.value = data.email;
      // Populate usage stats
      if (data.usage) {
        const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val ?? "—"; };
        set("account-stat-requests", data.usage.requests?.toLocaleString());
        set("account-stat-input", data.usage.inputTokens?.toLocaleString());
        set("account-stat-output", data.usage.outputTokens?.toLocaleString());
        set("account-stat-errors", data.usage.errors?.toLocaleString());
      }
      statusEl.textContent = "";
    } else {
      statusEl.textContent = "⚠ " + (data.error || "Failed to load account");
      statusEl.style.color = "var(--accent)";
    }
  } catch (err) {
    statusEl.textContent = "⚠ Account unavailable (offline or no proxy configured)";
    statusEl.style.color = "var(--text-dim)";
  }
}

async function saveAccountDisplayName() {
  const nameEl = document.getElementById("setting-account-display-name");
  const statusEl = document.getElementById("account-load-status");
  const token = localStorage.getItem("text2llm.web.supabase.access_token");
  if (!nameEl || !token) return;
  try {
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: nameEl.value.trim() })
    });
    const data = await res.json();
    if (statusEl) {
      statusEl.textContent = data.ok ? "✓ Saved" : "✗ " + (data.error || "Save failed");
      statusEl.style.color = data.ok ? "var(--primary)" : "var(--accent)";
      if (data.ok) setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = "⚠ Save failed"; statusEl.style.color = "var(--accent)"; }
  }
}

/* ── Web Proxy test connection ── */
async function testProxyConnection() {
  const testBtn = document.getElementById("settings-proxy-test-btn");
  const statusEl = document.getElementById("proxy-test-status");
  const proxyUrl = (document.getElementById("setting-proxy-url")?.value || "").trim();

  if (!proxyUrl) {
    if (statusEl) { statusEl.textContent = "⚠ Enter a Proxy URL first"; statusEl.style.color = "var(--accent)"; }
    return;
  }

  if (testBtn) testBtn.disabled = true;
  if (statusEl) { statusEl.textContent = "Testing…"; statusEl.style.color = "var(--text-dim)"; }

  try {
    const res = await fetch(proxyUrl.replace(/\/$/, "") + "/health", { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (statusEl) {
      if (data.ok) {
        statusEl.textContent = `✓ Connected (${data.authMode || "unknown"} auth)`;
        statusEl.style.color = "var(--primary)";
      } else {
        statusEl.textContent = "✗ Proxy returned error";
        statusEl.style.color = "var(--accent)";
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = "✗ " + (err.name === "TimeoutError" ? "Timed out" : "Unreachable");
      statusEl.style.color = "var(--accent)";
    }
  } finally {
    if (testBtn) testBtn.disabled = false;
  }
}

let settingsLoaded = false;

async function loadSettingsConfig() {
  const statusEl = document.getElementById("settings-save-status");
  if (statusEl) { statusEl.textContent = "Loading…"; statusEl.style.color = "var(--text-dim)"; }
  try {
    const response = await fetch("/api/config");
    const data = await readApiResponse(response);
    // Pass the full response object so we can route config vs localStorage
    populateSettingsFromConfig(data);
    settingsLoaded = true;
    _markSettingsClean();
    if (statusEl) statusEl.textContent = "";
    // Also load account if on the account tab or lazily
    loadAccountFromSupabase().catch(() => {});
  } catch (err) {
    console.error("Failed to load settings config:", err);
    if (statusEl) { statusEl.textContent = "⚠ Could not load config"; statusEl.style.color = "var(--accent)"; }
  }
}

async function saveSettingsConfig() {
  const statusEl = document.getElementById("settings-save-status");
  const saveBtn = document.getElementById("settings-save-btn");
  if (statusEl) { statusEl.textContent = "Saving…"; statusEl.style.color = "var(--text-dim)"; }
  if (saveBtn) saveBtn.disabled = true;

  try {
    // collectSettingsToConfig() already writes local-tier fields to localStorage
    const configPatch = collectSettingsToConfig();

    // Save config-tier fields to backend (text2llm.json)
    const response = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configPatch),
    });
    await readApiResponse(response);

    // Also save Account display name if on account tab
    const accountTab = document.querySelector(".settings-nav-btn.active[data-settings-tab='account']");
    if (accountTab) await saveAccountDisplayName();

    _markSettingsClean();
    if (statusEl) {
      statusEl.textContent = "✓ Saved";
      statusEl.style.color = "var(--primary)";
      setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);
    }
    // Re-apply accent in case it changed
    const accentEl = document.getElementById("setting-ui-seam");
    if (accentEl) _applyAccentColor(accentEl.value);
  } catch (err) {
    console.error("Failed to save settings:", err);
    if (statusEl) {
      statusEl.textContent = "✗ " + (err.message || "Save failed");
      statusEl.style.color = "var(--accent)";
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}


function _attachSettingsLiveListeners() {
  // ── Live accent color preview ──
  const accentInput = document.getElementById("setting-ui-seam");
  if (accentInput) {
    accentInput.addEventListener("input", () => {
      _applyAccentColor(accentInput.value);
      _markSettingsDirty();
    });
  }

  // ── Mark dirty on any input/select/checkbox change ──
  const allInputs = document.querySelectorAll(
    "#settings-view input, #settings-view select, #settings-view textarea"
  );
  allInputs.forEach(el => {
    const evtName = el.type === "checkbox" ? "change" : "input";
    if (el === accentInput) return; // already hooked
    el.addEventListener(evtName, _markSettingsDirty);
  });

  // ── Warn on unsaved changes before navigating away ──
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.addEventListener("click", () => {
      const view = item.getAttribute("data-view");
      if (view !== "settings" && _settingsDirty) {
        // Auto-save silently when navigating away
        saveSettingsConfig().catch(() => {});
      }
    });
  });
}

function initSettingsPanel() {
  // Tab navigation
  const navButtons = document.querySelectorAll(".settings-nav-btn[data-settings-tab]");
  const panels = document.querySelectorAll(".settings-panel[id^='settings-panel-']");

  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-settings-tab");
      navButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      panels.forEach(panel => {
        panel.classList.toggle("active", panel.id === `settings-panel-${tabId}`);
      });
    });
  });

  // Save button
  const saveBtn = document.getElementById("settings-save-btn");
  if (saveBtn && !saveBtn._hooked) {
    saveBtn.addEventListener("click", saveSettingsConfig);
    saveBtn._hooked = true;
  }

  // Proxy test button
  const proxyTestBtn = document.getElementById("settings-proxy-test-btn");
  if (proxyTestBtn && !proxyTestBtn._hooked) {
    proxyTestBtn.addEventListener("click", testProxyConnection);
    proxyTestBtn._hooked = true;
  }

  // Load account data when Account tab is clicked
  const accountNavBtn = document.querySelector(".settings-nav-btn[data-settings-tab='account']");
  if (accountNavBtn && !accountNavBtn._accountHooked) {
    accountNavBtn.addEventListener("click", () => loadAccountFromSupabase().catch(() => {}));
    accountNavBtn._accountHooked = true;
  }

  // Attach live listeners once
  if (!_settingsInitialized) {
    _attachSettingsLiveListeners();
    _settingsInitialized = true;
  }

  // Load from backend on first visit
  if (!settingsLoaded) {
    loadSettingsConfig();
  }
}

// Hook settings init into the existing view navigation
(function patchNavForSettings() {
  function maybeInitSettings(view) {
    if (view === "settings") initSettingsPanel();
  }
  document.querySelectorAll(".nav-item[data-view]").forEach(item => {
    item.addEventListener("click", () => maybeInitSettings(item.getAttribute("data-view")));
  });
  document.querySelectorAll(".mobile-tool-btn[data-view], .mobile-tools-sheet-item[data-view]").forEach(item => {
    item.addEventListener("click", () => maybeInitSettings(item.getAttribute("data-view")));
  });
})();

/* ── Model Selector (chat input bar) ── */
(function initModelSelector() {
  const btn      = document.getElementById("model-selector-btn");
  const dropzone = document.getElementById("model-selector-dropdown");
  const label    = document.getElementById("model-selector-label");
  const iconEl   = document.getElementById("model-selector-icon");

  if (!btn || !dropzone) return;

  const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const EMOJI = {
    anthropic:"🔶", openai:"⬛", google:"🌀", openrouter:"🔀",
    groq:"⚡", xai:"𝕏", mistral:"🌪", "github-copilot":"🐙",
    "amazon-bedrock":"☁", ollama:"🦙", together:"🤝", cerebras:"🧠",
    minimax:"〽", moonshot:"🌙", "qwen-portal":"千", venice:"🎭",
    qianfan:"百", zai:"Z", vercel:"▲", cloudflare:"⛅",
    "opencode-zen":"🔮", xiaomi:"🟠", synthetic:"🧪",
  };

  // State
  let allProviders  = [];
  let configuredIds = [];
  let modelCatalog  = {}; // pid -> models array
  let activePid     = null;
  let activeModelId = null;
  let activeModelName = null;
  let saving        = false;
  let modelFilter   = "";

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadData() {
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/instances/providers"),
        fetch("/api/config"),
      ]);
      const { providers = [] } = pRes.ok ? await pRes.json() : {};
      const cfgData = cRes.ok ? await cRes.json() : {};
      const selMap  = cfgData?.config?.web?.providers?.selectedOptionByProvider || {};
      const currentModelId = cfgData?.config?.agents?.defaults?.model?.primary || null;

      allProviders = providers;
      activeModelId = currentModelId;

      const configured = providers.filter(p => p.configured);
      configuredIds = configured.map(p => p.id);

      // Determine active provider
      activePid = null;
      for (const p of configured) {
        if (selMap[p.id]) { activePid = p.id; break; }
      }
      if (!activePid && configured.length > 0) activePid = configured[0].id;

      updateBtnLabel(configured);
    } catch (_) {
      dropzone.innerHTML = '<div class="model-selector-loading">Failed to load</div>';
    }
  }

  async function openAndFetchAll() {
    dropzone.classList.add("open");
    modelFilter = "";
    
    // Show spinner if we don't have catalog data yet
    if (Object.keys(modelCatalog).length === 0) {
      dropzone.innerHTML = '<div class="model-selector-loading">Loading models…</div>';
    } else {
      renderFlatList();
    }

    // Refresh data in background
    await loadData();
    if (configuredIds.length === 0) {
      renderFlatList();
      return;
    }

    // Fetch models for all configured providers concurrently
    try {
      const promises = configuredIds.map(pid => 
        fetch(`/api/instances/provider/${encodeURIComponent(pid)}/models`)
          .then(res => res.ok ? res.json() : { models: [] })
          .then(data => ({ pid, models: data.models, currentModel: data.currentModel }))
          .catch(() => ({ pid, models: [], currentModel: null }))
      );
      
      const results = await Promise.all(promises);
      let needsFullRender = false;

      for (const res of results) {
        if (res.currentModel && activeModelId === null) {
          activeModelId = res.currentModel;
          needsFullRender = true;
        }
        modelCatalog[res.pid] = res.models;
      }
      
      if (needsFullRender) updateBtnLabel(allProviders.filter(p => p.configured));
      renderFlatList();
    } catch (_) {
      if (Object.keys(modelCatalog).length === 0) {
        dropzone.innerHTML = '<div class="model-selector-loading">Failed to load models</div>';
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function updateBtnLabel(configured) {
    const activeP = configured.find(p => p.id === activePid);
    if (activeP) {
      if (activeModelId) {
        const parts = activeModelId.split("/");
        activeModelName = parts[parts.length - 1];
        label.textContent = activeModelName;
        // See if we can find the provider for this model to show the correct icon
        let foundPid = activePid;
        for (const pid of Object.keys(modelCatalog)) {
          if (modelCatalog[pid].some(m => m.id === activeModelId)) {
            foundPid = pid; break;
          }
        }
        iconEl.textContent = EMOJI[foundPid] || "✦";
      } else {
        label.textContent = activeP.name;
        iconEl.textContent = EMOJI[activeP.id] || "✦";
      }
      btn.classList.add("active");
    } else {
      label.textContent = "Model";
      iconEl.textContent = "✦";
      btn.classList.remove("active");
    }
  }

  function renderFlatList() {
    const configured = allProviders.filter(p => p.configured);

    if (configured.length === 0) {
      dropzone.innerHTML = `
        <div class="model-selector-empty">
          No providers configured.<br>
          <a href="#" id="ms-go-infra">Go to Infra → AI</a>
        </div>`;
      dropzone.querySelector("#ms-go-infra")?.addEventListener("click", e => {
        e.preventDefault(); closeDropdown();
        (document.querySelector('.nav-item[data-view="instances"]') ||
         document.querySelector('.mobile-tool-btn[data-view="instances"]'))?.click();
      });
      return;
    }

    let html = `
      <div class="ms-search-wrap" style="padding-top: 6px;">
        <input class="ms-search-input" id="ms-model-search" type="text" placeholder="Search models…" value="${esc(modelFilter)}">
      </div>
      <div class="ms-model-list">
    `;

    let totalMatches = 0;

    for (const pid of configuredIds) {
      const pName = (allProviders.find(p => p.id === pid) || {}).name || pid;
      const models = modelCatalog[pid] || [];
      
      const filtered = modelFilter
        ? models.filter(m => (m.name+m.id+m.desc).toLowerCase().includes(modelFilter.toLowerCase()))
        : models;

      if (filtered.length > 0) {
        totalMatches += filtered.length;
        html += `
          <div class="ms-provider-group">
            <div class="ms-provider-header">
              ${esc(EMOJI[pid] || "✦")} ${esc(pName)}
            </div>
        `;

        for (const m of filtered) {
          const isCurrent = m.id === activeModelId;
          const reasoningBadge = m.reasoning ? '<span class="ms-reasoning-badge">🧠</span>' : "";
          html += `
            <button class="model-selector-item${isCurrent ? " selected" : ""}"
                    data-pid="${esc(pid)}" data-model-id="${esc(m.id)}" data-model-name="${esc(m.name)}" type="button">
              <span class="model-item-info">
                <span class="model-item-name">${esc(m.name)}${reasoningBadge}</span>
                <span class="model-item-desc">${esc(m.desc || m.id)}</span>
              </span>
              <span class="model-item-check">✓</span>
            </button>`;
        }
        html += `</div>`; // end ms-provider-group
      }
    }

    if (totalMatches === 0) {
      html += `<div class="model-selector-empty">${modelFilter ? "No matches found" : "No models available"}</div>`;
    }

    html += `</div>`; // end ms-model-list
    dropzone.innerHTML = html;

    // Search input
    const searchInput = dropzone.querySelector("#ms-model-search");
    if (searchInput) {
      searchInput.focus();
      // Restore cursor position if there's text
      if (modelFilter) searchInput.setSelectionRange(modelFilter.length, modelFilter.length);
      
      searchInput.addEventListener("input", () => {
        modelFilter = searchInput.value;
        renderFlatList();
      });
      searchInput.addEventListener("click", e => e.stopPropagation());
    }

    // Model items
    dropzone.querySelectorAll(".model-selector-item[data-model-id]").forEach(el => {
      el.addEventListener("click", async () => {
        if (saving) return;
        const mid = el.dataset.modelId;
        const mname = el.dataset.modelName || mid;
        const pid = el.dataset.pid;

        saving = true;
        activeModelId = mid;
        activeModelName = mname;

        // Select the appropriate provider backend active choice if needed
        const providerData = allProviders.find(p => p.id === pid);
        if (providerData && activePid !== pid) {
           activePid = pid;
           const oid = providerData.selectedOptionId || "api";
           try {
             await fetch("/api/instances/provider/select", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ providerId: pid, optionId: oid }),
             });
           } catch(_) {}
        }

        // Set the specific model
        try {
          await fetch("/api/instances/provider/set-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: mid }),
          });
        } catch(_) {}

        updateBtnLabel(allProviders.filter(p => p.configured));
        closeDropdown();
        saving = false;
      });
    });
  }

  // ── Dropdown open/close ────────────────────────────────────────────────────

  function closeDropdown() {
    dropzone.classList.remove("open");
  }

  btn.addEventListener("click", e => {
    e.stopPropagation();
    dropzone.classList.contains("open") ? closeDropdown() : openAndFetchAll();
  });

  document.addEventListener("click", e => {
    if (!btn.contains(e.target) && !dropzone.contains(e.target)) {
      closeDropdown();
    }
  });

  // Reload when user visits Infra
  document.querySelectorAll('.nav-item[data-view="instances"], .mobile-tool-btn[data-view="instances"]')
    .forEach(el => el.addEventListener("click", () => setTimeout(loadData, 800)));

  // Initial load
  loadData();
})();

/* ── Auth Modal Logic ── */
(function initAuthModal() {
  const authModal = document.getElementById("auth-modal");
  const authModalClose = document.getElementById("auth-modal-close");
  const sidebarProfile = document.getElementById("sidebar-user-profile");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const signinBtn = document.getElementById("auth-signin-btn");
  const signupBtn = document.getElementById("auth-signup-btn");
  const errorMsg = authModal ? authModal.querySelector("#auth-error-msg") : null;
  const successMsg = authModal ? authModal.querySelector("#auth-success-msg") : null;

  const btnGoogle = document.getElementById("auth-google-btn");
  const btnDiscord = document.getElementById("auth-discord-btn");
  const btnGithub = document.getElementById("auth-github-btn");
  const btnFacebook = document.getElementById("auth-facebook-btn");
  const btnGuest = document.getElementById("auth-guest-btn");

  let supabaseClient = null;

  if (!authModal) return;

  function setError(message) {
    if (errorMsg) errorMsg.textContent = message;
  }

  function setSuccess(message) {
    if (successMsg) successMsg.textContent = message;
  }

  let turnstileWidgetId = null;

  function openModal() {
    authModal.style.display = "flex";
    setError("");
    setSuccess("");
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
    // Render or reset Turnstile
    if (window.turnstile) {
      if (turnstileWidgetId != null) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (_) {}
      } else {
        try {
          turnstileWidgetId = window.turnstile.render("#turnstile-widget", {
            sitekey: "0x4AAAAAACgflp_3ZM1kH8RG"
          });
        } catch (_) {}
      }
    }
  }

  function closeModal() {
    authModal.style.display = "none";
  }

  // Profile Modal Elements
  const profileModal = document.getElementById("profile-modal");
  const profileModalClose = document.getElementById("profile-modal-close");
  const profileSignoutBtn = document.getElementById("profile-signout-btn");
  const profileSettingsBtn = document.getElementById("profile-settings-btn");
  const profileGuestWarning = document.getElementById("profile-guest-warning");
  const profileTabs = document.querySelectorAll(".profile-tab[data-ptab]");
  const profilePanels = document.querySelectorAll(".profile-tab-content[id^='ptab-']");
  
  function openProfileModal() {
    profileModal.style.display = "flex";
    populateProfileModal();
  }

  function closeProfileModal() {
    profileModal.style.display = "none";
  }

  function populateProfileModal() {
    const token = localStorage.getItem("text2llm.web.supabase.access_token");
    const isGuest = token === "guest-session";
    
    // UI Elements
    const nameEl = document.getElementById("profile-modal-name");
    const usernameEl = document.getElementById("profile-modal-username");
    const avatarEl = document.getElementById("profile-modal-avatar");
    const metaEl = document.getElementById("profile-modal-meta");
    const bioEl = document.getElementById("profile-modal-bio");
    
    if (isGuest) {
      nameEl.textContent = "Guest User";
      usernameEl.textContent = "guest_account";
      metaEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Temporary Session`;
      avatarEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      bioEl.textContent = "Quietly working away as a guest. All data is stored locally and will be lost on exit.";
      profileGuestWarning.style.display = "flex";
      return;
    }

    // Authenticated user
    profileGuestWarning.style.display = "none";
    if (supabaseClient) {
      supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          const name = user.user_metadata?.full_name || user.user_metadata?.name || "Logged In User";
          const username = user.email?.split('@')[0] || "user";
          const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
          const joinedDate = user.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : "recently";
          
          nameEl.textContent = name;
          usernameEl.textContent = username;
          metaEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Joined ${joinedDate}`;
          bioEl.textContent = "Quietly working away";
          
          if (avatar) {
            avatarEl.innerHTML = `<img src="${avatar}" alt="Avatar" class="profile-avatar-img">`;
          } else {
             avatarEl.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
          }
        }
      }).catch(e => console.warn(e));
    }
  }

  // Profile Modal Event Listeners
  if (profileModalClose) profileModalClose.addEventListener("click", closeProfileModal);
  if (profileModal) profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) closeProfileModal();
  });
  
  if (profileSettingsBtn) profileSettingsBtn.addEventListener("click", () => {
    closeProfileModal();
    document.querySelector('.nav-item[data-view="settings"]')?.click();
  });

  if (profileSignoutBtn) profileSignoutBtn.addEventListener("click", () => {
    // Only sign out if confirmed
    if (confirm("Are you sure you want to sign out?")) {
      localStorage.removeItem("text2llm.web.supabase.access_token");
      window.location.reload();
    }
  });

  profileTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      profileTabs.forEach(b => b.classList.remove("active"));
      profilePanels.forEach(p => p.classList.remove("active"));
      
      btn.classList.add("active");
      const targetId = `ptab-${btn.getAttribute("data-ptab")}`;
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });


  if (sidebarProfile) {
    sidebarProfile.addEventListener("click", () => {
      const token = localStorage.getItem("text2llm.web.supabase.access_token");
      if (token) {
        openProfileModal();
      } else {
        openModal();
      }
    });
  }

  if (authModalClose) {
    authModalClose.addEventListener("click", closeModal);
  }

  if (authModal) {
    authModal.addEventListener("click", (e) => {
      if (e.target === authModal) {
        closeModal();
      }
    });
  }

  function getTurnstileToken() {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value : null;
  }

  async function handleAuth(action) {
    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";
    const captchaToken = getTurnstileToken();

    setError("");
    setSuccess("");

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    if (!captchaToken) {
      setError("Please complete the CAPTCHA.");
      return;
    }

    const endpoint = action === "signup" ? "/api/auth/signup" : "/api/auth/login";
    
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captchaToken })
      });
      
      const data = await res.json();
      
      if (!data.ok) {
        setError(data.error || "Authentication failed.");
        return;
      }
      
      const token = data.session?.access_token;
      if (token) {
        localStorage.setItem("text2llm.web.supabase.access_token", token);
        setSuccess("Successfully authenticated!");
        setTimeout(() => {
          closeModal();
          window.location.reload();
        }, 1000);
      } else {
        setSuccess("Check your email for confirmation.");
        setTimeout(() => closeModal(), 2000);
      }
    } catch (err) {
      setError("Network error occurred.");
    }
  }

  async function handleOAuth(provider) {
    if (!supabaseClient) {
      setError("Supabase client not initialized. Check SUPABASE_URL and SUPABASE_ANON_KEY on the server.");
      return;
    }
    
    setError("");
    setSuccess("Redirecting to " + provider + "...");
    
    try {
      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: window.location.origin
        }
      });
      
      if (error) {
        setError(error.message);
        setSuccess("");
        return;
      }

      if (data?.url) {
        window.location.assign(data.url);
      }
    } catch (err) {
      setError("Failed to start OAuth flow.");
      setSuccess("");
    }
  }

  // Load Supabase configuration
  async function initSupabase() {
    try {
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("Supabase SDK not available in window scope");
        return;
      }

      const res = await fetch("/api/config");
      const data = await res.json();
      if (data.ok && data.supabaseUrl && data.supabaseAnonKey) {
          supabaseClient = supabase.createClient(data.supabaseUrl, data.supabaseAnonKey);
          
          // Check if we are returning from an OAuth redirect
          const { data: sessionData, error } = await supabaseClient.auth.getSession();
          if (sessionData && sessionData.session) {
             const token = sessionData.session.access_token;
             if (token && !localStorage.getItem("text2llm.web.supabase.access_token")) {
                 localStorage.setItem("text2llm.web.supabase.access_token", token);
                 
                 // Clean up the URL hash
                 if (window.history.replaceState) {
                     history.replaceState(null, null, window.location.pathname + window.location.search);
                 }
                 window.location.reload();
             }
          }
          
          updateSidebarProfile();
      } else {
          console.warn("Supabase OAuth not configured: missing SUPABASE_URL or SUPABASE_ANON_KEY");
      }
    } catch (e) {
      console.warn("Failed to initialize Supabase client for OAuth:", e);
    }
  }
  
  initSupabase();

  function handleGuestLogin() {
    localStorage.setItem("text2llm.web.supabase.access_token", "guest-session");
    setSuccess("Signed in as Guest!");
    setTimeout(() => {
      closeModal();
      window.location.reload();
    }, 1000);
  }

  if (signinBtn) signinBtn.addEventListener("click", () => handleAuth("login"));
  if (signupBtn) signupBtn.addEventListener("click", () => handleAuth("signup"));
  
  if (btnGoogle) btnGoogle.addEventListener("click", () => handleOAuth("google"));
  if (btnDiscord) btnDiscord.addEventListener("click", () => handleOAuth("discord"));
  if (btnGithub) btnGithub.addEventListener("click", () => handleOAuth("github"));
  if (btnFacebook) btnFacebook.addEventListener("click", () => handleOAuth("facebook"));
  if (btnGuest) btnGuest.addEventListener("click", handleGuestLogin);
  
  async function updateSidebarProfile() {
      const token = localStorage.getItem("text2llm.web.supabase.access_token");
      if (!token) return;

      const userNameEl = sidebarProfile.querySelector(".user-name");
      const userPlanEl = sidebarProfile.querySelector(".user-plan");
      const avatarContainer = sidebarProfile.querySelector(".avatar");
      
      if (token === "guest-session") {
          if (userNameEl) userNameEl.textContent = "Guest";
          if (userPlanEl) {
              userPlanEl.textContent = "Changes may be lost";
              userPlanEl.style.color = "var(--accent)";
          }
          if (avatarContainer) {
              avatarContainer.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
          }
          return;
      }
      
      if (supabaseClient) {
          try {
              const { data: { user } } = await supabaseClient.auth.getUser();
              if (user) {
                  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || "Logged In";
                  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
                  
                  if (userNameEl) userNameEl.textContent = name;
                  if (userPlanEl) {
                      userPlanEl.textContent = "Authenticated";
                      userPlanEl.style.color = "var(--text-dim)";
                  }
                  if (avatarContainer && avatar) {
                      avatarContainer.innerHTML = `<img src="${avatar}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                      avatarContainer.style.overflow = "hidden";
                  }
              }
          } catch(e) {
              console.warn("Could not fetch user profile", e);
          }
      } else {
          // Fallback if supabase client not yet loaded but token exists
          if (userNameEl) userNameEl.textContent = "Logged In";
      }
  }

  // Update sidebar on load
  updateSidebarProfile();
})();
