---
summary: "CLI reference for `text2llm agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `text2llm agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
text2llm agents list
text2llm agents add work --workspace ~/.text2llm/workspace-work
text2llm agents set-identity --workspace ~/.text2llm/workspace --from-identity
text2llm agents set-identity --agent main --avatar avatars/text2llm.png
text2llm agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.text2llm/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
text2llm agents set-identity --workspace ~/.text2llm/workspace --from-identity
```

Override fields explicitly:

```bash
text2llm agents set-identity --agent main --name "text2llm" --emoji "🦞" --avatar avatars/text2llm.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "text2llm",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/text2llm.png",
        },
      },
    ],
  },
}
```
