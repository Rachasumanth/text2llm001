---
summary: "CLI reference for `text2llm health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
title: "health"
---

# `text2llm health`

Fetch health from the running Gateway.

```bash
text2llm health
text2llm health --json
text2llm health --verbose
```

Notes:

- `--verbose` runs live probes and prints per-account timings when multiple accounts are configured.
- Output includes per-agent session stores when multiple agents are configured.
