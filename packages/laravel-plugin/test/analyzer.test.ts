/**
 * Laravel Plugin Tests (RFC-0065)
 */

import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { analyzeLaravel } from "../src/analyzer.js";

const roots: string[] = [];

async function mkdtemp(): Promise<string> {
	const d = await fs.mkdtemp(path.join(os.tmpdir(), "laravel-plugin-"));
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

describe("analyzeLaravel", () => {
	it("returns null for non-laravel workspace", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(path.join(dir, "package.json"), "{}", "utf-8");
		expect(await analyzeLaravel(dir)).toBeNull();
	});

	it("detects laravel workspace via artisan", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "artisan"),
			"#!/usr/bin/env php",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				name: "laravel/laravel",
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result).not.toBeNull();
		expect(result!.framework.id).toBe("laravel");
	});

	it("detects laravel workspace via app structure", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "app", "Http", "Controllers"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result).not.toBeNull();
	});

	it("extracts version from composer.json", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "artisan"),
			"#!/usr/bin/env php",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result!.version).toBe("10.0");
	});

	it("lists controllers", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "app", "Http", "Controllers"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "app", "Http", "Controllers", "UserController.php"),
			"class UserController {}",
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "app", "Http", "Controllers", "PostController.php"),
			"class PostController {}",
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result!.controllers).toContain("UserController");
		expect(result!.controllers).toContain("PostController");
	});

	it("counts migrations", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "database", "migrations"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(
				dir,
				"database",
				"migrations",
				"2024_01_01_000000_create_users_table.php",
			),
			"create table",
			"utf-8",
		);
		await fs.writeFile(
			path.join(
				dir,
				"database",
				"migrations",
				"2024_01_02_000000_create_posts_table.php",
			),
			"create table",
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result!.migrations).toBe(2);
	});

	it("detects Sanctum auth", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0", "laravel/sanctum": "^3.0" },
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "artisan"),
			"#!/usr/bin/env php",
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result!.authType).toBe("sanctum");
	});

	it("lists artisan commands", async () => {
		const dir = await mkdtemp();
		await fs.mkdir(path.join(dir, "app", "Console", "Commands"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "app", "Console", "Commands", "SendEmailCommand.php"),
			"class SendEmailCommand {}",
			"utf-8",
		);
		const result = await analyzeLaravel(dir);
		expect(result!.commands).toContain("SendEmailCommand");
	});

	it("extracts env variables", async () => {
		const dir = await mkdtemp();
		await fs.writeFile(
			path.join(dir, ".env.example"),
			`
APP_NAME=Laravel
APP_ENV=local
APP_KEY=
DB_CONNECTION=mysql
MAIL_MAILER=smtp
`.trim(),
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "composer.json"),
			JSON.stringify({
				require: { "laravel/framework": "^10.0" },
			}),
			"utf-8",
		);
		await fs.mkdir(path.join(dir, "app", "Http", "Controllers"), {
			recursive: true,
		});
		const result = await analyzeLaravel(dir);
		expect(result!.envVars).toContain("APP_NAME");
		expect(result!.envVars).toContain("DB_CONNECTION");
	});
});
