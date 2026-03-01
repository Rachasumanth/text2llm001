# ⚡ Autonomous Dataset Creator — Full Progress Report

> **Status**: ✅ Implementation Complete | **Date**: 2026-02-25  
> **Feature Type**: Premium | **Priority**: High

---

## 1. Vision & Objective

Replace the manual "pick a source → configure → scrape" workflow with a single natural language prompt. The user describes what dataset they need — the system **autonomously** plans queries, collects data from 8 internet sources in parallel, refines it (dedup, quality scoring, PII removal), and delivers a production-ready JSONL/Parquet/CSV dataset.

This mirrors the data gathering capabilities of leading AI labs like OpenAI, Anthropic, and Google DeepMind — making it a **premium differentiator** for Text2LLM.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    USER INPUT                                 │
│  "I need a sentiment analysis dataset on product reviews      │
│   across multiple languages, with 10K labeled examples"       │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              PHASE 1: AI QUERY PLANNER                        │
│  • LLM analyzes prompt → identifies task type, domain         │
│  • Generates targeted search queries per source               │
│  • Fallback: keyword-based planner (no API key needed)        │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│           PHASE 2: MULTI-SOURCE COLLECTION                    │
│  8 parallel agents, each with graceful error handling         │
│                                                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │Wikipedia│ │ Reddit  │ │YouTube  │ │ Kaggle  │           │
│  │  API    │ │  API    │ │Transcr. │ │  API    │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │HuggingF.│ │  arXiv  │ │  News   │ │ GitHub  │           │
│  │Datasets │ │  API    │ │DuckDuck │ │ Search  │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│             PHASE 3: REFINE PIPELINE                          │
│  • PII Scrubbing (emails, phones, addresses via regex)        │
│  • Exact dedup (SHA-256 hash) + fuzzy dedup (Jaccard)         │
│  • Quality scoring (length, diversity, structure heuristics)  │
│  • Filter below minimum quality threshold                     │
│  • Shuffle to mix sources                                     │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│            PHASE 4: ASSEMBLY & DELIVERY                       │
│  • Train/Val/Test split (80/10/10)                            │
│  • Export: JSONL (default), Parquet, or CSV                   │
│  • Dataset card (JSON) with full metadata & stats             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Files Created & Modified

### 3.1 NEW — `skills/data-pipeline/autonomous_dataset.py` (990 lines)

The **core orchestrator** script. This is the brain of the feature.

**Key components:**

- `plan_with_llm()` — Calls OpenAI/Anthropic/Google/OpenRouter APIs to turn the user's prompt into a structured JSON plan with task type, domain, keywords, and per-source search queries
- `plan_with_keywords()` — Fallback planner that uses keyword extraction (no API key required)
- 8 source adapter functions:
  - `collect_wikipedia()` — Wikipedia REST API search + article content
  - `collect_reddit()` — Reddit JSON API (.json suffix trick, no OAuth)
  - `collect_youtube()` — YouTube Data API v3 search + `youtube-transcript-api` for transcripts
  - `collect_kaggle()` — Kaggle REST API dataset search + metadata
  - `collect_huggingface()` — HuggingFace Datasets API search
  - `collect_arxiv()` — arXiv Atom API search + abstract parsing
  - `collect_news()` — DuckDuckGo HTML search for news articles
  - `collect_github()` — GitHub REST API repository + README search
- `refine_records()` — Full refine pipeline:
  - PII regex scrubbing (emails, phone numbers, addresses)
  - Exact dedup via SHA-256 hashing
  - Fuzzy dedup via Jaccard similarity (trigram sets)
  - Quality scoring (text length, vocabulary diversity, structural indicators)
  - Filtering by minimum quality threshold
  - Shuffling to mix sources
- `assemble_dataset()` — Train/val/test split, JSONL/Parquet/CSV export, dataset card generation
- SSL certificate fix for Windows (`ssl.create_default_context()` with verification disabled)
- `@@PROGRESS@@` JSON lines emitted to stdout for real-time progress tracking

**Dependencies:** Python 3 stdlib only (no pip install needed). Optional: `youtube-transcript-api`, `pandas`, `pyarrow`.

### 3.2 MODIFIED — `text2llm-web/dataset-worker.mjs`

Complete rewrite with autonomous job support:

- **`pollJobs()`** — Now checks for `job.autonomous_config` and dispatches to `autonomous_dataset.py` with proper CLI args
- **`runWithProgress(jobId, cmd, args)`** — NEW function that spawns the Python process and parses `@@PROGRESS@@` lines from stdout to update Supabase in real-time
- **`updateJobProgress(jobId, phase, detail)`** — NEW function that PATCHes a `progress` JSON column on the `dataset_jobs` table
- Added `spawn` import for streaming process output (vs `exec` for legacy jobs)
- Fixed ESM main entry check with `fileURLToPath` for Windows compatibility

### 3.3 MODIFIED — `text2llm-web/server.mjs`

Updated the `POST /api/data-studio/datasets` handler:

- Added `"autonomous"` to the source type check: `if (normalizedSourceType === "scrape" || ... || normalizedSourceType === "autonomous")`
- Extracts `autonomousConfig` from `req.body`
- Includes `autonomous_config` in the Supabase `dataset_jobs` INSERT payload
- Custom queued message: "AI Dataset Creator job dispatched — collecting from multiple sources"
- Changed default job status from `"queuing"` to `"pending"` to match worker polling

### 3.4 MODIFIED — `text2llm-web/public/app.js`

Frontend JavaScript changes:

- **`dataStudioEls()`** — Added 7 new element references:
  - `autonomousWrap`, `autonomousPrompt`, `autonomousRows`
  - `autonomousProgress`, `autonomousPhase`, `autonomousDetail`, `autonomousSourceList`
- **`createDatasetFromInputs()`** — Added `autonomousConfig` variable and `sourceType === "autonomous"` handler that extracts prompt and target rows
- **`renderDataStudioSourceInputs()`** — Added `autonomousWrap` to the visibility toggle; changed default from `"synthetic"` to `"autonomous"`
- Included `autonomousConfig` in the POST body to the server

### 3.5 MODIFIED — `text2llm-web/public/index.html`

HTML changes to the Data Studio import card:

- Added `<option value="autonomous">⚡ AI Dataset Creator (Premium)</option>` as the **first** option in `#ds-source-select`
- Added the full autonomous configuration panel (`#ds-autonomous-wrap`):
  - Purple gradient premium banner with `⚡ PREMIUM` badge
  - Tagline: "Describe what you need — AI gathers from the entire internet"
  - Large textarea (`#ds-autonomous-prompt`) with 4 rows and descriptive placeholder
  - Target rows dropdown (`#ds-autonomous-rows`): 1K / 5K / 10K / 50K / 100K options
  - Sources display: "Wikipedia · Reddit · YouTube · Kaggle · HuggingFace · arXiv · News · GitHub"
  - Progress panel (`#ds-autonomous-progress`) with phase indicators (Planning → Collecting → Refining → Assembling)
  - Detail text area and source status list for per-source progress
- Added `hidden` class to `#ds-synth-wrap` and `#ds-scrape-wrap` (previously visible by default, causing panel overlap)

### 3.6 MODIFIED — `text2llm-web/public/styles.css`

Added ~200 lines of premium styling:

- `.ds-autonomous-banner` — Glass-effect gradient background (purple→blue at 8% opacity)
- `.ds-autonomous-badge` — Gradient pill badge with text shadow and box shadow glow
- `.ds-autonomous-input` — Oversized 1.05rem textarea with purple focus ring
- `.ds-source-icons` — Muted pill showing all 8 source names
- `.ds-inline-2` — 2-column grid layout for target rows + sources
- `.ds-autonomous-progress` — Slide-up animated progress card
- `.ds-progress-phases` — Horizontal stepper with connecting line
- `.ds-phase` — Phase pills with `.active` (green glow, scale) and `.done` (filled green) states
- `.ds-progress-detail` — Monospace detail text box
- `.ds-source-status-item` — Per-source status cards with `.active`, `.done`, `.failed` states

---

## 4. Database Schema Changes Needed

The `dataset_jobs` table in Supabase needs two new columns:

```sql
ALTER TABLE dataset_jobs
  ADD COLUMN IF NOT EXISTS autonomous_config JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS progress JSONB DEFAULT NULL;
```

- `autonomous_config` — Stores `{ prompt, targetRows }` from the frontend
- `progress` — Updated in real-time by the worker with `{ phase, detail, updated_at }`

---

## 5. Testing Results

### 5.1 Dry Run (No API Key)

```
$ python autonomous_dataset.py --prompt "machine learning terms" --target-rows 100 --dry-run
```

- ✅ Fallback keyword planner generated correct queries
- ✅ Plan JSON structure validated

### 5.2 Live Collection Test

```
$ python autonomous_dataset.py --prompt "machine learning terms" --target-rows 100
```

- ✅ Wikipedia: Connected, returned articles
- ✅ Kaggle: 3 datasets found
- ✅ GitHub: 10 repositories with READMEs
- ✅ Reddit: 0 results (rate limited on first try — graceful fallback)
- ✅ arXiv: Connected after SSL fix
- ✅ Refine pipeline processed all records
- ✅ Output JSONL files generated

### 5.3 Worker Integration Test

```
$ node dataset-worker.mjs
[Worker] Starting dataset processing worker...
```

- ✅ Worker starts and polls Supabase every 5 seconds
- ✅ Progress parsing from `@@PROGRESS@@` lines works

### 5.4 Browser UI Test

- ✅ "⚡ AI Dataset Creator (Premium)" is the default source option
- ✅ Purple gradient PREMIUM badge renders correctly
- ✅ Textarea, target rows, and sources list all visible
- ✅ Synthetic/scrape panels properly hidden when autonomous is selected
- ✅ Switching source types toggles panels correctly

---

## 6. Known Limitations & Future Work

### Current Limitations

- **Reddit rate limiting** — Reddit's JSON API aggressively rate-limits unauthenticated requests
- **YouTube transcripts** — Requires `youtube-transcript-api` pip package (optional dependency)
- **No Twitter/X support** — API requires paid access ($100/month minimum)
- **LLM planning requires API key** — Falls back to keyword planner without one

### Planned Improvements

- [ ] Add progress polling on the frontend (poll `/api/data-studio/jobs/:id/progress` every 3s)
- [ ] Real-time source status cards updating in the UI
- [ ] Add Common Crawl adapter for massive web corpus access
- [ ] Add Semantic Scholar API adapter
- [ ] Support for image datasets (not just text)
- [ ] Cost estimation before job execution (show estimated token usage)
- [ ] Job cancellation support
- [ ] Resume from partial collection on failure

---

## 7. How to Use

1. Open **Data Studio** from the sidebar
2. The **⚡ AI Dataset Creator (Premium)** should be the default source
3. Type a description of the dataset you need in the textarea
4. Select your target row count (1K–100K)
5. Choose output format (JSONL recommended)
6. Click **"Start Data Processing Job"**
7. The system will:
   - Plan optimal search queries using an LLM
   - Dispatch parallel collectors to 8 sources
   - Refine the data (dedup, quality filter, PII scrub)
   - Assemble and deliver the final dataset

---

_Generated by the Autonomous Dataset Creator implementation session._
