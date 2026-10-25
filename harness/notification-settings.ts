/**
 * The persisted notification-channel settings.
 *
 * The notification center keeps the runtime state of a channel (in memory and
 * in its own SQLite table). This file is the durable record of an EXPLICIT
 * user decision: "LINE is off".
 *
 * Two things need that record:
 *
 * - The startup summary must show "LINE: disabled" instead of a warning
 *   after the user turned the channel off. Without a durable record the
 *   summary cannot tell "disabled on purpose" from "never configured" - and
 *   it must not guess, because guessing wrong shows a warning for a channel
 *   the user deliberately turned off.
 * - The decision must survive a restart, so the setting is written to disk
 *   when the user changes it.
 *
 * Plain JSON is used on purpose: it works in every runtime (Bun has no
 * usable `node:sqlite`), it is readable by the user, and a broken file can
 * never stop the harness from starting.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface NotificationChannelSettings {
	/** `false` = the user turned the channel off. */
	enabled: boolean;
}

export interface NotificationSettings {
	/** The shape of the file. A future change bumps the version. */
	version: 1;
	channels: Record<string, NotificationChannelSettings>;
}

/** The directory that holds the harness runtime state. */
export function notificationSettingsDir(): string {
	return join(homedir(), ".pi-harness-runtime");
}

/** The file that holds the persisted channel decisions. */
export function notificationSettingsPath(): string {
	return join(notificationSettingsDir(), "notification-settings.json");
}

export function defaultNotificationSettings(): NotificationSettings {
	return { version: 1, channels: {} };
}

/** A plain object - the only shape the decoder accepts. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decode one channel entry.
 *
 * The file is user-writable, so every value is checked before it is used.
 * An entry that does not decode is dropped - a broken entry must not take
 * the whole file (and with it the other channels) down.
 */
function decodeChannelSettings(value: unknown): NotificationChannelSettings | null {
	if (!isRecord(value)) return null;
	return { enabled: value.enabled !== false };
}

/**
 * Read the persisted settings.
 *
 * A missing, unreadable or broken file yields the defaults: the settings are
 * a convenience, never a reason to fail a start.
 */
export function loadNotificationSettings(path: string = notificationSettingsPath()): NotificationSettings {
	try {
		if (!existsSync(path)) return defaultNotificationSettings();
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) return defaultNotificationSettings();
		const channels: Record<string, NotificationChannelSettings> = {};
		const rawChannels = parsed.channels;
		if (isRecord(rawChannels)) {
			for (const [id, value] of Object.entries(rawChannels)) {
				const decoded = decodeChannelSettings(value);
				if (decoded) channels[id] = decoded;
			}
		}
		return { version: 1, channels };
	} catch {
		return defaultNotificationSettings();
	}
}

/** Write the settings. Returns false when the file could not be written. */
export function saveNotificationSettings(
	settings: NotificationSettings,
	path: string = notificationSettingsPath(),
): boolean {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		return true;
	} catch {
		return false;
	}
}

/**
 * Did the user explicitly turn the channel off?
 *
 * A channel that was never mentioned has no entry - it is NOT disabled. Only
 * an explicit decision counts, because "disabled" and "not configured" are
 * different states with different meanings.
 */
export function isChannelDisabled(channel: string, path?: string): boolean {
	const settings = loadNotificationSettings(path);
	const entry = settings.channels[channel];
	return entry ? entry.enabled === false : false;
}

/**
 * Record an explicit channel decision.
 *
 * Returns false when the decision could not be persisted - the caller then
 * knows that the decision is lost on the next restart.
 */
export function setChannelDisabled(channel: string, disabled: boolean, path?: string): boolean {
	const settings = loadNotificationSettings(path);
	settings.channels[channel] = { enabled: !disabled };
	return saveNotificationSettings(settings, path);
}
