#!/usr/bin/env bash
# Text2LLM Dock - Docker helpers for text2llm
# Inspired by Simon Willison's "Running text2llm in Docker"
# https://til.simonwillison.net/llms/text2llm-docker
#
# Installation:
#   mkdir -p ~/.Text2LLM Dock && curl -sL https://raw.githubusercontent.com/text2llm/text2llm/main/scripts/shell-helpers/Text2LLM Dock-helpers.sh -o ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh
#   echo 'source ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh' >> ~/.zshrc
#
# Usage:
#   Text2LLM Dock-help    # Show all available commands

# =============================================================================
# Colors
# =============================================================================
_CLR_RESET='\033[0m'
_CLR_BOLD='\033[1m'
_CLR_DIM='\033[2m'
_CLR_GREEN='\033[0;32m'
_CLR_YELLOW='\033[1;33m'
_CLR_BLUE='\033[0;34m'
_CLR_MAGENTA='\033[0;35m'
_CLR_CYAN='\033[0;36m'
_CLR_RED='\033[0;31m'

# Styled command output (green + bold)
_clr_cmd() {
  echo -e "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# Inline command for use in sentences
_cmd() {
  echo "#!/usr/bin/env bash
# Text2LLM Dock - Docker helpers for text2llm
# Inspired by Simon Willison's "Running text2llm in Docker"
# https://til.simonwillison.net/llms/text2llm-docker
#
# Installation:
#   mkdir -p ~/.Text2LLM Dock && curl -sL https://raw.githubusercontent.com/text2llm/text2llm/main/scripts/shell-helpers/Text2LLM Dock-helpers.sh -o ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh
#   echo 'source ~/.Text2LLM Dock/Text2LLM Dock-helpers.sh' >> ~/.zshrc
#
# Usage:
#   Text2LLM Dock-help    # Show all available commands

# =============================================================================
# Colors
# =============================================================================
_CLR_RESET='\033[0m'
_CLR_BOLD='\033[1m'
_CLR_DIM='\033[2m'
_CLR_GREEN='\033[0;32m'
_CLR_YELLOW='\033[1;33m'
_CLR_BLUE='\033[0;34m'
_CLR_MAGENTA='\033[0;35m'
_CLR_CYAN='\033[0;36m'
_CLR_RED='\033[0;31m'

# Styled command output (green + bold)
_clr_cmd() {
  echo -e "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# Inline command for use in sentences
_cmd() {
  echo "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# =============================================================================
# Config
# =============================================================================
Text2LLM Dock_CONFIG="${HOME}/.Text2LLM Dock/config"

# Common paths to check for text2llm
Text2LLM Dock_COMMON_PATHS=(
  "${HOME}/text2llm"
  "${HOME}/workspace/text2llm"
  "${HOME}/projects/text2llm"
  "${HOME}/dev/text2llm"
  "${HOME}/code/text2llm"
  "${HOME}/src/text2llm"
)

_Text2LLM Dock_filter_warnings() {
  grep -v "^WARN\|^time="
}

_Text2LLM Dock_trim_quotes() {
  local value="$1"
  value="${value#\"}"
  value="${value%\"}"
  printf "%s" "$value"
}

_Text2LLM Dock_read_config_dir() {
  if [[ ! -f "$Text2LLM Dock_CONFIG" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^Text2LLM Dock_DIR=//p' "$Text2LLM Dock_CONFIG" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _Text2LLM Dock_trim_quotes "$raw"
}

# Ensure Text2LLM Dock_DIR is set and valid
_Text2LLM Dock_ensure_dir() {
  # Already set and valid?
  if [[ -n "$Text2LLM Dock_DIR" && -f "${Text2LLM Dock_DIR}/docker-compose.yml" ]]; then
    return 0
  fi

  # Try loading from config
  local config_dir
  config_dir=$(_Text2LLM Dock_read_config_dir)
  if [[ -n "$config_dir" && -f "${config_dir}/docker-compose.yml" ]]; then
    Text2LLM Dock_DIR="$config_dir"
    return 0
  fi

  # Auto-detect from common paths
  local found_path=""
  for path in "${Text2LLM Dock_COMMON_PATHS[@]}"; do
    if [[ -f "${path}/docker-compose.yml" ]]; then
      found_path="$path"
      break
    fi
  done

  if [[ -n "$found_path" ]]; then
    echo ""
    echo "🦞 Found text2llm at: $found_path"
    echo -n "   Use this location? [Y/n] "
    read -r response
    if [[ "$response" =~ ^[Nn] ]]; then
      echo ""
      echo "Set Text2LLM Dock_DIR manually:"
      echo "  export Text2LLM Dock_DIR=/path/to/text2llm"
      return 1
    fi
    Text2LLM Dock_DIR="$found_path"
  else
    echo ""
    echo "❌ text2llm not found in common locations."
    echo ""
    echo "Clone it first:"
    echo ""
    echo "  git clone https://github.com/text2llm/text2llm.git ~/text2llm"
    echo "  cd ~/text2llm && ./docker-setup.sh"
    echo ""
    echo "Or set Text2LLM Dock_DIR if it's elsewhere:"
    echo ""
    echo "  export Text2LLM Dock_DIR=/path/to/text2llm"
    echo ""
    return 1
  fi

  # Save to config
  if [[ ! -d "${HOME}/.Text2LLM Dock" ]]; then
    /bin/mkdir -p "${HOME}/.Text2LLM Dock"
  fi
  echo "Text2LLM Dock_DIR=\"$Text2LLM Dock_DIR\"" > "$Text2LLM Dock_CONFIG"
  echo "✅ Saved to $Text2LLM Dock_CONFIG"
  echo ""
  return 0
}

# Wrapper to run docker compose commands
_Text2LLM Dock_compose() {
  _Text2LLM Dock_ensure_dir || return 1
  command docker compose -f "${Text2LLM Dock_DIR}/docker-compose.yml" "$@"
}

_Text2LLM Dock_read_env_token() {
  _Text2LLM Dock_ensure_dir || return 1
  if [[ ! -f "${Text2LLM Dock_DIR}/.env" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^TEXT2LLM_GATEWAY_TOKEN=//p' "${Text2LLM Dock_DIR}/.env" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _Text2LLM Dock_trim_quotes "$raw"
}

# Basic Operations
Text2LLM Dock-start() {
  _Text2LLM Dock_compose up -d text2llm-gateway
}

Text2LLM Dock-stop() {
  _Text2LLM Dock_compose down
}

Text2LLM Dock-restart() {
  _Text2LLM Dock_compose restart text2llm-gateway
}

Text2LLM Dock-logs() {
  _Text2LLM Dock_compose logs -f text2llm-gateway
}

Text2LLM Dock-status() {
  _Text2LLM Dock_compose ps
}

# Navigation
Text2LLM Dock-cd() {
  _Text2LLM Dock_ensure_dir || return 1
  cd "${Text2LLM Dock_DIR}"
}

Text2LLM Dock-config() {
  cd ~/.text2llm
}

Text2LLM Dock-workspace() {
  cd ~/.text2llm/workspace
}

# Container Access
Text2LLM Dock-shell() {
  _Text2LLM Dock_compose exec text2llm-gateway \
    bash -c 'echo "alias text2llm=\"./text2llm.mjs\"" > /tmp/.bashrc_TEXT2LLM && bash --rcfile /tmp/.bashrc_TEXT2LLM'
}

Text2LLM Dock-exec() {
  _Text2LLM Dock_compose exec text2llm-gateway "$@"
}

Text2LLM Dock-cli() {
  _Text2LLM Dock_compose run --rm text2llm-cli "$@"
}

# Maintenance
Text2LLM Dock-rebuild() {
  _Text2LLM Dock_compose build text2llm-gateway
}

Text2LLM Dock-clean() {
  _Text2LLM Dock_compose down -v --remove-orphans
}

# Health check
Text2LLM Dock-health() {
  _Text2LLM Dock_ensure_dir || return 1
  local token
  token=$(_Text2LLM Dock_read_env_token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${Text2LLM Dock_DIR}/.env"
    return 1
  fi
  _Text2LLM Dock_compose exec -e "TEXT2LLM_GATEWAY_TOKEN=$token" text2llm-gateway \
    node dist/index.js health
}

# Show gateway token
Text2LLM Dock-token() {
  _Text2LLM Dock_read_env_token
}

# Fix token configuration (run this once after setup)
Text2LLM Dock-fix-token() {
  _Text2LLM Dock_ensure_dir || return 1

  echo "🔧 Configuring gateway token..."
  local token
  token=$(Text2LLM Dock-token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${Text2LLM Dock_DIR}/.env"
    return 1
  fi

  echo "📝 Setting token: ${token:0:20}..."

  _Text2LLM Dock_compose exec -e "TOKEN=$token" text2llm-gateway \
    bash -c './text2llm.mjs config set gateway.remote.token "$TOKEN" && ./text2llm.mjs config set gateway.auth.token "$TOKEN"' 2>&1 | _Text2LLM Dock_filter_warnings

  echo "🔍 Verifying token was saved..."
  local saved_token
  saved_token=$(_Text2LLM Dock_compose exec text2llm-gateway \
    bash -c "./text2llm.mjs config get gateway.remote.token 2>/dev/null" 2>&1 | _Text2LLM Dock_filter_warnings | tr -d '\r\n' | head -c 64)

  if [[ "$saved_token" == "$token" ]]; then
    echo "✅ Token saved correctly!"
  else
    echo "⚠️  Token mismatch detected"
    echo "   Expected: ${token:0:20}..."
    echo "   Got: ${saved_token:0:20}..."
  fi

  echo "🔄 Restarting gateway..."
  _Text2LLM Dock_compose restart text2llm-gateway 2>&1 | _Text2LLM Dock_filter_warnings

  echo "⏳ Waiting for gateway to start..."
  sleep 5

  echo "✅ Configuration complete!"
  echo -e "   Try: $(_cmd Text2LLM Dock-devices)"
}

# Open dashboard in browser
Text2LLM Dock-dashboard() {
  _Text2LLM Dock_ensure_dir || return 1

  echo "🦞 Getting dashboard URL..."
  local output status url
  output=$(_Text2LLM Dock_compose run --rm text2llm-cli dashboard --no-open 2>&1)
  status=$?
  url=$(printf "%s\n" "$output" | _Text2LLM Dock_filter_warnings | grep -o 'http[s]\?://[^[:space:]]*' | head -n 1)
  if [[ $status -ne 0 ]]; then
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd Text2LLM Dock-restart)"
    return 1
  fi

  if [[ -n "$url" ]]; then
    echo "✅ Opening: $url"
    open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo "   Please open manually: $url"
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see 'pairing required' error:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd Text2LLM Dock-devices)"
    echo "   2. Copy the Request ID from the Pending table"
    echo -e "   3. Run: $(_cmd 'Text2LLM Dock-approve <request-id>')"
  else
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd Text2LLM Dock-restart)"
  fi
}

# List device pairings
Text2LLM Dock-devices() {
  _Text2LLM Dock_ensure_dir || return 1

  echo "🔍 Checking device pairings..."
  local output status
  output=$(_Text2LLM Dock_compose exec text2llm-gateway node dist/index.js devices list 2>&1)
  status=$?
  printf "%s\n" "$output" | _Text2LLM Dock_filter_warnings
  if [ $status -ne 0 ]; then
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see token errors above:${_CLR_RESET}"
    echo -e "   1. Verify token is set: $(_cmd Text2LLM Dock-token)"
    echo "   2. Try manual config inside container:"
    echo -e "      $(_cmd Text2LLM Dock-shell)"
    echo -e "      $(_cmd 'text2llm config get gateway.remote.token')"
    return 1
  fi

  echo ""
  echo -e "${_CLR_CYAN}💡 To approve a pairing request:${_CLR_RESET}"
  echo -e "   $(_cmd 'Text2LLM Dock-approve <request-id>')"
}

# Approve device pairing request
Text2LLM Dock-approve() {
  _Text2LLM Dock_ensure_dir || return 1

  if [[ -z "$1" ]]; then
    echo -e "❌ Usage: $(_cmd 'Text2LLM Dock-approve <request-id>')"
    echo ""
    echo -e "${_CLR_CYAN}💡 How to approve a device:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd Text2LLM Dock-devices)"
    echo "   2. Find the Request ID in the Pending table (long UUID)"
    echo -e "   3. Run: $(_cmd 'Text2LLM Dock-approve <that-request-id>')"
    echo ""
    echo "Example:"
    echo -e "   $(_cmd 'Text2LLM Dock-approve 6f9db1bd-a1cc-4d3f-b643-2c195262464e')"
    return 1
  fi

  echo "✅ Approving device: $1"
  _Text2LLM Dock_compose exec text2llm-gateway \
    node dist/index.js devices approve "$1" 2>&1 | _Text2LLM Dock_filter_warnings

  echo ""
  echo "✅ Device approved! Refresh your browser."
}

# Show all available Text2LLM Dock helper commands
Text2LLM Dock-help() {
  echo -e "\n${_CLR_BOLD}${_CLR_CYAN}🦞 Text2LLM Dock - Docker Helpers for text2llm${_CLR_RESET}\n"

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚡ Basic Operations${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-start)       ${_CLR_DIM}Start the gateway${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-stop)        ${_CLR_DIM}Stop the gateway${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-restart)     ${_CLR_DIM}Restart the gateway${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-status)      ${_CLR_DIM}Check container status${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-logs)        ${_CLR_DIM}View live logs (follows)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🐚 Container Access${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-shell)       ${_CLR_DIM}Shell into container (text2llm alias ready)${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-cli)         ${_CLR_DIM}Run CLI commands (e.g., Text2LLM Dock-cli status)${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-exec) ${_CLR_CYAN}<cmd>${_CLR_RESET}  ${_CLR_DIM}Execute command in gateway container${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🌐 Web UI & Devices${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-dashboard)   ${_CLR_DIM}Open web UI in browser ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-devices)     ${_CLR_DIM}List device pairings ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-approve) ${_CLR_CYAN}<id>${_CLR_RESET} ${_CLR_DIM}Approve device pairing ${_CLR_CYAN}(with examples)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚙️  Setup & Configuration${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-fix-token)   ${_CLR_DIM}Configure gateway token ${_CLR_CYAN}(run once)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🔧 Maintenance${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-rebuild)     ${_CLR_DIM}Rebuild Docker image${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-clean)       ${_CLR_RED}⚠️  Remove containers & volumes (nuclear)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🛠️  Utilities${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-health)      ${_CLR_DIM}Run health check${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-token)       ${_CLR_DIM}Show gateway auth token${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-cd)          ${_CLR_DIM}Jump to text2llm project directory${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-config)      ${_CLR_DIM}Open config directory (~/.text2llm)${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-workspace)   ${_CLR_DIM}Open workspace directory${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo -e "${_CLR_BOLD}${_CLR_GREEN}🚀 First Time Setup${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  1.${_CLR_RESET} $(_cmd Text2LLM Dock-start)          ${_CLR_DIM}# Start the gateway${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  2.${_CLR_RESET} $(_cmd Text2LLM Dock-fix-token)      ${_CLR_DIM}# Configure token${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  3.${_CLR_RESET} $(_cmd Text2LLM Dock-dashboard)      ${_CLR_DIM}# Open web UI${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  4.${_CLR_RESET} $(_cmd Text2LLM Dock-devices)        ${_CLR_DIM}# If pairing needed${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  5.${_CLR_RESET} $(_cmd Text2LLM Dock-approve) ${_CLR_CYAN}<id>${_CLR_RESET}   ${_CLR_DIM}# Approve pairing${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_GREEN}💬 WhatsApp Setup${_CLR_RESET}"
  echo -e "  $(_cmd Text2LLM Dock-shell)"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'text2llm channels login --channel whatsapp')"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'text2llm status')"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_CYAN}💡 All commands guide you through next steps!${_CLR_RESET}"
  echo -e "${_CLR_BLUE}📚 Docs: ${_CLR_RESET}${_CLR_CYAN}https://docs.text2llm.ai${_CLR_RESET}"
  echo ""
}

