/**
 * The evidence of a Frappe lifecycle operation.
 *
 * The fixtures of this suite are synthetic: an app of a bench that does
 * not exist, a site that does not exist and a DocType that no real app
 * owns. The evidence of the bench is read, and nothing is run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	hashOfFile,
	isInsideLifecycleConvention,
	lifecyclePathsOf,
	readBenchLayout,
	readLifecycleHooks,
	readPatchRegistry,
	resolveDocTypeOwnership,
	resolveRoutineFile,
} from "../harness/frappe-lifecycle-evidence.ts";

/**
 * A bench with two apps.
 *
 * The app `warehouse_app` owns the DocType `Item` in the module `stock`.
 * The app `ledger_app` owns the DocType `Journal`. The DocType
 * `Ghost` is owned by nobody.
 */
function syntheticBench() {
	const bench = mkdtempSync(join(tmpdir(), "synthetic-bench-"));
	const app = (name) => join(bench, "apps", name);
	const namespace = (name) => join(app(name), name);

	mkdirSync(join(namespace("warehouse_app"), "stock", "doctype", "item"), {
		recursive: true,
	});
	writeFileSync(
		join(namespace("warehouse_app"), "stock", "doctype", "item", "item.json"),
		JSON.stringify({ name: "Item", fields: [] }, null, 2),
	);
	mkdirSync(join(namespace("warehouse_app"), "commands"), { recursive: true });
	writeFileSync(
		join(namespace("warehouse_app"), "commands", "seed_items.py"),
		"def seed_items():\n    pass\n",
	);
	mkdirSync(join(namespace("warehouse_app"), "setup"), { recursive: true });
	writeFileSync(
		join(namespace("warehouse_app"), "setup", "install.py"),
		"def after_install():\n    pass\n",
	);
	writeFileSync(join(namespace("warehouse_app"), "__init__.py"), "");
	writeFileSync(
		join(app("warehouse_app"), "hooks.py"),
		[
			'after_install = ["warehouse_app.setup.install.after_install"]',
			'after_migrate = ["warehouse_app.setup.install.after_migrate"]',
			"before_uninstall = []",
		].join("\n"),
	);
	mkdirSync(join(app("warehouse_app"), "fixtures"), { recursive: true });
	writeFileSync(
		join(app("warehouse_app"), "fixtures", "custom_field.json"),
		JSON.stringify([
			{ dt: "Item", fieldname: "warehouse_code" },
			{ dt: "Other", fieldname: "unrelated" },
		]),
	);

	mkdirSync(join(namespace("ledger_app"), "accounts", "doctype", "journal"), {
		recursive: true,
	});
	writeFileSync(
		join(
			namespace("ledger_app"),
			"accounts",
			"doctype",
			"journal",
			"journal.json",
		),
		JSON.stringify({ name: "Journal", fields: [] }, null, 2),
	);
	writeFileSync(join(namespace("ledger_app"), "__init__.py"), "");

	writeFileSync(join(bench, "apps.txt"), "warehouse_app\nledger_app\n");
	return bench;
}

test("the namespace of an app is the python package of the app", async () => {
	const bench = syntheticBench();
	const layout = await readBenchLayout(bench);
	assert.equal(layout.length, 2);
	const warehouse = layout.find((entry) => entry.app === "warehouse_app");
	assert.ok(warehouse, "the app of the bench is read");
	assert.equal(warehouse.namespace, "warehouse_app");
	assert.deepEqual(warehouse.modules, ["stock"]);
	assert.equal(warehouse.ambiguous, false);
});

test("the owner of a DocType is the app that defines it", async () => {
	const bench = syntheticBench();
	const ownership = await resolveDocTypeOwnership(bench, "Item");
	assert.equal(ownership.ownerApp, "warehouse_app");
	assert.equal(ownership.namespace, "warehouse_app");
	assert.equal(ownership.module, "stock");
	assert.equal(ownership.standard, true);
	assert.equal(ownership.databaseOnly, false);
	assert.equal(ownership.ambiguous, false);
	assert.ok(ownership.sourceJson?.endsWith("stock/doctype/item/item.json"));
});

test("the DocType of another app keeps its owner", async () => {
	const bench = syntheticBench();
	const ownership = await resolveDocTypeOwnership(bench, "Journal");
	assert.equal(ownership.ownerApp, "ledger_app");
	assert.equal(ownership.standard, true);
});

test("a DocType that no app defines belongs to the database", async () => {
	const bench = syntheticBench();
	const ownership = await resolveDocTypeOwnership(bench, "Ghost");
	assert.equal(ownership.ownerApp, undefined);
	assert.equal(ownership.standard, false);
	assert.equal(ownership.databaseOnly, true);
	assert.match(ownership.reason ?? "", /no source JSON/);
});

test("the Custom Field records of a DocType are read", async () => {
	const bench = syntheticBench();
	const ownership = await resolveDocTypeOwnership(bench, "Item");
	assert.deepEqual(ownership.customFields, ["warehouse_code"]);
	assert.ok(ownership.fixtures.length > 0);
});

test("the hooks of an app and its install module are read", async () => {
	const bench = syntheticBench();
	const hooks = await readLifecycleHooks(bench, "warehouse_app");
	assert.deepEqual(hooks.afterInstall, [
		"warehouse_app.setup.install.after_install",
	]);
	assert.deepEqual(hooks.afterMigrate, [
		"warehouse_app.setup.install.after_migrate",
	]);
	assert.deepEqual(hooks.beforeUninstall, []);
	assert.ok(hooks.installModule?.endsWith("setup/install.py"));
});

test("the paths of the convention name the namespace of the app", async () => {
	const bench = syntheticBench();
	const layout = (await readBenchLayout(bench)).find(
		(entry) => entry.app === "warehouse_app",
	);
	assert.ok(layout);
	const paths = lifecyclePathsOf(layout);
	assert.ok(paths.commands.endsWith("warehouse_app/commands"));
	assert.ok(paths.setup.endsWith("warehouse_app/setup"));
	assert.ok(paths.module.endsWith("warehouse_app/stock/doctype"));
});

test("a routine of the commands directory is inside the convention", async () => {
	const bench = syntheticBench();
	const layout = (await readBenchLayout(bench)).find(
		(entry) => entry.app === "warehouse_app",
	);
	assert.ok(layout);
	const inside = isInsideLifecycleConvention(
		join(layout.path, "warehouse_app", "commands", "seed_items.py"),
		layout,
	);
	assert.equal(inside.inside, true);
});

test("a routine outside the namespace is outside the convention", async () => {
	const bench = syntheticBench();
	const layout = (await readBenchLayout(bench)).find(
		(entry) => entry.app === "warehouse_app",
	);
	assert.ok(layout);
	const outside = isInsideLifecycleConvention(
		join(layout.path, "warehouse_app", "helpers", "seed_items.py"),
		layout,
	);
	assert.equal(outside.inside, false);
});

test("the convention of an app without a namespace is not clear", async () => {
	const bench = syntheticBench();
	const layout = (await readBenchLayout(bench)).find(
		(entry) => entry.app === "warehouse_app",
	);
	assert.ok(layout);
	const without = isInsideLifecycleConvention(
		join(layout.path, "warehouse_app", "commands", "seed_items.py"),
		{ ...layout, namespace: undefined },
	);
	assert.equal(without.inside, false);
	assert.match(without.reason, /namespace/);
});

test("the file of a routine is found in the bench", async () => {
	const bench = syntheticBench();
	const file = await resolveRoutineFile(
		bench,
		"warehouse_app",
		"warehouse_app.setup.install.after_install",
	);
	assert.ok(file, "the routine of the hook is in the setup directory");
	assert.match(file, /setup[/\\]install\.py$/);
});

test("a routine that the bench does not have is not found", async () => {
	const bench = syntheticBench();
	const missing = await resolveRoutineFile(
		bench,
		"warehouse_app",
		"warehouse_app.setup.install.not_registered",
	);
	assert.equal(missing, undefined);
});

test("a routine of another namespace is not found", async () => {
	const bench = syntheticBench();
	const other = await resolveRoutineFile(
		bench,
		"warehouse_app",
		"ledger_app.accounts.install.after_install",
	);
	assert.equal(other, undefined);
});

test("the patches of the namespace are read", async () => {
	const bench = syntheticBench();
	mkdirSync(join(bench, "apps", "warehouse_app", "warehouse_app"), {
		recursive: true,
	});
	writeFileSync(
		join(bench, "apps", "warehouse_app", "warehouse_app", "patches.txt"),
		[
			"# the patches of the app",
			"warehouse_app.patches.v1_0.set_default_warehouse",
			"",
			"warehouse_app.patches.v1_0.rename_warehouse_bin",
			"",
		].join("\n"),
		"utf8",
	);
	const patches = await readPatchRegistry(bench, "warehouse_app");
	assert.deepEqual(patches, [
		"warehouse_app.patches.v1_0.set_default_warehouse",
		"warehouse_app.patches.v1_0.rename_warehouse_bin",
	]);
	// An app without a patches file registers nothing.
	assert.deepEqual(await readPatchRegistry(bench, "ledger_app"), []);
});

test("the hash of a file is its digest", async () => {
	const bench = syntheticBench();
	const file = join(
		bench,
		"apps",
		"warehouse_app",
		"warehouse_app",
		"setup",
		"install.py",
	);
	const hash = hashOfFile(file);
	assert.ok(hash);
	assert.match(hash, /^[0-9a-f]{64}$/);
	// The hash of a file that is not there is nothing.
	assert.equal(hashOfFile(join(bench, "nothing.py")), undefined);
});
