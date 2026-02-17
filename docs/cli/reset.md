---
summary: "CLI reference for `text2llm reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `text2llm reset`

Reset local config/state (keeps the CLI installed).

```bash
text2llm reset
text2llm reset --dry-run
text2llm reset --scope config+creds+sessions --yes --non-interactive
```
