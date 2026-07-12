/**
 * Observability - Tests
 */

import { describe, it, expect } from "bun:test";
import { createLogger, SDK_VERSION } from "../src/index.js";

describe("Observability", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("Logger", () => {
		it("should create a logger instance", () => {
			const logger = createLogger();
			expect(logger).toBeDefined();
		});

		it("should log messages", () => {
			const logger = createLogger();
			logger.info("Test message");
			expect(true).toBe(true); // Logger ran without errors
		});

		it("should create logger with config", () => {
			const logger = createLogger({
				level: "debug",
				format: "json",
			});
			expect(logger).toBeDefined();
		});

		it("should log at different levels", () => {
			const logger = createLogger({ level: "debug" });
			logger.debug("Debug message");
			logger.info("Info message");
			logger.warn("Warn message");
			logger.error("Error message");
			expect(true).toBe(true);
		});
	});
});
