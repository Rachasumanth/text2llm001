# Text2LLM — Step-by-Step Implementation (5 Parts)

> Divided from [implementation_plan.md.resolved](file:///c:/Users/4HIN/source/text2llm/implementation_plan.md.resolved)

---

## Part 1 — Agent Identity & Configuration

> _Foundation layer: define WHO the agent is and HOW it's configured._

- [ ] Create `workspace/AGENTS.md` — Text2LLM agent identity
  - [ ] Role definition ("You are Text2LLM, a virtual AI lab agent…")
  - [ ] Pipeline-aware instructions (Data → Tokenizer → Arch → Train → Eval → Publish)
  - [ ] Safety constraints (cost estimates, spend confirmations > $100)
  - [ ] Tool preferences (`exec` with `pty:true` for training scripts)
- [ ] Create `workspace/SOUL.md` — Personality & behavioral guidelines
  - [ ] Senior ML engineer voice
  - [ ] Data quality warnings
  - [ ] Cost estimate protocol
  - [ ] Reference model citations (TinyLlama, SmolLM, DeepSeek V3)
- [ ] Create `workspace/TOOLS.md` — Tool usage guidance for ML workflows
  - [ ] `exec` vs `process` guidance (background for long runs)
  - [ ] Monitoring via `process:log` + loss curve parsing
  - [ ] `web_search` for latest training recipes
- [ ] Create `workspace/text2llm.json` — Configuration
  - [ ] Set tool profile to `coding`
  - [ ] Enable `group:web`, `browser`, `group:fs`, `group:runtime`, `group:memory`
  - [ ] Deny `group:messaging`, `group:nodes`, `group:automation`, `canvas`, `cron`, `gateway`
  - [ ] Set `skills.allowBundled: []` (disable all 52 generic skills)
  - [ ] Add all 9 skill entries with env var placeholders

---

## Part 2 — Core Data Skills (3 Skills)

> _Data preparation pipeline: gathering, cleaning, and tokenizing training data._

- [ ] Create `workspace/skills/data-pipeline/SKILL.md`
  - [ ] YAML frontmatter (name, description)
  - [ ] Text extraction instructions (`trafilatura` / `resiliparse`)
  - [ ] MinHash deduplication via `datasketch`
  - [ ] Quality filtering (FineWeb-Edu approach)
  - [ ] PII removal instructions
  - [ ] Domain balancing strategy
  - [ ] Python dependency list
- [ ] Create `workspace/skills/tokenizer-trainer/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] BPE via HuggingFace `tokenizers` or `sentencepiece`
  - [ ] Configurable vocab size (32K–50K)
  - [ ] Special tokens: `<BOS>`, `<EOS>`, `<PAD>`, `<UNK>`
  - [ ] HF-compatible output format
- [ ] Create `workspace/skills/model-architect/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] Architecture templates by scale (100M → 7B+)
  - [ ] Component selection: GQA, SwiGLU, RoPE, RMSNorm
  - [ ] HuggingFace Transformers-compatible `config.json` output
  - [ ] Parameter count & memory requirement calculator

---

## Part 3 — Training & Compute Skills (3 Skills)

> _GPU provisioning, training execution, and experiment tracking._

- [ ] Create `workspace/skills/gpu-provisioner/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] Provider CLIs/APIs (RunPod, Vast.ai, Lambda)
  - [ ] Cheapest instance finder logic
  - [ ] Cost estimation before provisioning
  - [ ] **Explicit user confirmation** gate for any spend
  - [ ] SSH key setup & instance management
  - [ ] Auto-termination timers
  - [ ] Env requirements: `RUNPOD_API_KEY`, `VAST_API_KEY`
- [ ] Create `workspace/skills/training-runner/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] Training script generation (cosine LR, gradient clipping, mixed precision)
  - [ ] Background execution via `exec` (`background:true`, `pty:true`)
  - [ ] Live monitoring via `process:log` + loss parsing
  - [ ] Multi-phase training (broad → curated → domain → cooldown)
  - [ ] Checkpoint management
  - [ ] Framework support: NanoGPT, LitGPT, HF Trainer
- [ ] Create `workspace/skills/wandb-tracker/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] W&B run initialization (project/entity/tags)
  - [ ] Metric logging (loss, LR, throughput)
  - [ ] Artifact versioning (checkpoints & datasets)
  - [ ] Run comparison for hyperparameter tuning
  - [ ] Env: `WANDB_API_KEY`

---

## Part 4 — Evaluation & Publishing Skills (2 Skills)

> _Benchmark the model and ship it to the world._

- [ ] Create `workspace/skills/eval-bench/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] lm-evaluation-harness integration (MMLU, HellaSwag, ARC, etc.)
  - [ ] Ragas for RAG evaluation
  - [ ] Perplexity measurement
  - [ ] Human-readable report generation
- [ ] Create `workspace/skills/model-publisher/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] Checkpoint → SafeTensors conversion
  - [ ] Auto-generated model card (README.md + training details)
  - [ ] HuggingFace Hub push via `huggingface-cli`
  - [ ] Optional GGUF quantization for local inference
  - [ ] Env: `HF_TOKEN`

---

## Part 5 — Cloud Storage Skill & Verification

> _Persist artifacts to user cloud storage, then validate everything end-to-end._

- [ ] Create `workspace/skills/cloud-storage/SKILL.md`
  - [ ] YAML frontmatter
  - [ ] Google Drive support (`pydrive2`, OAuth 2.0)
  - [ ] Dropbox support (`dropbox` SDK, OAuth 2.0 PKCE)
  - [ ] OneDrive support (`msal` + Microsoft Graph, OAuth 2.0)
  - [ ] MEGA support (`mega.py`, session auth)
  - [ ] User-side OAuth flow (agent never stores provider credentials)
  - [ ] Standard project path: `Text2LLM/<project>/{data,tokenizer,checkpoints,evals,model}/`
  - [ ] Automatic checkpoint syncing after each training checkpoint
  - [ ] Resumable uploads for large files
  - [ ] Per-project provider selection (remembered across sessions)
  - [ ] Quota awareness (check space, warn if low)
- [ ] **Verification — Automated**
  - [ ] Run `pnpm install` in text2llm root
  - [ ] Run `pnpm test -- --grep "skill"` — validate SKILL.md parsing
  - [ ] Run `pnpm text2llm doctor` — validate config
- [ ] **Verification — Manual**
  - [ ] Run `pnpm text2llm gateway --verbose` — confirm 9 skills loaded, 0 bundled
  - [ ] Send test prompt: "Build me a 100M parameter LLM for medical text" — verify agent uses AI lab skills
  - [ ] Verify `python3 --version` and `pip --version` are accessible
