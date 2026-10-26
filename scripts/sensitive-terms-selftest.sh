#!/usr/bin/env bash
#
# The failing path of the sensitive-term guard, proved on demand.
#
# The guard is only worth something when it really fails. A scanner that
# says "no term found" for a file that holds a term is worse than no
# scanner at all, because it is trusted. This script puts a term in
# front of the scanner and checks what the scanner does:
#
#   - it fails (exit 1) on a file that holds the term,
#   - it fails (exit 1) on a tree that holds the term,
#   - it fails (exit 1) on a commit message that holds the term,
#   - it passes (exit 0) on a file that holds no term, so the failures
#     above are caused by the term and not by the scanner,
#   - it fails closed (exit 2) when there is no term list,
#   - and it never prints the term in any of those runs.
#
# The term is built while the script runs. A term that is written in the
# repository would be found by the guard that scans the repository, so
# the literal string never enters the tree.
#
# The script needs no secret and no network. It runs the same scanner
# that the workflow runs.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER="$ROOT/scripts/check-sensitive-terms.mjs"

# The test term. The parts are kept apart so that the term itself is not
# a string in this repository.
TERM="zz"
TERM="${TERM}placeholder"
TERM="${TERM}name"

# The term list of the environment must not decide the outcome of the
# cases below: the case that proves the fail-closed behaviour needs a
# run without any list.
unset SENSITIVE_TERMS
unset PI_SENSITIVE_TERMS_FILE

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail() {
	echo "self test failed: $1" >&2
	exit 1
}

# Runs the scanner and checks what it did.
#
# $1 - the name of the case
# $2 - the exit code the scanner has to give
# $3 - the text the output has to hold
# $4 - the directory the scanner runs in
# $5... - the arguments of the scanner
run_case() {
	local name="$1"
	local expect_code="$2"
	local expect_text="$3"
	local dir="$4"
	shift 4
	local output
	local code
	output="$(cd "$dir" && node "$SCANNER" "$@" 2>&1)"
	code=$?
	if [ "$code" != "$expect_code" ]; then
		echo "$name: expected exit $expect_code, got $code" >&2
		echo "$output" >&2
		fail "$name"
	fi
	if [ -n "$expect_text" ] && ! printf '%s' "$output" | grep -qF -- "$expect_text"; then
		echo "$name: the output does not hold the expected text" >&2
		echo "$output" >&2
		fail "$name"
	fi
	if printf '%s' "$output" | grep -qF -- "$TERM"; then
		fail "$name printed the term"
	fi
	echo "ok: $name (exit $code, no term in the output)"
}

if [ ! -f "$SCANNER" ]; then
	fail "the scanner is not at $SCANNER"
fi

# The list of terms the cases use.
printf '%s\n' "$TERM" > "$WORK/terms.txt"

# A file that holds the term, and one that does not.
printf 'a line that holds %s\n' "$TERM" > "$WORK/sample.txt"
printf 'a line that holds nothing\n' > "$WORK/clean.txt"

run_case "a file that holds the term" 1 "sensitive list" "$WORK" \
	--terms-file "$WORK/terms.txt" --file "$WORK/sample.txt"

run_case "a file that holds no term" 0 "no sensitive term was found" "$WORK" \
	--terms-file "$WORK/terms.txt" --file "$WORK/clean.txt"

# A tree that holds the term. The push path of the workflow scans a
# tree, so the tree mode has to fail as well.
mkdir -p "$WORK/tree"
printf 'a line that holds %s\n' "$TERM" > "$WORK/tree/sample.txt"
run_case "a tree that holds the term" 1 "sensitive list" "$WORK" \
	--terms-file "$WORK/terms.txt" --tree "$WORK/tree"

# A commit message that holds the term. The push path of the workflow
# scans the commit messages of the pushed commits.
mkdir -p "$WORK/repo"
git -C "$WORK/repo" init -q
git -C "$WORK/repo" config user.email "selftest@example.com"
git -C "$WORK/repo" config user.name "self test"
printf 'hello\n' > "$WORK/repo/file.txt"
git -C "$WORK/repo" add file.txt
git -C "$WORK/repo" commit -q -m "the first commit"
printf 'hello again\n' > "$WORK/repo/file.txt"
git -C "$WORK/repo" add file.txt
git -C "$WORK/repo" commit -q -m "a message that holds $TERM"
run_case "a commit message that holds the term" 1 "sensitive list" \
	"$WORK/repo" --terms-file "$WORK/terms.txt" --commits "HEAD~1..HEAD"

# No term list at all. The check cannot run, so it says so instead of
# reporting a clean result.
run_case "no term list" 2 "no term list is configured" "$WORK" \
	--file "$WORK/sample.txt"

echo "the failing path of the guard is proven"
