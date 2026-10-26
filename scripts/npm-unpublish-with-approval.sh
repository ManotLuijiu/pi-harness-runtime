#!/usr/bin/env bash
#
# Remove published versions, completing a web-auth approval when the npm
# registry asks for one.
#
# The registry can refuse a write with an EOTP challenge that carries a
# browser approval URL and a polling URL. The approval URL embeds
# credential material, so it must never reach a log - a log line is
# masked, which would leave the operator with nothing to open, and a
# public artifact would publish the token. The approval therefore happens
# where the URL can be seen safely: a terminal.
#
# Modes:
#
#   request <package> <version>
#     Attempts the removal. On a challenge it prints the approval link
#     and exits 42.
#
#   wait <package> <version> <seconds>
#     Polls the registry until the approval lands, writes the approved
#     token into the npmrc, and exits 0. The caller retries "request".
#
#   batch <package> <version> [version ...]
#     Runs the whole list, handling an approval inline: it prints the
#     link, waits for the approval, refreshes the credential and carries
#     on.
#
# Exit codes: 0 removed, 1 failed, 42 a browser approval is needed.
#
# The credential comes from the npmrc, or from the key file
# ~/.pi-harness-runtime/keys/npm-token.txt when one exists. It is never
# printed.

set -uo pipefail

APPROVAL_DIR=/tmp/npm-approval
NPMRC="${NPM_CONFIG_USERCONFIG:-${HOME:-/tmp}/.npmrc}"
ERR_FILE=/tmp/npm-approval-error.txt
TOKEN_FILE="${NPM_TOKEN_FILE:-$HOME/.pi-harness-runtime/keys/npm-token.txt}"

# The registry hands the approved token back in the body of the polling
# response. That body is a credential, so it is written inside the
# approval directory, readable by its owner only, and removed as soon as
# the token has been read. A file in /tmp that survives the run leaves a
# usable npm credential behind on a shared machine.
APPROVAL_BODY="${APPROVAL_DIR}/done-body.json"

# The credential must exist somewhere before npm is called.
ensure_credential() {
	if [ -s "$NPMRC" ] && grep -q "_authToken=" "$NPMRC"; then
		echo "credential: the npmrc"
		return 0
	fi
	if [ -s "$TOKEN_FILE" ]; then
		umask 077
		mkdir -p "$(dirname "$NPMRC")"
		touch "$NPMRC"
		grep -v '_authToken=' "$NPMRC" > "$NPMRC.tmp" || true
		printf '//registry.npmjs.org/:_authToken=%s\n' \
			"$(tr -d '\n' < "$TOKEN_FILE")" >> "$NPMRC.tmp"
		mv "$NPMRC.tmp" "$NPMRC"
		echo "credential: the key file"
		return 0
	fi
	echo "no credential: sign in with npm, or set the key file" >&2
	return 1
}

auth_url_from_error() {
	grep -oE 'https://www[.]npmjs[.]com/auth/cli/[A-Za-z0-9._~-]+' "$ERR_FILE" | head -1
}

# The polling URL is the registry's, or a loopback stand-in in a test.
# The host stays pinned so a forged URL cannot redirect the poll.
done_url_from_error() {
	grep -oE '(https://registry[.]npmjs[.]org|http://127[.]0[.]0[.]1(:[0-9]+)?)/-/v1/done[?]authId=[A-Za-z0-9._~-]+' "$ERR_FILE" | head -1
}

write_token_to_npmrc() {
	local token="$1"
	umask 077
	mkdir -p "$(dirname "$NPMRC")"
	touch "$NPMRC"
	# Keep every other setting: only the token line is replaced.
	grep -v '_authToken=' "$NPMRC" > "$NPMRC.tmp" || true
	printf '//registry.npmjs.org/:_authToken=%s\n' "$token" >> "$NPMRC.tmp"
	mv "$NPMRC.tmp" "$NPMRC"
}

# Attempt one removal. Sets APPROVAL_URL and DONE_URL when the registry
# asks for a browser approval.
attempt_removal() {
	local package="$1" version="$2"
	APPROVAL_URL=""
	DONE_URL=""
	if [ -n "${NPM_OTP:-}" ]; then
		npm unpublish --otp="${NPM_OTP}" "${package}@${version}" \
			>/dev/null 2>"$ERR_FILE"
	else
		npm unpublish "${package}@${version}" >/dev/null 2>"$ERR_FILE"
	fi
	local rc=$?
	if [ $rc -eq 0 ]; then
		return 0
	fi
	APPROVAL_URL="$(auth_url_from_error)"
	DONE_URL="$(done_url_from_error)"
	if [ -n "$APPROVAL_URL" ] && [ -n "$DONE_URL" ]; then
		mkdir -p "$APPROVAL_DIR"
		printf '%s' "$APPROVAL_URL" > "$APPROVAL_DIR/url.txt"
		printf '%s' "$DONE_URL" > "$APPROVAL_DIR/done-url.txt"
		return 42
	fi
	# The registry may also ask for a typed one-time code. The prompt
	# was captured, so the retry runs with the terminal attached.
	if grep -qiE 'one-time password|enter otp' "$ERR_FILE"; then
		echo "the registry asked for a one-time code"
		if [ -n "${NPM_OTP:-}" ]; then
			npm unpublish --otp="${NPM_OTP}" "${package}@${version}"
		else
			npm unpublish "${package}@${version}"
		fi
		rc=$?
		if [ $rc -eq 0 ]; then
			return 0
		fi
	fi
	return 1
}

# Wait for the approval to land and refresh the credential.
wait_for_approval() {
	local done_url="$1" wait_seconds="$2"
	local deadline=$(( $(date +%s) + wait_seconds ))
	while [ "$(date +%s)" -lt "$deadline" ]; do
		local code token
		umask 077
		mkdir -p "$APPROVAL_DIR"
		code="$(curl -sS -o "$APPROVAL_BODY" -w '%{http_code}' \
			-H "Authorization: Bearer ${NODE_AUTH_TOKEN:-}" "$done_url")"
		if [ "$code" = "200" ]; then
			token="$(node -e '
				const fs = require("fs");
				let c = {};
				try { c = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
				catch {}
				process.stdout.write(c.token || "");
			' "$APPROVAL_BODY")"
			# The body is a credential: it does not outlive the read.
			rm -f "$APPROVAL_BODY"
			if [ -n "$token" ]; then
				write_token_to_npmrc "$token"
				echo "the approval landed; the credential was refreshed"
				return 0
			fi
		fi
		sleep 5
	done
	rm -f "$APPROVAL_BODY"
	echo "no approval arrived within ${wait_seconds}s"
	return 1
}

print_approval_link() {
	echo ""
	echo "The npm registry wants a browser approval before it removes"
	echo "a version. Open this link, sign in to npm if needed, and approve:"
	echo ""
	echo "    $1"
	echo ""
	echo "The removal continues on its own once the approval lands."
	echo ""
}

MODE="${1:?mode required}"
shift

case "$MODE" in
request)
	PACKAGE="${1:?package name required}"
	VERSION="${2:?version required}"
	ensure_credential || exit 1
	attempt_removal "$PACKAGE" "$VERSION"
	rc=$?
	case $rc in
	0)
		echo "OK: unpublished ${PACKAGE}@${VERSION}"
		exit 0
		;;
	42)
		print_approval_link "$APPROVAL_URL"
		exit 42
		;;
	*)
		echo "FAILED: ${PACKAGE}@${VERSION}"
		grep -v -E 'auth/cli|v1/done' "$ERR_FILE" | tail -5
		exit 1
		;;
	esac
	;;
wait)
	PACKAGE="${1:?package name required}"
	VERSION="${2:?version required}"
	WAIT_SECONDS="${3:-900}"
	DONE_URL="$(cat "$APPROVAL_DIR/done-url.txt" 2>/dev/null || true)"
	if [ -z "$DONE_URL" ]; then
		echo "no pending approval to wait for"
		exit 1
	fi
	wait_for_approval "$DONE_URL" "$WAIT_SECONDS"
	exit $?
	;;
batch)
	PACKAGE="${1:?package name required}"
	shift
	ensure_credential || exit 1
	failed=""
	for version in "$@"; do
		attempt_removal "$PACKAGE" "$version"
		rc=$?
		if [ $rc -eq 0 ]; then
			echo "OK: unpublished ${PACKAGE}@${version}"
			continue
		fi
		if [ $rc -ne 42 ]; then
			echo "FAILED: ${PACKAGE}@${version}"
			grep -v -E 'auth/cli|v1/done' "$ERR_FILE" | tail -5
			failed="$failed $version"
			continue
		fi
		print_approval_link "$APPROVAL_URL"
		if ! wait_for_approval "$DONE_URL" "${APPROVAL_WAIT:-900}"; then
			echo "FAILED: ${PACKAGE}@${version}"
			failed="$failed $version"
			# An approval that does not arrive means nobody is watching this
			# run. Every remaining version would face the same challenge and
			# wait the same fifteen minutes, so the batch stops here
			# instead of spending hours to remove nothing. Set
			# APPROVAL_ABORT=0 to keep going anyway.
			if [ "${APPROVAL_ABORT:-1}" != "0" ]; then
				echo ""
				echo "The approval did not arrive, so the batch stops."
				echo "The versions that were not attempted are still published."
				echo "Run this again once the approval can be given."
				break
			fi
			continue
		fi
		attempt_removal "$PACKAGE" "$version"
		rc=$?
		if [ $rc -eq 0 ]; then
			echo "OK: unpublished ${PACKAGE}@${version}"
		else
			echo "FAILED: ${PACKAGE}@${version}"
			failed="$failed $version"
		fi
	done
	if [ -n "$failed" ]; then
		echo "Versions that could not be unpublished:$failed"
		exit 1
	fi
	exit 0
	;;
*)
	echo "unknown mode: $MODE" >&2
	exit 2
	;;
esac
