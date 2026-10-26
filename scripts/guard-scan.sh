#!/usr/bin/env bash
# Scan the whole checkout for a client name.
#
# The checks that run in CI look at what a pull request changes. This one
# looks at everything: the files of the working tree, the paths of every
# ref of the repository, and the commit messages of every ref. It is the
# check to run when the question is "is this repository clean right now",
# and the check to run before a release that was prepared outside of a
# pull request.
#
# The list of terms comes from PI_SENSITIVE_TERMS_FILE or from
# SENSITIVE_TERMS. Without a list the script says so and stops - a
# machine that does not know the names cannot check for them, and a scan
# that found nothing is not a scan that passed.
#
# The report names the file and the line and never the term.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SCANNER="scripts/check-sensitive-terms.mjs"

if [ ! -f "$SCANNER" ]; then
	echo "guard: the scanner is missing at $SCANNER" >&2
	exit 2
fi

# The list of terms, without printing it.
if [ -n "${PI_SENSITIVE_TERMS_FILE:-}" ] && [ -f "${PI_SENSITIVE_TERMS_FILE:-}" ]; then
	TERMS="$(cat "$PI_SENSITIVE_TERMS_FILE")"
elif [ -n "${SENSITIVE_TERMS:-}" ]; then
	TERMS="$SENSITIVE_TERMS"
else
	echo "guard: no list of terms. Set PI_SENSITIVE_TERMS_FILE or SENSITIVE_TERMS."
	echo "guard: the scan did not run, so nothing was checked."
	exit 2
fi

if [ -z "$TERMS" ]; then
	echo "guard: the list of terms is empty. The scan did not run."
	exit 2
fi

COUNT="$(node --input-type=module -e '
import { readTermsFile, termsFromEnv } from "./scripts/check-sensitive-terms.mjs";
const terms = process.env.PI_SENSITIVE_TERMS_FILE
	? readTermsFile(process.env.PI_SENSITIVE_TERMS_FILE)
	: termsFromEnv();
console.log(terms.length);
')"
echo "guard: a list of ${COUNT} term(s)"

STATUS=0

# The working tree: the files and their paths.
echo "guard: the files and the paths of the working tree"
if ! node "$SCANNER" --tree .; then
	STATUS=1
fi

# The commit messages of every ref. A message is public the moment the
# commit is pushed, and GitHub builds the release notes from them.
echo "guard: the commit messages of every ref"
if ! node "$SCANNER" --commits --all; then
	STATUS=1
fi

# The paths of every ref. A name in a path is a name in a link to the
# repository, and the history of a path outlives the file.
echo "guard: the paths of every ref"
if ! node --input-type=module -e '
import { execFileSync } from "node:child_process";
import { pathHasTerm, termsFromEnv, redactTerms } from "./scripts/check-sensitive-terms.mjs";

const terms = termsFromEnv();
if (terms.length === 0) {
	console.error("guard: no list of terms, so the paths were not checked.");
	process.exit(2);
}
const output = execFileSync("git", ["log", "--all", "--name-only", "--pretty=format:"], {
	encoding: "utf8",
	maxBuffer: 64 * 1024 * 1024,
});
const paths = [...new Set(output.split("\n").map((line) => line.trim()).filter(Boolean))];
const hits = paths.filter((path) => pathHasTerm(path, terms));
for (const path of hits) {
	console.log(`a path of the history holds a client name: ${redactTerms(path, terms)}`);
}
console.log(`guard: ${paths.length} path(s) of the history were checked`);
process.exit(hits.length > 0 ? 1 : 0);
'; then
	STATUS=1
fi

if [ "$STATUS" -eq 0 ]; then
	echo "guard: the repository holds no client name"
else
	echo "guard: a client name is in the repository. See the places above."
fi
exit "$STATUS"
