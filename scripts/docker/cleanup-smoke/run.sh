#!/usr/bin/env bash
set -euo pipefail

cd /repo

export TEXT2LLM_STATE_DIR="/tmp/text2llm-test"
export TEXT2LLM_CONFIG_PATH="${TEXT2LLM_STATE_DIR}/text2llm.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${TEXT2LLM_STATE_DIR}/credentials"
mkdir -p "${TEXT2LLM_STATE_DIR}/agents/main/sessions"
echo '{}' >"${TEXT2LLM_CONFIG_PATH}"
echo 'creds' >"${TEXT2LLM_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${TEXT2LLM_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm text2llm reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${TEXT2LLM_CONFIG_PATH}"
test ! -d "${TEXT2LLM_STATE_DIR}/credentials"
test ! -d "${TEXT2LLM_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${TEXT2LLM_STATE_DIR}/credentials"
echo '{}' >"${TEXT2LLM_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm text2llm uninstall --state --yes --non-interactive

test ! -d "${TEXT2LLM_STATE_DIR}"

echo "OK"
