/**
 * Auto Quota Resume — schedules automatic job resume when quota resets.
 *
 * Flow:
 *   quota exhaustion detected
 *     → read h5_resets_at_epoch from mirror
 *     → compute resumeAt ISO timestamp
 *     → call machine.setResumeTime(resumeAt)
 *     → schedule setTimeout for auto-resume
 *     → at timeout: machine.transition("running")
 *
 * Only the 5h window is auto-resumed (provider-reported, predictable).
 * Weekly/monthly quota exhaustion requires human monitoring.
 */

import type { MirrorStore } from "../mirror.js";
import type { JobStateMachine } from "./job-state-machine.js";

/** Small buffer (ms) before the exact reset time to resume. */
const RESUME_BUFFER_MS = 10_000; // 10 seconds — resume just before reset

/** Minimum time to wait before auto-resuming (avoid immediate re-trigger). */
const MIN_RESUME_DELAY_MS = 5_000; // 5 seconds

/** Map of jobId → active auto-resume timer handle. */
const activeTimers = new Map<
	string,
	{ timeout: ReturnType<typeof setTimeout>; resumeAt: number }
>();

/**
 * Schedule an auto-resume for a job that was paused due to quota exhaustion.
 *
 * Reads the reset epoch from the mirror store for the given provider,
 * computes the resume time, sets it on the checkpoint, and schedules
 * a setTimeout to transition back to "running".
 *
 * Returns the scheduled resumeAt ISO string, or null if no epoch data
 * is available (requires human resume).
 */
export function scheduleAutoResume(
	provider: string,
	machine: JobStateMachine,
	mirrorStore: MirrorStore,
): string | null {
	const jobId = machine.getCheckpoint()?.jobId;
	if (!jobId) return null;

	// Cancel any existing timer for this job
	cancelAutoResume(jobId);

	const mirror = mirrorStore.readAll();
	const record = mirror?.[provider];
	if (!record) return null;

	// Only auto-resume on 5h quota exhaustion (has precise epoch)
	if (typeof record.h5_resets_at_epoch !== "number") return null;

	const resetEpoch = record.h5_resets_at_epoch;
	const now = Date.now();
	const delayMs = Math.max(resetEpoch - now - RESUME_BUFFER_MS, MIN_RESUME_DELAY_MS);
	const resumeAt = now + delayMs;
	const resumeAtIso = new Date(resumeAt).toISOString();

	// Persist to checkpoint so resumeAt survives worker restart
	machine.setResumeTime(resumeAtIso);

	console.log(
		`[auto-quota-resume] ${provider} 5h quota exhausted.` +
			` Auto-resume scheduled at ${resumeAtIso} (in ${Math.round(delayMs / 1000)}s)`,
	);

	const timeout = setTimeout(async () => {
		activeTimers.delete(jobId);

		const checkpoint = machine.getCheckpoint();
		if (!checkpoint || checkpoint.status !== "paused_quota") {
			// Job was manually resumed or cancelled
			return;
		}

		// Check the mirror — if quota is still exhausted, shift the timer
		const updated = mirrorStore.readAll()?.[provider];
		if (updated?.h5_resets_at_epoch) {
			const stillExhausted = Date.now() < updated.h5_resets_at_epoch;
			if (stillExhausted) {
				console.log(
					`[auto-quota-resume] ${provider} still exhausted at scheduled time.` +
						` Re-scheduling...`,
				);
				scheduleAutoResume(provider, machine, mirrorStore);
				return;
			}
		}

		const result = await machine.transition("running");
		if (result.success) {
			console.log(
				`[auto-quota-resume] Job ${jobId} auto-resumed after ${provider} 5h quota reset.`,
			);
		} else {
			console.error(
				`[auto-quota-resume] Auto-resume failed for ${jobId}: ${result.error}`,
			);
		}
	}, delayMs);

	activeTimers.set(jobId, { timeout, resumeAt });
	return resumeAtIso;
}

/**
 * Cancel the auto-resume timer for a job.
 * Call this when the job is manually resumed or cancelled.
 */
export function cancelAutoResume(jobId: string): void {
	const existing = activeTimers.get(jobId);
	if (existing) {
		clearTimeout(existing.timeout);
		activeTimers.delete(jobId);
	}
}

/**
 * Get the scheduled resume time for a job, or null if not scheduled.
 */
export function getScheduledResume(jobId: string): number | null {
	return activeTimers.get(jobId)?.resumeAt ?? null;
}
