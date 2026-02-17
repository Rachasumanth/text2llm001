---
summary: "CLI reference for `text2llm voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `text2llm voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
text2llm voicecall status --call-id <id>
text2llm voicecall call --to "+15555550123" --message "Hello" --mode notify
text2llm voicecall continue --call-id <id> --message "Any questions?"
text2llm voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
text2llm voicecall expose --mode serve
text2llm voicecall expose --mode funnel
text2llm voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
