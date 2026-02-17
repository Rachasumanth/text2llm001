---
summary: "CLI reference for `text2llm plugins` (list, install, uninstall, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `text2llm plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/tools/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
text2llm plugins list
text2llm plugins info <id>
text2llm plugins enable <id>
text2llm plugins disable <id>
text2llm plugins uninstall <id>
text2llm plugins doctor
text2llm plugins update <id>
text2llm plugins update --all
```

Bundled plugins ship with text2llm but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `text2llm.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
text2llm plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
text2llm plugins install -l ./my-plugin
```

### Uninstall

```bash
text2llm plugins uninstall <id>
text2llm plugins uninstall <id> --dry-run
text2llm plugins uninstall <id> --keep-files
```

`uninstall` removes plugin records from `plugins.entries`, `plugins.installs`,
the plugin allowlist, and linked `plugins.load.paths` entries when applicable.
For active memory plugins, the memory slot resets to `memory-core`.

By default, uninstall also removes the plugin install directory under the active
state dir extensions root (`$TEXT2LLM_STATE_DIR/extensions/<id>`). Use
`--keep-files` to keep files on disk.

`--keep-config` is supported as a deprecated alias for `--keep-files`.

### Update

```bash
text2llm plugins update <id>
text2llm plugins update --all
text2llm plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
