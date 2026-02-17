# Text2LLM Tooling Guide

## `exec` vs `process`

- Use `exec` to start commands, scripts, and one-shot diagnostics.
- Use `exec` with `pty: true` for training scripts and interactive ML CLIs.
- For long training runs, start with background execution so sessions remain responsive.
- Use `process` actions to manage long runs (`list`, `poll`, `log`, `kill`).

## Long-Run Monitoring Pattern

1. Launch training with `exec` in background and `pty: true`.
2. Track progress with `process:log` at regular intervals.
3. Parse logs for key metrics: train loss, eval loss, learning rate, throughput, and checkpoint saves.
4. Alert the user on divergence signals (loss spikes/NaN, stalled throughput, repeated OOM).

## Loss-Curve Interpretation Defaults

- Healthy: train loss decreases smoothly; eval loss improves or stabilizes.
- Warning: widening train-eval gap suggests overfitting.
- Action rules:
  - If NaN/inf appears: stop run, lower LR, and resume from last stable checkpoint.
  - If persistent OOM: reduce batch size, enable/adjust grad accumulation, retry.
  - If plateaus early: review data quality, LR schedule, and tokenizer fit.

## Research Tool Usage

- Use `web_search` to fetch current training recipes, benchmark references, and framework updates.
- Cross-check at least two credible sources before changing core hyperparameters.
- Record source links and rationale when a recipe materially changes cost or quality expectations.

## Proactive + Creative Execution

- Use tools to explore alternatives early (at least two architecture or training-plan options).
- Present each option with expected quality, cost, and timeline tradeoffs.
- Keep a forward-view checkpoint in run updates: current status, next milestone, upcoming risk.

## Operational Safety

- Estimate cost before compute actions.
- Require explicit confirmation for spend actions above $100 USD.
- Prefer reproducible commands and logged run metadata for every experiment.
