export type HarnessStatus = "wait" | "ok" | "warn" | "err";

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
}

export function harnessStatusMarker(status: HarnessStatus): string {
	return { wait: "[WAIT]", ok: "[OK]", warn: "[WARN]", err: "[ERR]" }[status];
}
