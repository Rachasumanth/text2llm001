---
summary: "CLI reference for `text2llm config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `text2llm config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `text2llm configure`).

## Examples

```bash
text2llm config get browser.executablePath
text2llm config set browser.executablePath "/usr/bin/google-chrome"
text2llm config set agents.defaults.heartbeat.every "2h"
text2llm config set agents.list[0].tools.exec.node "node-id-or-name"
text2llm config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
text2llm config get agents.defaults.workspace
text2llm config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
text2llm config get agents.list
text2llm config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
text2llm config set agents.defaults.heartbeat.every "0m"
text2llm config set gateway.port 19001 --json
text2llm config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
