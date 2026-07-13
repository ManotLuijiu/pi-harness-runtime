/**
 * Learning Engine (RFC-0058)
 *
 * Extracts reusable lessons from completed and failed jobs.
 */

import { randomUUID } from "node:crypto";
import type {
	LearningRequest,
	LearningResult,
	LearnedExperience,
	ExtractedPattern,
	PatternType,
	ProviderExecutionMetric,
	RepairAttempt,
	HumanFeedback,
	ExperienceScope,
	ExperienceStatus,
} from "./types.js";
import {
	containsSecret,
	calculateConfidence,
	type ConfidenceFactors,
} from "./types.js";

// ─── Pattern Extraction ────────────────────────────────────────────────────────

function extractProviderSuccessPatterns(
	metrics: ProviderExecutionMetric[],
): ExtractedPattern[] {
	const patterns: ExtractedPattern[] = [];

	// Group by task type
	const byTaskType = new Map<string, ProviderExecutionMetric[]>();
	for (const metric of metrics) {
		const existing = byTaskType.get(metric.taskType) || [];
		existing.push(metric);
		byTaskType.set(metric.taskType, existing);
	}

	// Find best provider per task type
	for (const [taskType, taskMetrics] of byTaskType) {
		if (taskMetrics.length < 2) continue;

		let bestProvider = taskMetrics[0];
		let bestSuccessRate = 0;

		for (const metric of taskMetrics) {
			const total = metric.successCount + metric.failureCount;
			if (total > 0) {
				const successRate = metric.successCount / total;
				if (successRate > bestSuccessRate) {
					bestSuccessRate = successRate;
					bestProvider = metric;
				}
			}
		}

		if (bestSuccessRate > 0.7) {
			patterns.push({
				type: "provider_success",
				description: `Provider '${bestProvider.providerId}' performs best for '${taskType}' tasks (${(bestSuccessRate * 100).toFixed(0)}% success rate)`,
				occurrenceCount: bestProvider.successCount + bestProvider.failureCount,
				successIndicators: [
					`${bestSuccessRate > 0.8 ? "high" : "good"} success rate`,
				],
				failureIndicators: [],
			});
		}
	}

	return patterns;
}

function extractRepairPatterns(repairs: RepairAttempt[]): ExtractedPattern[] {
	const patterns: ExtractedPattern[] = [];

	// Group by repair type
	const byType = new Map<string, RepairAttempt[]>();
	for (const repair of repairs) {
		const existing = byType.get(repair.repairType) || [];
		existing.push(repair);
		byType.set(repair.repairType, existing);
	}

	for (const [repairType, typeRepairs] of byType) {
		const successCount = typeRepairs.filter((r) => r.success).length;
		const total = typeRepairs.length;
		const successRate = total > 0 ? successCount / total : 0;

		patterns.push({
			type: "repair_strategy",
			description: `Repair strategy '${repairType}' has ${(successRate * 100).toFixed(0)}% success rate`,
			occurrenceCount: total,
			successIndicators:
				successRate > 0.5 ? [`effective for ${successCount} tasks`] : [],
			failureIndicators:
				successRate <= 0.5
					? [`ineffective for ${total - successCount} tasks`]
					: [],
		});
	}

	return patterns;
}

function extractFailurePatterns(
	events: Array<{
		type: string;
		message: string;
		data?: Record<string, unknown>;
	}>,
): ExtractedPattern[] {
	const patterns: ExtractedPattern[] = [];
	const failureTypes = new Map<string, number>();

	// Count failure types
	for (const event of events) {
		if (event.type.includes("error") || event.type.includes("failure")) {
			const existing = failureTypes.get(event.message) || 0;
			failureTypes.set(event.message, existing + 1);
		}
	}

	// Create patterns for common failures
	for (const [message, count] of failureTypes) {
		if (count >= 2) {
			patterns.push({
				type: "failure_cause",
				description: message,
				occurrenceCount: count,
				successIndicators: [],
				failureIndicators: [`occurred ${count} times`],
			});
		}
	}

	return patterns;
}

// ─── Experience Creation ──────────────────────────────────────────────────────

function createExperience(
	pattern: ExtractedPattern,
	scope: ExperienceScope,
	humanFeedback?: HumanFeedback[],
): LearnedExperience {
	// Calculate confidence
	const factors: ConfidenceFactors = {
		occurrenceCount: pattern.occurrenceCount,
		consistentPositiveOutcomes:
			pattern.successIndicators.length * pattern.occurrenceCount,
		humanApprovalCount: humanFeedback?.filter((f) => f.approved).length || 0,
		frameworkCorroboration: 0,
		contradictoryOutcomes: pattern.failureIndicators.length,
		singleEventEvidence: pattern.occurrenceCount === 1,
		staleRepository: false,
		changedProjectRules: false,
	};

	const confidence = calculateConfidence(factors);

	// Determine status
	let status: ExperienceStatus = "proposed";
	if (humanFeedback?.some((f) => f.approved)) {
		status = "approved";
	}

	return {
		id: randomUUID(),
		scope,
		pattern: pattern.description,
		recommendation: generateRecommendation(pattern),
		confidence,
		evidenceRefs: [],
		status,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		tags: [pattern.type],
		taskType: scope === "task_type" ? undefined : undefined,
	};
}

function generateRecommendation(pattern: ExtractedPattern): string {
	switch (pattern.type) {
		case "provider_success":
			return `Use the recommended provider for this task type to improve success rate.`;
		case "repair_strategy":
			return `Consider using this repair strategy for similar failures.`;
		case "failure_cause":
			return `Avoid or handle this failure condition proactively.`;
		case "prompt_structure":
			return `Use this prompt structure for better outcomes.`;
		case "framework_command":
			return `Use this command pattern for framework-specific tasks.`;
		case "test_scenario":
			return `Add this test scenario to catch regressions.`;
		case "context_source":
			return `Prioritize this context source for similar tasks.`;
		default:
			return pattern.description;
	}
}

// ─── Secret Filtering ─────────────────────────────────────────────────────────

function filterSecrets(data: Record<string, unknown>): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(data)) {
		// Skip secret-like keys
		if (containsSecret(key)) {
			filtered[key] = "[REDACTED]";
			continue;
		}

		// Recursively filter nested objects
		if (typeof value === "object" && value !== null) {
			filtered[key] = filterSecrets(value as Record<string, unknown>);
		} else {
			filtered[key] = value;
		}
	}

	return filtered;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class LearningEngine {
	private framework?: string;
	private repository?: string;

	constructor(options?: { framework?: string; repository?: string }) {
		this.framework = options?.framework;
		this.repository = options?.repository;
	}

	/**
	 * Extract learned experiences from completed job
	 */
	learn(request: LearningRequest): LearningResult {
		const experiences: LearnedExperience[] = [];

		// 1. Extract provider success patterns
		const providerPatterns = extractProviderSuccessPatterns(
			request.providerMetrics,
		);
		for (const pattern of providerPatterns) {
			const experience = createExperience(
				pattern,
				"task_type",
				request.humanFeedback,
			);
			experiences.push(experience);
		}

		// 2. Extract repair patterns
		const repairPatterns = extractRepairPatterns(request.repairHistory);
		for (const pattern of repairPatterns) {
			const experience = createExperience(
				pattern,
				"task_type",
				request.humanFeedback,
			);
			experiences.push(experience);
		}

		// 3. Extract failure patterns
		const filteredEvents = request.events
			.map((e) => {
				if (e.data) {
					return { ...e, data: filterSecrets(e.data) };
				}
				return e;
			})
			.map((e) => ({
				type: e.type,
				message: e.message,
				data: e.data,
			}));

		const failurePatterns = extractFailurePatterns(filteredEvents);
		for (const pattern of failurePatterns) {
			const experience = createExperience(
				pattern,
				"global",
				request.humanFeedback,
			);
			experiences.push(experience);
		}

		// 4. Process human feedback
		if (request.humanFeedback) {
			for (const feedback of request.humanFeedback) {
				if (feedback.approved) {
					// Find matching experience or create new one
					const existing = experiences.find((e) =>
						e.pattern.toLowerCase().includes(feedback.taskId.toLowerCase()),
					);

					if (existing) {
						existing.status = "approved";
						existing.confidence = Math.min(100, existing.confidence + 20);
						existing.updatedAt = new Date().toISOString();
					}
				}
			}
		}

		// 5. Calculate summary
		const summary = {
			totalExtracted: experiences.length,
			approved: experiences.filter((e) => e.status === "approved").length,
			proposed: experiences.filter((e) => e.status === "proposed").length,
			rejected: experiences.filter((e) => e.status === "rejected").length,
		};

		return {
			jobId: request.jobId,
			experiences,
			summary,
			extractedAt: new Date().toISOString(),
		};
	}

	/**
	 * Approve a learned experience
	 */
	approve(experience: LearnedExperience): LearnedExperience {
		return {
			...experience,
			status: "approved",
			confidence: Math.min(100, experience.confidence + 10),
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Reject a learned experience
	 */
	reject(experience: LearnedExperience): LearnedExperience {
		return {
			...experience,
			status: "rejected",
			updatedAt: new Date().toISOString(),
		};
	}

	/**
	 * Export experience to OKF format
	 */
	toOkfFormat(experience: LearnedExperience): string {
		const timestamp = new Date().toISOString();
		const tags = experience.tags.join(", ");

		return `---
type: Engineering Lesson
title: ${experience.pattern.substring(0, 60)}
tags: [${tags}]
timestamp: ${timestamp}
authority: ${experience.status}
scope: ${experience.scope}
confidence: ${experience.confidence}
---

${experience.recommendation}

## Evidence

${
	experience.evidenceRefs.length > 0
		? experience.evidenceRefs.map((ref) => `- ${ref}`).join("\n")
		: "No evidence references available."
}

## Pattern

${experience.pattern}
`;
	}
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createLearningEngine(options?: {
	framework?: string;
	repository?: string;
}): LearningEngine {
	return new LearningEngine(options);
}
