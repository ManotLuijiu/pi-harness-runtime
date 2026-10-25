export type HarnessStatus = "wait" | "ok" | "info" | "warn" | "err";

export interface HarnessMessage {
	id: string;
	label: string;
	text: string;
	status: HarnessStatus;
	details?: string[];
}

/** One store for initialization before, during, and after the widget mounts. */
export class HarnessStartupStatus {
	readonly messages: HarnessMessage[] = [];
	onChange?: () => void;

	update(label: string, text: string, status: HarnessStatus = "wait", details?: string[]): void {
		const next = { id: label, label, text, status, details };
		const existing = this.messages.findIndex((message) => message.id === label);
		if (existing === -1) this.messages.push(next);
		else this.messages[existing] = next;
		this.onChange?.();
	}

	/**
	 * Put a message directly after another one.
	 *
	 * Two rows that belong together stay together: the notification channels
	 * (Telegram and LINE) must not be separated by a row that another
	 * feature added in between. A message that does not exist yet is
	 * inserted; an existing one is moved.
	 */
	updateAfter(
		anchorLabel: string,
		label: string,
		text: string,
		status: HarnessStatus = "wait",
		details?: string[],
	): void {
		const next = { id: label, label, text, status, details };
		const existing = this.messages.findIndex((message) => message.id === label);
		if (existing !== -1) this.messages.splice(existing, 1);
		const anchor = this.messages.findIndex((message) => message.id === anchorLabel);
		if (anchor === -1) {
			// Without the anchor there is nothing to be next to - the row
			// goes to the end instead of being lost.
			this.messages.push(next);
		} else {
			this.messages.splice(anchor + 1, 0, next);
		}
		this.onChange?.();
	}
}

export function harnessStatusMarker(status: HarnessStatus): string {
	return { wait: "[WAIT]", ok: "[OK]", info: "[INFO]", warn: "[WARN]", err: "[ERR]" }[status];
}
