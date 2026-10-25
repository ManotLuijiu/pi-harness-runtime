#!/usr/bin/env bash
# Tmux clipboard watch - bridges herdr clipboard to local machine
# Runs inside tmux session that stays connected to local machine

set -euo pipefail

BRIDGE_DIR="${HOME}/.herdr-clipboard"
COPY_FILE="${BRIDGE_DIR}/copy-buffer"
LAST_HASH="${BRIDGE_DIR}/.last-hash"

mkdir -p "${BRIDGE_DIR}"

echo "Clipboard bridge active - watching ${COPY_FILE}"
echo "Waiting for clipboard content..."

while true; do
    # Check for new content to copy to local clipboard
    if [[ -f "${COPY_FILE}" ]]; then
        CONTENT=$(cat "${COPY_FILE}")
        HASH=$(echo -n "${CONTENT}" | md5sum | cut -d' ' -f1)
        LAST_HASH_VALUE=""
        
        if [[ -f "${LAST_HASH}" ]]; then
            LAST_HASH_VALUE=$(cat "${LAST_HASH}")
        fi
        
        # Only copy if content changed
        if [[ "${HASH}" != "${LAST_HASH_VALUE}" ]]; then
            echo -n "${CONTENT}" | tmux load-buffer -
            tmux paste-buffer -b herdr-clipboard
            echo "${HASH}" > "${LAST_HASH}"
            echo "Copied to local clipboard ($(echo -n "${CONTENT}" | wc -c) bytes)"
        fi
        
        rm -f "${COPY_FILE}"
    fi
    
    sleep 0.5
done
