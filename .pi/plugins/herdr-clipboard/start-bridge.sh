#!/usr/bin/env bash
# Start tmux clipboard bridge
# Bridges herdr's clipboard to local machine via tmux

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="${HOME}/.herdr-clipboard"
MARKER_FILE="${BRIDGE_DIR}/.last-copy"
PID_FILE="${BRIDGE_DIR}/bridge.pid"

mkdir -p "${BRIDGE_DIR}"

# Clean up old PID if exists
if [[ -f "${PID_FILE}" ]]; then
    OLD_PID=$(cat "${PID_FILE}")
    if kill -0 "${OLD_PID}" 2>/dev/null; then
        echo "Clipboard bridge already running (PID ${OLD_PID})"
        exit 0
    fi
fi

# Save PID
echo $$ > "${PID_FILE}"

# Start tmux new-session running clipboard watch loop
tmux new-session -d -s "herdr-clipboard" "bash ${SCRIPT_DIR}/tmux-watch.sh; read"

echo "Clipboard bridge started (PID $$)"
