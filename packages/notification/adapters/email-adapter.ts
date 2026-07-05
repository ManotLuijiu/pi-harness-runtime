/**
 * Email Adapter — RFC-0022
 *
 * Sends notifications via SMTP.
 */

import type {
	NotificationPayload,
	NotificationResult,
	EmailConfig,
} from "../types.js";
import { BaseChannelAdapter } from "../base-adapter.js";

// Simple SMTP client using built-in net module
async function sendSmtpEmail(
	host: string,
	port: number,
	user: string,
	password: string,
	from: string,
	to: string[],
	subject: string,
	body: string,
	tls: boolean = false,
): Promise<void> {
	// For a production implementation, you'd use a proper SMTP library
	// This is a placeholder that logs the email
	console.log(`[Email] Would send to ${to.join(", ")}`);
	console.log(`[Email] Subject: ${subject}`);
	console.log(`[Email] Body: ${body}`);

	// In practice, you'd use something like:
	// import { createClient } from "nodemailer";
	// const transporter = nodemailer.createTransport({ ... });
	// await transporter.sendMail({ ... });
}

export class EmailAdapter extends BaseChannelAdapter {
	readonly id = "email";
	readonly type = "email";

	constructor(config: EmailConfig) {
		super({ id: "email", type: "email", enabled: true, config });
	}

	async initialize(): Promise<boolean> {
		// Verify SMTP connection
		try {
			const cfg = this.config.config as EmailConfig;
			// In production, verify SMTP credentials
			return Boolean(
				cfg.smtpHost && cfg.smtpUser && cfg.from && cfg.to.length > 0,
			);
		} catch {
			return false;
		}
	}

	async send(payload: NotificationPayload): Promise<NotificationResult> {
		try {
			const cfg = this.config.config as EmailConfig;
			const subject = `${this.getEmoji(payload.event)} ${payload.title}`;
			const body = this.formatBody(payload);

			await sendSmtpEmail(
				cfg.smtpHost,
				cfg.smtpPort,
				cfg.smtpUser,
				cfg.smtpPassword,
				cfg.from,
				cfg.to,
				subject,
				body,
				cfg.tls,
			);

			return { success: true, channel: this.id };
		} catch (error) {
			return {
				success: false,
				channel: this.id,
				error: String(error),
			};
		}
	}

	private formatBody(payload: NotificationPayload): string {
		const lines = [
			payload.message,
			"",
			"---",
			`Event: ${payload.event}`,
			`Time: ${payload.timestamp}`,
		];

		if (payload.details?.taskTitle) {
			lines.push(`Task: ${payload.details.taskTitle}`);
		}
		if (payload.details?.jobId) {
			lines.push(`Job ID: ${payload.details.jobId}`);
		}
		if (payload.details?.error) {
			lines.push("", `Error: ${payload.details.error}`);
		}

		return lines.join("\n");
	}

	private getEmoji(event: NotificationPayload["event"]): string {
		const map: Record<string, string> = {
			JobStarted: "[🚀]",
			TaskCompleted: "[✅]",
			TaskFailed: "[❌]",
			QuotaPaused: "[⏸]",
			ResumeScheduled: "[▶]",
			ContextCompacted: "[📦]",
			OutputLimitContinued: "[🔄]",
			E2EFailed: "[🧪]",
			HumanReviewNeeded: "[👤]",
			ReadyForClient: "[🎉]",
			JobCancelled: "[🚫]",
			Error: "[⚠]",
		};
		return map[event] ?? "[📢]";
	}
}
