#!/bin/bash
# =============================================================================
# gist-poll.sh — Client clipboard poller for pi-harness-runtime Gist sync
# =============================================================================
# Cross-platform clipboard sync via GitHub Gist.
# Run this on Mac/iPad/Ubuntu to receive clipboard content from the server.
#
# Setup:
#   1. Run /github-login on the server (pi session)
#   2. Copy Gist ID from the confirmation message
#   3. Export GITHUB_TOKEN and GIST_ID below, or pass as arguments
#   4. Run this script: bash gist-poll.sh
#
# Usage:
#   bash gist-poll.sh                    # Uses env vars or prompts
#   bash gist-poll.sh <token> <gist-id> # Arguments
#   GITHUB_TOKEN=xxx GIST_ID=xxx bash gist-poll.sh  # Env vars
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
POLL_INTERVAL="${POLL_INTERVAL:-2}" # seconds between polls
TIMEOUT_SEC=10                      # curl timeout

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ── Helpers ───────────────────────────────────────────────────────────────────
log_info() { echo -e "${GREEN}[gist-poll]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[gist-poll]${NC} $*" >&2; }
log_error() { echo -e "${RED}[gist-poll]${NC} $*" >&2; }

# ── Argument parsing ───────────────────────────────────────────────────────────
GITHUB_TOKEN="${1:-${GITHUB_TOKEN:-}}"
GIST_ID="${2:-${GIST_ID:-}}"

if [[ -z "$GITHUB_TOKEN" ]] || [[ -z "$GIST_ID" ]]; then
	echo ""
	echo "=== pi-harness-runtime Gist Clipboard Poller ==="
	echo ""
	echo "Configure one of:"
	echo "  1. Export variables: export GITHUB_TOKEN=xxx GIST_ID=xxx"
	echo "  2. Pass arguments:  bash gist-poll.sh <token> <gist-id>"
	echo ""
	echo "Get these from the /github-login confirmation message on the server."
	echo ""
	echo "The /github-login command shows the Gist URL like:"
	echo "  https://gist.github.com/<username>/<GIST_ID>"
	echo ""
	echo "Example:"
	echo "  bash gist-poll.sh ghp_xxxxx abc123def456"
	echo ""
	exit 1
fi

# ── Detect clipboard tool ───────────────────────────────────────────────────────
detect_clipboard_tool() {
	if command -v pbcopy >/dev/null 2>&1; then
		echo "pbcopy"
	elif command -v xclip >/dev/null 2>&1; then
		echo "xclip"
	elif command -v xsel >/dev/null 2>&1; then
		echo "xsel"
	else
		log_error "No clipboard tool found (pbcopy, xclip, xsel)"
		log_error "Install one of: pbcopy (macOS), xclip (Linux), xsel (Linux)"
		exit 1
	fi
}

write_clipboard() {
	local content="$1"
	local tool
	tool=$(detect_clipboard_tool)

	case "$tool" in
	pbcopy)
		echo "$content" | pbcopy
		;;
	xclip)
		echo "$content" | xclip -selection clipboard -in
		;;
	xsel)
		echo "$content" | xsel --clipboard --input
		;;
	esac
	log_info "Updated clipboard (${tool}): ${#content} chars"
}

# ── Fetch from Gist ───────────────────────────────────────────────────────────
fetch_gist_content() {
	curl -s \
		--max-time "$TIMEOUT_SEC" \
		-H "Authorization: Bearer $GITHUB_TOKEN" \
		-H "Accept: application/vnd.github+json" \
		-H "X-GitHub-Api-Version: 2022-11-28" \
		"https://api.github.com/gists/$GIST_ID" |
		grep -o '"content":"[^"]*"' |
		sed 's/"content":"//;s/"$//' |
		head -1
}

# ── Main loop ─────────────────────────────────────────────────────────────────
log_info "Starting Gist clipboard poller..."
log_info "Poll interval: ${POLL_INTERVAL}s"
log_info "Gist: https://gist.github.com/${GIST_ID}"
log_info "Clipboard tool: $(detect_clipboard_tool)"
log_info ""
log_info "Press Ctrl+C to stop."
log_info "Any text copied on the server (Ctrl+Shift+C) will appear here."

LAST_CONTENT=""

while true; do
	CURRENT_CONTENT=$(fetch_gist_content 2>/dev/null || echo "")

	if [[ -n "$CURRENT_CONTENT" ]] && [[ "$CURRENT_CONTENT" != "$LAST_CONTENT" ]]; then
		LAST_CONTENT="$CURRENT_CONTENT"
		write_clipboard "$CURRENT_CONTENT"
	fi

	sleep "$POLL_INTERVAL"
done
