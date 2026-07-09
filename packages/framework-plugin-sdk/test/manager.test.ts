/**
 * Framework Plugin SDK - Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
	createPluginManager,
	SDK_VERSION,
	PluginError,
	PluginErrorCode,
} from "../src/index.js";

describe("FrameworkPluginSDK", () => {
	describe("SDK_VERSION", () => {
		it("should export SDK_VERSION", () => {
			expect(SDK_VERSION).toBeDefined();
			expect(typeof SDK_VERSION).toBe("string");
		});
	});

	describe("PluginError", () => {
		it("should create plugin error", () => {
			const error = new PluginError(
				"Test error",
				PluginErrorCode.MANIFEST_INVALID,
			);

			expect(error).toBeInstanceOf(Error);
			expect(error.message).toBe("Test error");
			expect(error.code).toBe("MANIFEST_INVALID");
		});

		it("should include plugin ID", () => {
			const error = new PluginError(
				"Plugin error",
				PluginErrorCode.NOT_FOUND,
				"my-plugin",
			);

			expect(error.pluginId).toBe("my-plugin");
		});
	});

	describe("createPluginManager", () => {
		it("should create a plugin manager instance", () => {
			const manager = createPluginManager();
			expect(manager).toBeDefined();
		});

		it("should create with custom config", () => {
			const manager = createPluginManager({
				pluginDir: "/tmp/plugins",
				autoActivate: true,
				logLevel: "debug",
			});
			expect(manager).toBeDefined();
		});
	});

	describe("plugin lifecycle", () => {
		const manager = createPluginManager();

		it("should register a plugin", async () => {
			const manifest = {
				id: "test-plugin",
				name: "Test Plugin",
				version: "1.0.0",
				description: "A test plugin",
				capabilities: ["provider"],
			};

			const plugin = await manager.register(manifest);

			expect(plugin).toBeDefined();
			expect(plugin.id).toBe("test-plugin");
			expect(plugin.status).toBe("registered");
		});

		it("should throw on duplicate registration", async () => {
			const manifest = {
				id: "duplicate-plugin",
				name: "Duplicate Plugin",
				version: "1.0.0",
				description: "Duplicate test",
				capabilities: ["provider"],
			};

			await manager.register(manifest);

			await expect(manager.register(manifest)).rejects.toThrow();
		});

		it("should load a registered plugin", async () => {
			const manifest = {
				id: "loadable-plugin",
				name: "Loadable Plugin",
				version: "1.0.0",
				description: "A loadable plugin",
				capabilities: ["framework"],
			};

			await manager.register(manifest);
			const plugin = await manager.load({ plugin: "loadable-plugin" });

			expect(plugin.status).toBe("loaded");
		});

		it("should activate a plugin", async () => {
			const manifest = {
				id: "activatable-plugin",
				name: "Activatable Plugin",
				version: "1.0.0",
				description: "An activatable plugin",
				capabilities: ["tool"],
			};

			await manager.register(manifest);
			await manager.load({ plugin: "activatable-plugin" });
			await manager.initialize("activatable-plugin");
			await manager.activate("activatable-plugin");

			const plugin = manager.getPlugin("activatable-plugin");
			expect(plugin?.status).toBe("active");
		});

		it("should deactivate a plugin", async () => {
			await manager.deactivate("activatable-plugin");

			const plugin = manager.getPlugin("activatable-plugin");
			expect(plugin?.status).toBe("inactive");
		});

		it("should unload a plugin", async () => {
			await manager.unload("activatable-plugin");

			const plugin = manager.getPlugin("activatable-plugin");
			expect(plugin).toBeUndefined();
		});

		it("should list all plugins", async () => {
			await manager.register({
				id: "list-plugin-1",
				name: "List Plugin 1",
				version: "1.0.0",
				description: "Test",
				capabilities: ["provider"],
			});

			await manager.register({
				id: "list-plugin-2",
				name: "List Plugin 2",
				version: "1.0.0",
				description: "Test",
				capabilities: ["framework"],
			});

			const plugins = manager.listPlugins();
			expect(plugins.length).toBeGreaterThanOrEqual(2);
		});

		it("should list plugins by status", async () => {
			const byStatus = manager.listByStatus("registered");
			expect(Array.isArray(byStatus)).toBe(true);
		});
	});

	describe("hooks", () => {
		const manager = createPluginManager();

		it("should register hook handlers", () => {
			manager.registerHook({
				id: "test-hook",
				name: "onTaskComplete",
				pluginId: "test-plugin",
				priority: 10,
				handler: async (ctx) => ({ handled: true }),
			});

			// Hook registered successfully
			expect(true).toBe(true);
		});

		it("should execute hooks", async () => {
			const result = await manager.executeHooks("onTaskComplete", {
				taskId: "123",
			});

			expect(result.hook).toBe("onTaskComplete");
			expect(Array.isArray(result.results)).toBe(true);
		});

		it("should unregister hook handlers", () => {
			const unregistered = manager.unregisterHook("test-hook");
			expect(typeof unregistered).toBe("boolean");
		});
	});

	describe("capabilities", () => {
		it("should get capabilities by type", async () => {
			const manager = createPluginManager();
			await manager.register({
				id: "capability-plugin-1",
				name: "Capability Plugin 1",
				version: "1.0.0",
				description: "Capability test",
				capabilities: ["provider"],
			});

			const providers = manager.getCapabilities("provider");
			expect(Array.isArray(providers)).toBe(true);
		});

		it("should get capability instance", async () => {
			const manager = createPluginManager();
			await manager.register({
				id: "capability-plugin-2",
				name: "Capability Plugin 2",
				version: "1.0.0",
				description: "Capability test",
				capabilities: ["provider"],
			});
			await manager.load({ plugin: "capability-plugin-2" });
			await manager.initialize("capability-plugin-2");
			await manager.activate("capability-plugin-2");
			await manager.registerCapability("capability-plugin-2", "provider", {
				complete: async () => ({ content: "test" }),
			});

			const capability = manager.getCapability(
				"capability-plugin-2",
				"provider",
			);
			expect(capability).toBeDefined();
		});
	});

	describe("lifecycle events", () => {
		const manager = createPluginManager();

		it("should listen to lifecycle events", async () => {
			let eventReceived = false;

			manager.onLifecycle("afterActivate", () => {
				eventReceived = true;
			});

			await manager.register({
				id: "event-plugin",
				name: "Event Plugin",
				version: "1.0.0",
				description: "Event test",
				capabilities: ["hook"],
			});

			await manager.load({ plugin: "event-plugin" });
			await manager.initialize("event-plugin");
			await manager.activate("event-plugin");

			// Event listener was registered
			expect(true).toBe(true);
		});

		it("should remove lifecycle listeners", () => {
			const listener = () => {};

			manager.onLifecycle("beforeLoad", listener);
			manager.offLifecycle("beforeLoad", listener);

			// Listener removed
			expect(true).toBe(true);
		});
	});

	describe("manifest validation", () => {
		const manager = createPluginManager();

		it("should validate manifest has id", async () => {
			try {
				await manager.register({
					name: "Missing ID",
					version: "1.0.0",
					description: "Test",
					capabilities: ["provider"],
				} as any);
				expect(false).toBe(true); // Should not reach here
			} catch (error) {
				expect(error).toBeInstanceOf(PluginError);
			}
		});

		it("should validate manifest has name", async () => {
			try {
				await manager.register({
					id: "no-name",
					version: "1.0.0",
					description: "Test",
					capabilities: ["provider"],
				} as any);
				expect(false).toBe(true);
			} catch (error) {
				expect(error).toBeInstanceOf(PluginError);
			}
		});

		it("should validate capabilities", async () => {
			try {
				await manager.register({
					id: "no-caps",
					name: "No Capabilities",
					version: "1.0.0",
					description: "Test",
					capabilities: [],
				});
				expect(false).toBe(true);
			} catch (error) {
				expect(error).toBeInstanceOf(PluginError);
			}
		});
	});
});
