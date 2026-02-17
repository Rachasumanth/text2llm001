#!/data/data/com.termux/files/usr/bin/bash
# text2llm OAuth Sync Widget
# Syncs Claude Code tokens to text2llm on l36 server
# Place in ~/.shortcuts/ on phone for Termux:Widget

termux-toast "Syncing text2llm auth..."

# Run sync on l36 server
SERVER="${TEXT2LLM_SERVER:-${CLAWDBOT_SERVER:-l36}}"
RESULT=$(ssh "$SERVER" '/home/admin/text2llm/scripts/sync-claude-code-auth.sh' 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    # Extract expiry time from output
    EXPIRY=$(echo "$RESULT" | grep "Token expires:" | cut -d: -f2-)

    termux-vibrate -d 100
    termux-toast "text2llm synced! Expires:${EXPIRY}"

    # Optional: restart text2llm service
    ssh "$SERVER" 'systemctl --user restart text2llm' 2>/dev/null
else
    termux-vibrate -d 300
    termux-toast "Sync failed: ${RESULT}"
fi
