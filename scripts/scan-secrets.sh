#!/bin/bash
# scan-secrets.sh - Run secret scan on the repository
# Usage: ./scripts/scan-secrets.sh [--fix]
#
# Requires: gitleaks (https://github.com/gitleaks/gitleaks)
# Install: brew install gitleaks  or  go install github.com/gitleaks/gitleaks@latest

set -e

GITLEAKS="${GITLEAKS:-gitleaks}"

echo "🔍 Scanning for secrets in $(pwd)"
echo ""

# Check if gitleaks is installed
if ! command -v $GITLEAKS &> /dev/null; then
    echo "❌ gitleaks not found!"
    echo "   Install: brew install gitleaks"
    echo "   Or:     go install github.com/gitleaks/gitleaks@latest"
    exit 1
fi

GITLEAKS_VERSION=$($GITLEAKS version 2>/dev/null | head -1)
echo "   Using: $GITLEAKS_VERSION"
echo ""

# Scan staged changes only (before commit)
if [ "$1" = "--staged" ]; then
    echo "📦 Scanning STAGED changes only..."
    $GITLEAKS protect --staged --source . --verbose
    echo "✅ Staged changes are clean!"
    exit 0
fi

# Scan all files (full scan)
if [ "$1" = "--full" ]; then
    echo "📁 Scanning FULL repository (including git history)..."
    $GITLEAKS detect --source . --verbose
    echo "✅ Full scan complete!"
    exit 0
fi

# Default: scan working directory (not git history)
echo "📁 Scanning working directory..."
echo "   Use --staged  to scan only staged changes"
echo "   Use --full    to scan entire git history"
echo ""

RESULT=0
$GITLEAKS protect --source . --verbose --no-git || RESULT=$?

if [ $RESULT -eq 0 ]; then
    echo ""
    echo "✅ No secrets detected in working directory!"
    echo ""
    echo "⚠️  Note: .env and .npmrc contain real tokens but are in .gitignore"
    echo "   This scan won't report them (good - they should stay ignored)"
else
    echo ""
    echo "❌ Secrets detected!"
    echo ""
    echo "To review detected secrets:"
    echo "   $GITLEAKS protect --source . --verbose"
    echo ""
    echo "If these are false positives, update .gitleaks.toml allowlist"
fi

exit $RESULT
