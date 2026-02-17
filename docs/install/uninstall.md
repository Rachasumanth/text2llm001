---
summary: "Uninstall text2llm completely (CLI, service, state, workspace)"
read_when:
  - You want to remove text2llm from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `text2llm` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
text2llm uninstall
```

Non-interactive (automation / npx):

```bash
text2llm uninstall --all --yes --non-interactive
npx -y text2llm uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
text2llm gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
text2llm gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${TEXT2LLM_STATE_DIR:-$HOME/.text2llm}"
```

If you set `TEXT2LLM_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.text2llm/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g text2llm
pnpm remove -g text2llm
bun remove -g text2llm
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/text2llm.app
```

Notes:

- If you used profiles (`--profile` / `TEXT2LLM_PROFILE`), repeat step 3 for each state dir (defaults are `~/.text2llm-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `text2llm` is missing.

### macOS (launchd)

Default label is `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.text2llm.*` may still exist):

```bash
launchctl bootout gui/$UID/bot.molt.gateway
rm -f ~/Library/LaunchAgents/bot.molt.gateway.plist
```

If you used a profile, replace the label and plist name with `bot.molt.<profile>`. Remove any legacy `com.text2llm.*` plists if present.

### Linux (systemd user unit)

Default unit name is `text2llm-gateway.service` (or `text2llm-gateway-<profile>.service`):

```bash
systemctl --user disable --now text2llm-gateway.service
rm -f ~/.config/systemd/user/text2llm-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `text2llm Gateway` (or `text2llm Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "text2llm Gateway"
Remove-Item -Force "$env:USERPROFILE\.text2llm\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.text2llm-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://text2llm.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g text2llm@latest`.
Remove it with `npm rm -g text2llm` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `text2llm ...` / `bun run text2llm ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
