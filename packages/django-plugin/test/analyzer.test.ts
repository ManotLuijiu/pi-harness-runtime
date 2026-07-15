/**
 * Django Plugin Tests (RFC-0064)
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeDjango } from "../src/analyzer.js";

const roots: string[] = [];

async function mkdtemp(): Promise<string> {
	const d = await fs.mkdtemp(path.join(os.tmpdir(), "django-plugin-"));
	roots.push(d);
	return d;
}

afterEach(async () => {
	for (const d of roots) {
		try {
			await fs.rm(d, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
	roots.length = 0;
});

describe("analyzeDjango", () => {
	it("returns null for non-django workspace", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		expect(await analyzeDjango(dir)).toBeNull();
	});

	it("detects django workspace via manage.py", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "manage.py"),
			"#!/usr/bin/env python",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0\ndjangorestframework",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result).not.toBeNull();
		expect(result!.framework.id).toBe("django");
	});

	it("detects django workspace via settings.py", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "settings.py"), "DEBUG = True", "utf-8");
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result).not.toBeNull();
	});

	it("extracts version from requirements.txt", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "manage.py"),
			"#!/usr/bin/env python",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django==4.2.10\ndjangorestframework==3.14.0",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result!.version).toBe("4.2.10");
	});

	it("parses INSTALLED_APPS from settings.py", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "settings.py"),
			`
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'rest_framework',
    'myapp.core',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
]
`.trim(),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result!.middleware).toContain(
			"django.middleware.security.SecurityMiddleware",
		);
	});

	it("detects Django REST Framework", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "settings.py"),
			`
INSTALLED_APPS = [
    'django.contrib.admin',
    'rest_framework',
]
`.trim(),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0\ndjangorestframework",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result!.drfEnabled).toBe(true);
	});

	it("counts model classes in app models.py", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "myapp"), { recursive: true });
		await fs.writeFile(
			path.join(dir, "settings.py"),
			"INSTALLED_APPS = []",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "myapp", "models.py"),
			`
from django.db import models

class Customer(models.Model):
    name = models.CharField(max_length=100)

class Order(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
`,
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		const myApp = result!.apps.find((a) => a.name === "myapp");
		expect(myApp).toBeDefined();
		// Conservative: at least 2 classes detected
		expect(myApp!.modelCount).toBeGreaterThanOrEqual(2);
	});

	it("finds management commands", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "myapp", "management", "commands"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "settings.py"),
			"INSTALLED_APPS = []",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "requirements.txt"),
			"django>=4.0",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "myapp", "management", "commands", "send_email.py"),
			"# management command",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "myapp", "management", "commands", "cleanup.py"),
			"# cleanup",
			"utf-8",
		);
		const result = await analyzeDjango(dir);
		expect(result!.managementCommands).toContain("send_email");
		expect(result!.managementCommands).toContain("cleanup");
	});
});
