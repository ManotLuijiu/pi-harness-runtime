/**
 * The reaction to a cookie import.
 *
 * The sanitizer watches the drop folder. When an import publishes a new
 * canonical cache, the quota of the provider is probably different, so one
 * refresh is asked for. The refresh is the shared one: a burst of watcher
 * events asks once, not once per event.
 *
 * The handler lives outside the extension so that the reaction can be
 * tested with fake events and a fake refresh, without a browser and
 * without a provider.
 */

import type { WatcherEvent } from "../packages/cookie-sanitizer/src/types.ts";

/** The options of the handler. */
export interface CookieImportRefreshOptions {
	/**
	 * Ask for the shared quota refresh.
	 *
	 * The call is fire and forget: the import does not wait for the
	 * provider.
	 */
	requestRefresh: (trigger: string) => void;
	/** The log sink. It never receives a cookie value. */
	log: (message: string) => void;
}

/** The trigger of the refresh that an import asks for. */
export const COOKIE_IMPORT_TRIGGER = "cookie-import";

/**
 * Handle one event of the cookie watcher.
 *
 * A successful import asks for one refresh. A failure is logged with its
 * reason and asks for nothing.
 */
export function handleCookieWatcherEvent(
	event: WatcherEvent,
	options: CookieImportRefreshOptions,
): void {
	if (event.kind === "sync-error" || event.kind === "watcher-error") {
		const msg = "message" in event ? event.message : "";
		if (msg.includes("ENOSPC")) {
			options.log(
				"cookie-sanitizer: ENOSPC — inotify watchers exhausted.\n" +
					"  Fix (run once as sudo):\n" +
					"    echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-watch.conf\n" +
					"    sudo sysctl --system",
			);
			return;
		}
		options.log(`cookie-sanitizer: ${msg}`);
		return;
	}

	if (event.kind === "sync-ok") {
		options.requestRefresh(COOKIE_IMPORT_TRIGGER);
	}
}
