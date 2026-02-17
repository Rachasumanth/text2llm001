---
summary: "CLI reference for `text2llm logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `text2llm logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
text2llm logs
text2llm logs --follow
text2llm logs --json
text2llm logs --limit 500
text2llm logs --local-time
text2llm logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
