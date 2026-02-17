# Text2LLM Dock <!-- omit in toc -->

Stop typing `docker-compose` commands. Just type `Text2LLM Dock-start`.

Inspired by Simon Willison's [Running text2llm in Docker](https://til.simonwillison.net/llms/text2llm-docker).

- [Quickstart](#quickstart)
- [Available Commands](#available-commands)
  - [Basic Operations](#basic-operations)
  - [Container Access](#container-access)
  - [Web UI \& Devices](#web-ui--devices)
  - [Setup \& Configuration](#setup--configuration)
  - [Maintenance](#maintenance)
  - [Utilities](#utilities)
- [Common Workflows](#common-workflows)
  - [Check Status and Logs](#check-status-and-logs)
  - [Set Up WhatsApp Bot](#set-up-whatsapp-bot)
  - [Troubleshooting Device Pairing](#troubleshooting-device-pairing)
  - [Fix Token Mismatch Issues](#fix-token-mismatch-issues)
  - [Permission Denied](#permission-denied)
- [Requirements](#requirements)

## Quickstart

**Install:**

```bash
mkdir -p ~/.Text2LLM Dock && curl -sL https://raw.githubusercontent.com/text2llm/text2llm/main/scripts/shell-helpers/Text2LLM Dock-helpers.sh -o ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh
```

```bash
echo 'source ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

**See what you get:**

```bash
Text2LLM Dock-help
```

On first command, Text2LLM Dock auto-detects your text2llm directory:

- Checks common paths (`~/text2llm`, `~/workspace/text2llm`, etc.)
- If found, asks you to confirm
- Saves to `~/.Text2LLM Dock/config`

**First time setup:**

```bash
Text2LLM Dock-start
```

```bash
Text2LLM Dock-fix-token
```

```bash
Text2LLM Dock-dashboard
```

If you see "pairing required":

```bash
Text2LLM Dock-devices
```

And approve the request for the specific device:

```bash
Text2LLM Dock-approve <request-id>
```

## Available Commands

### Basic Operations

| Command            | Description                     |
| ------------------ | ------------------------------- |
| `Text2LLM Dock-start`   | Start the gateway               |
| `Text2LLM Dock-stop`    | Stop the gateway                |
| `Text2LLM Dock-restart` | Restart the gateway             |
| `Text2LLM Dock-status`  | Check container status          |
| `Text2LLM Dock-logs`    | View live logs (follows output) |

### Container Access

| Command                   | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `Text2LLM Dock-shell`          | Interactive shell inside the gateway container |
| `Text2LLM Dock-cli <command>`  | Run text2llm CLI commands                      |
| `Text2LLM Dock-exec <command>` | Execute arbitrary commands in the container    |

### Web UI & Devices

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `Text2LLM Dock-dashboard`    | Open web UI in browser with authentication |
| `Text2LLM Dock-devices`      | List device pairing requests               |
| `Text2LLM Dock-approve <id>` | Approve a device pairing request           |

### Setup & Configuration

| Command              | Description                                       |
| -------------------- | ------------------------------------------------- |
| `Text2LLM Dock-fix-token` | Configure gateway authentication token (run once) |

### Maintenance

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `Text2LLM Dock-rebuild` | Rebuild the Docker image                         |
| `Text2LLM Dock-clean`   | Remove all containers and volumes (destructive!) |

### Utilities

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `Text2LLM Dock-health`    | Run gateway health check                  |
| `Text2LLM Dock-token`     | Display the gateway authentication token  |
| `Text2LLM Dock-cd`        | Jump to the text2llm project directory    |
| `Text2LLM Dock-config`    | Open the text2llm config directory        |
| `Text2LLM Dock-workspace` | Open the workspace directory              |
| `Text2LLM Dock-help`      | Show all available commands with examples |

## Common Workflows

### Check Status and Logs

**Restart the gateway:**

```bash
Text2LLM Dock-restart
```

**Check container status:**

```bash
Text2LLM Dock-status
```

**View live logs:**

```bash
Text2LLM Dock-logs
```

### Set Up WhatsApp Bot

**Shell into the container:**

```bash
Text2LLM Dock-shell
```

**Inside the container, login to WhatsApp:**

```bash
text2llm channels login --channel whatsapp --verbose
```

Scan the QR code with WhatsApp on your phone.

**Verify connection:**

```bash
text2llm status
```

### Troubleshooting Device Pairing

**Check for pending pairing requests:**

```bash
Text2LLM Dock-devices
```

**Copy the Request ID from the "Pending" table, then approve:**

```bash
Text2LLM Dock-approve <request-id>
```

Then refresh your browser.

### Fix Token Mismatch Issues

If you see "gateway token mismatch" errors:

```bash
Text2LLM Dock-fix-token
```

This will:

1. Read the token from your `.env` file
2. Configure it in the text2llm config
3. Restart the gateway
4. Verify the configuration

### Permission Denied

**Ensure Docker is running and you have permission:**

```bash
docker ps
```

## Requirements

- Docker and Docker Compose installed
- Bash or Zsh shell
- text2llm project (from `docker-setup.sh`)

## Development

**Test with fresh config (mimics first-time install):**

```bash
unset Text2LLM Dock_DIR && rm -f ~/.Text2LLM Dock/config && source scripts/shell-helpers/Text2LLM Dock-helpers.sh
```

Then run any command to trigger auto-detect:

```bash
Text2LLM Dock-start
```

