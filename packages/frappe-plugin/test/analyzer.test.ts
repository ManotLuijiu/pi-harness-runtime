/**
 * Frappe Plugin Tests (RFC-0061)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeFrappe } from "../src/analyzer.js";

const tempRoots: string[] = [];

async function mkdtemp(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "frappe-plugin-"));
	tempRoots.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempRoots) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
	tempRoots.length = 0;
});

describe("analyzeFrappe", () => {
	it("returns null for non-frappe workspace", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		const result = await analyzeFrappe(dir);
		expect(result).toBeNull();
	});

	it("detects frappe workspace via sites directory", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "sites"), { recursive: true });
		const result = await analyzeFrappe(dir);
		expect(result).not.toBeNull();
		expect(["frappe", "erpnext"]).toContain(result!.framework.id);
	});

	it("detects frappe workspace via apps.txt", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "apps.txt"), "frappe\nerpnext\n", "utf-8");
		const result = await analyzeFrappe(dir);
		expect(result).not.toBeNull();
	});

	it("parses apps from apps.txt", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "apps"), { recursive: true });
		await fs.writeFile(path.join(dir, "apps.txt"), "frappe\nerpnext\nmy_custom_app\n", "utf-8");
		await fs.mkdir(path.join(dir, "apps", "frappe"), { recursive: true });
		await fs.mkdir(path.join(dir, "apps", "erpnext"), { recursive: true });
		await fs.mkdir(path.join(dir, "apps", "my_custom_app"), { recursive: true });
		const result = await analyzeFrappe(dir);
		expect(result).not.toBeNull();
		const appNames = result!.apps.map((a) => a.name);
		expect(appNames).toContain("frappe");
		expect(appNames).toContain("erpnext");
	});

	it("parses hooks.py to extract app_name and __version__", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "apps", "myapp", "myapp"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "apps.txt"),
			"myapp\n",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "myapp", "myapp", "hooks.py"),
			`
app_name = "myapp"
app_title = "My App"
app_publisher = "Test"
__version__ = "1.2.3"
docevents = {
    "DocType": ["validate", "on_update"],
}
`.trim(),
			"utf-8",
		);

		const result = await analyzeFrappe(dir);
		expect(result).not.toBeNull();
		const myAppHooks = result!.hooks.find((h) => h.appName === "myapp");
		expect(myAppHooks).toBeDefined();
		expect(myAppHooks!.hooks["app_name"]).toContain("myapp");
		expect(myAppHooks!.hooks["docevents"]).toBeDefined();

		const myApp = result!.apps.find((a) => a.name === "myapp");
		expect(myApp?.version).toBe("1.2.3");
	});

	it("detects ERPNext from package.json dependencies", async () => {
		const dir = await mkdtemp();
			await fs.mkdir(path.join(dir, "apps", "erpnext", "erpnext"), { recursive: true });
		await fs.mkdir(path.join(dir, "apps", "frappe", "frappe"), { recursive: true });
		await fs.writeFile(path.join(dir, "apps.txt"), "frappe\nerpnext\n", "utf-8");
		await fs.writeFile(
				path.join(dir, "apps", "erpnext", "package.json"),
				JSON.stringify({
					name: "erpnext",
					version: "14.0.0",
					dependencies: { frappe: "^14.0.0", erpnext: "^14.0.0" },
				}),
				"utf-8",
			);
		await fs.writeFile(
			path.join(dir, "apps", "erpnext", "erpnext", "hooks.py"),
			"app_name = 'erpnext'\n",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "frappe", "frappe", "hooks.py"),
			"app_name = 'frappe'\n",
			"utf-8",
		);

		const result = await analyzeFrappe(dir);
		expect(result!.isErpNext).toBe(true);
		expect(result!.framework.id).toBe("erpnext");
	});

	it("scans sites directory", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "sites", "site1.local"), { recursive: true });
		await fs.mkdir(path.join(dir, "sites", "site2.local"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "sites", "site1.local", "site_config.json"),
			JSON.stringify({ db_port: 3306 }),
			"utf-8",
		);

		const result = await analyzeFrappe(dir);
		expect(result!.sites.length).toBe(2);
		const site1 = result!.sites.find((s) => s.name === "site1.local");
		expect(site1!.dbPort).toBe(3306);
		expect(site1!.hasSiteConfig).toBe(true);
	});

	it("counts DocTypes in app module directory", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "apps", "myapp", "myapp", "doctype", "customer"), { recursive: true });
		await fs.mkdir(path.join(dir, "apps", "myapp", "myapp", "doctype", "order"), { recursive: true });
		await fs.mkdir(path.join(dir, "apps", "myapp", "myapp", "doctype", "custom_so"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "apps.txt"),
			"myapp\n",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "myapp", "myapp", "hooks.py"),
			"app_name = 'myapp'\n",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "myapp", "myapp", "doctype", "customer", "customer.json"),
			JSON.stringify({
				doctype: "DocType",
				name: "Customer",
				fields: [{ fieldname: "customer_name" }, { fieldname: "email" }],
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "myapp", "myapp", "doctype", "order", "order.json"),
			JSON.stringify({
				doctype: "DocType",
				name: "Sales Order",
				is_submittable: 1,
				fields: Array(5).fill({}),
			}),
			"utf-8",
		);

		const result = await analyzeFrappe(dir);
		expect(result!.apps.find((a) => a.name === "myapp")!.doctypeCount).toBeGreaterThanOrEqual(2);
		const customerDt = result!.doctypes.find((d) => d.name === "customer");
		expect(customerDt).toBeDefined();
		expect(customerDt!.nFields).toBe(2);
		const orderDt = result!.doctypes.find((d) => d.name === "order");
		expect(orderDt!.isSubmittable).toBe(true);
	});

	it("detects Frappe SPA from package.json", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "apps", "frappe", "frappe"), { recursive: true });
		await fs.writeFile(path.join(dir, "apps.txt"), "frappe\n", "utf-8");
		await fs.writeFile(
			path.join(dir, "apps", "frappe", "package.json"),
			JSON.stringify({ dependencies: { "@frappe/ui": "^1.0.0" } }),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "apps", "frappe", "frappe", "hooks.py"),
			"app_name = 'frappe'\n",
			"utf-8",
		);

		const result = await analyzeFrappe(dir);
		expect(result!.hasSPA).toBe(true);
	});
});
