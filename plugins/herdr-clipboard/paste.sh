#!/usr/bin/env bash
# Paste from local clipboard - reads from tmux paste buffer and outputs to stdout
# Used by herdr's prefix+p keybinding to paste from local machine into herdr pane

set -euo pipefail

BRIDGE_DIR="${HOME}/.herdr-clipboard"
PASTE_BUFFER="${BRIDGE_DIR}/paste-buffer"

# First, try to get content from tmux paste buffer
if command -v tmux &>/dev/null; then
    # Try to capture tmux buffer content
    CONTENT=$(tmux show-buffer 2>/dev/null || true)
    if [[ -n "${CONTENT}" ]]; then
        echo -n "${CONTENT}"
        exit 0
    fi
fi

# Fallback: check if there's pending paste content from remote herdr
if [[ -f "${PASTE_BUFFER}" ]]; then
    cat "${PASTE_BUFFER}"
    rm -f "${PASTE_BUFFER}"
    exit 0
fi

# Nothing to paste
exit 1
