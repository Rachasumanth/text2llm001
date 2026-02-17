---
name: boot-md
description: "Run BOOT.md on gateway startup"
homepage: https://docs.text2llm.ai/hooks#boot-md
metadata:
  {
    "text2llm":
      {
        "emoji": "🚀",
        "events": ["gateway:startup"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with text2llm" }],
      },
  }
---

# Boot Checklist Hook

Runs `BOOT.md` every time the gateway starts, if the file exists in the workspace.
