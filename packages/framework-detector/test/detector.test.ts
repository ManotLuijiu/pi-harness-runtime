/**
 * Framework Detector - Tests
 */

import { describe, it, expect } from "bun:test";
import { createFrameworkDetector, SDK_VERSION } from "../src/index.js";

describe("FrameworkDetector", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("createFrameworkDetector", () => {
		it("should create a framework detector instance", () => {
			const detector = createFrameworkDetector();
			expect(detector).toBeDefined();
		});

		it("should create with custom config", () => {
			const detector = createFrameworkDetector({
				confidenceThreshold: 0.5,
				detectVersions: true,
			});
			expect(detector).toBeDefined();
		});
	});

	describe("framework signatures", () => {
		const detector = createFrameworkDetector();

		it("should have built-in signatures", () => {
			const registry = detector.getRegistry();
			const signatures = registry.list();
			expect(signatures.length).toBeGreaterThan(0);
		});

		it("should detect React", () => {
			const signatures = detector.getRegistry().list();
			const react = signatures.find((s) => s.id === "react");
			expect(react).toBeDefined();
			expect(react?.name).toBe("React");
		});

		it("should detect Next.js", () => {
			const signatures = detector.getRegistry().list();
			const nextjs = signatures.find((s) => s.id === "nextjs");
			expect(nextjs).toBeDefined();
			expect(nextjs?.name).toBe("Next.js");
		});

		it("should detect Frappe", () => {
			const signatures = detector.getRegistry().list();
			const frappe = signatures.find((s) => s.id === "frappe");
			expect(frappe).toBeDefined();
			expect(frappe?.name).toBe("Frappe");
		});
	});

	describe("registry operations", () => {
		const detector = createFrameworkDetector();

		it("should get signatures by category", () => {
			const frontend = detector.getRegistry().byCategory("frontend");
			expect(frontend.length).toBeGreaterThan(0);
		});

		it("should get registry", () => {
			const registry = detector.getRegistry();
			expect(registry).toBeDefined();
		});
	});
});
