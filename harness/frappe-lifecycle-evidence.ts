/**
 * The evidence of a Frappe lifecycle operation.
 *
 * The policy of a lifecycle operation decides with facts, and the facts
 * come from the bench: the app that owns a DocType, the namespace of the
 * app, the module under the namespace, the hooks that are registered and
 * the Custom Field records that exist.
 *
 * The ownership comes first. The folder convention is only read after the
 * owner of a DocType is known: a routine of an app that owns the DocType
 * edits the source JSON of the DocType, and a routine of an app that does
 * not own it uses the Custom Field mechanism. An ownership that cannot be
 * established is not resolved by guessing: the evidence says that it is
 * ambiguous, and the policy blocks the operation.
 *
 * The path convention of the repository is the one of the framework:
 *
 *     {bench}/apps/{app}/{namespace}/commands/*
 *     {bench}/apps/{app}/{namespace}/setup/*
 *     {bench}/apps/{app}/{namespace}/{module}/doctype/*
 *
 * The namespace usually matches the name of the app, but it is verified
 * and never assumed: an app with one same-named module repeats its name
 * three times, and that is correct.
 *
 * Nothing here runs a command of the bench and nothing here writes to a
 * site: the module reads the files of the bench.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** The layout of one app of the bench. */
export interface FrappeAppLayout {
	/** The name of the app. */
	app: string;
	/** The path of the app. */
	path: string;
	/** The python namespace of the app, when it was verified. */
	namespace?: string;
	/** The modules of the namespace. */
	modules: string[];
	/** The files that were read to establish the layout. */
	evidence: string[];
	/** The namespace is not clear. */
	ambiguous: boolean;
}

/** The owner of a DocType, as far as the files of the bench can tell. */
export interface DocTypeOwnership {
	/** The DocType. */
	doctype: string;
	/** The app that owns the DocType. */
	ownerApp?: string;
	/** The python namespace of the owning app. */
	namespace?: string;
	/** The module under the namespace that holds the DocType. */
	module?: string;
	/** The path of the JSON that defines the DocType. */
	sourceJson?: string;
	/** The DocType is defined in the source of an app. */
	standard: boolean;
	/** The DocType exists only as a record of the database. */
	databaseOnly: boolean;
	/** The fields that a Custom Field record adds to the DocType. */
	customFields: string[];
	/** The fixtures that carry a Custom Field of the DocType. */
	fixtures: string[];
	/** What was read to reach the conclusion. */
	evidence: string[];
	/** The ownership could not be established. */
	ambiguous: boolean;
	/** Why the ownership is ambiguous. */
	reason?: string;
}

/** The lifecycle hooks of one app. */
export interface LifecycleHookEvidence {
	/** The app. */
	app: string;
	/** The python namespace of the app. */
	namespace?: string;
	/** The path of the hooks file. */
	hooksFile?: string;
	/** The functions that are registered for after_install. */
	afterInstall: string[];
	/** The functions that are registered for after_migrate. */
	afterMigrate: string[];
	/** The functions that are registered for before_uninstall. */
	beforeUninstall: string[];
	/** The path of the module that orchestrates the installation. */
	installModule?: string;
	/** The evidence that was read. */
	evidence: string[];
}

/**
 * The apps of the bench and the namespace of every app.
 *
 * The apps are the ones of the `apps` directory and the ones of
 * `apps.txt`: a bench that lists an app that is not installed yet still
 * names it, and the evidence of such an app is read as far as it goes.
 */
export async function readBenchLayout(
	benchPath: string,
): Promise<FrappeAppLayout[]> {
	const appsDir = join(benchPath, "apps");
	const names = new Set<string>();
	try {
		for (const entry of await readdir(appsDir)) {
			if (entry.startsWith(".")) continue;
			if (!statSync(join(appsDir, entry)).isDirectory()) continue;
			names.add(entry);
		}
	} catch {
		// A bench without an apps directory has no app.
	}
	try {
		const listed = readFileSync(join(benchPath, "apps.txt"), "utf8");
		for (const name of listed.split(/\r?\n/)) {
			const trimmed = name.trim();
			if (trimmed.length === 0) continue;
			names.add(trimmed);
		}
	} catch {
		// A bench without an apps.txt still has its apps directory.
	}
	const layouts: FrappeAppLayout[] = [];
	for (const app of [...names].sort()) {
		layouts.push(await readAppLayout(appsDir, app));
	}
	return layouts;
}

/**
 * The layout of one app.
 *
 * The namespace is the python package of the app: the directory of the app
 * that carries an `__init__.py`. When several directories qualify, the
 * layout is ambiguous, and the policy treats an ambiguous namespace as
 * unknown evidence.
 */
async function readAppLayout(
	appsDir: string,
	app: string,
): Promise<FrappeAppLayout> {
	const appPath = join(appsDir, app);
	const evidence: string[] = [];
	const candidates: string[] = [];
	try {
		for (const entry of await readdir(appPath)) {
			if (entry.startsWith(".") || entry.startsWith("_")) continue;
			if (!statSync(join(appPath, entry)).isDirectory()) continue;
			if (!existsSync(join(appPath, entry, "__init__.py"))) continue;
			candidates.push(entry);
		}
	} catch {
		// The app is not installed: it has no namespace.
	}
	candidates.sort();
	let namespace: string | undefined;
	let ambiguous = false;
	if (candidates.length === 1) {
		namespace = candidates[0];
		evidence.push(`namespace ${namespace} (the only python package of the app)`);
	} else if (candidates.length > 1) {
		ambiguous = true;
		evidence.push(
			`the python packages of the app are ${candidates.join(", ")}: the namespace is not clear`,
		);
	}
	const modules = namespace
		? await readModules(join(appPath, namespace), evidence)
		: [];
	return { app, path: appPath, namespace, modules, evidence, ambiguous };
}

/**
 * The modules under the namespace.
 *
 * The modules of an app are the directories of the namespace that carry a
 * `doctype` directory: a directory without one holds no DocType, and it is
 * a helper, not a module of the app.
 */
async function readModules(
	namespacePath: string,
	evidence: string[],
): Promise<string[]> {
	const modules: string[] = [];
	try {
		for (const entry of await readdir(namespacePath)) {
			if (entry.startsWith(".") || entry.startsWith("_")) continue;
			if (!statSync(join(namespacePath, entry)).isDirectory()) continue;
			if (!existsSync(join(namespacePath, entry, "doctype"))) continue;
			modules.push(entry);
		}
	} catch {
		// The namespace has no module.
	}
	modules.sort();
	if (modules.length > 0) {
		evidence.push(`modules ${modules.join(", ")}`);
	}
	return modules;
}

/**
 * The owner of a DocType.
 *
 * The DocType is looked for in the source of every app of the bench. An
 * app that owns it defines it in the JSON of its module, and that JSON is
 * the source of truth: Frappe synchronizes the schema from it.
 *
 * A DocType that no app defines is a DocType of the database. Such a
 * DocType has no source JSON, so a routine that edits a JSON of it would
 * edit nothing: the operation needs the Custom Field mechanism or a
 * migration, and the evidence says which one is possible.
 *
 * A DocType that two apps define is ambiguous, and the policy blocks it:
 * a name that two apps own is not a name that one app owns.
 */
export async function resolveDocTypeOwnership(
	benchPath: string,
	doctype: string,
): Promise<DocTypeOwnership> {
	const evidence: string[] = [];
	const layout = await readBenchLayout(benchPath);
	const owners: {
		app: string;
		namespace?: string;
		module: string;
		sourceJson: string;
	}[] = [];
	for (const app of layout) {
		if (!app.namespace || app.ambiguous) continue;
		for (const module of app.modules) {
			for (const directory of doctypeDirectories(doctype)) {
				const sourceJson = join(
					app.path,
					app.namespace,
					module,
					"doctype",
					directory,
					`${directory}.json`,
				);
				if (!existsSync(sourceJson)) continue;
				owners.push({
					app: app.app,
					namespace: app.namespace,
					module,
					sourceJson,
				});
				evidence.push(
					`${doctype} is defined by ${app.app} in ${app.namespace}/${module}/doctype/${directory}`,
				);
			}
		}
	}
	const customFields = await readCustomFields(benchPath, doctype, evidence);
	const fixtures = await readFixtureFiles(benchPath, doctype, evidence);
	if (owners.length > 1) {
		return {
			doctype,
			standard: false,
			databaseOnly: false,
			customFields,
			fixtures,
			evidence,
			ambiguous: true,
			reason: `the apps ${owners
				.map((owner) => owner.app)
				.join(", ")} define the DocType ${doctype}: the owner is not clear`,
		};
	}
	if (owners.length === 0) {
		return {
			doctype,
			standard: false,
			databaseOnly: true,
			customFields,
			fixtures,
			evidence,
			ambiguous: false,
			reason:
				customFields.length > 0
					? `the DocType ${doctype} has no source JSON in the bench; the Custom Field records ${customFields.join(
							", ",
						)} describe it`
					: `the DocType ${doctype} has no source JSON in the bench and no Custom Field record`,
		};
	}
	const owner = owners[0];
	return {
		doctype,
		ownerApp: owner.app,
		namespace: owner.namespace,
		module: owner.module,
		sourceJson: owner.sourceJson,
		standard: true,
		databaseOnly: false,
		customFields,
		fixtures,
		evidence,
		ambiguous: false,
	};
}

/**
 * The directories a DocType may live in.
 *
 * The framework names the directory of a DocType in lower case, and the
 * name of the DocType itself keeps its case: the DocType `Item` lives in
 * `doctype/item`. The name with underscores is the third form, because a
 * DocType of two words is written `Item Category` in the records and
 * `item_category` in the directories.
 */
function doctypeDirectories(doctype: string): string[] {
	const candidates = [
		doctype,
		doctype.toLowerCase(),
		doctype.toLowerCase().replace(/\s+/g, "_"),
	];
	return [...new Set(candidates)];
}

/**
 * The fields that a Custom Field record adds to a DocType.
 *
 * The records live in the fixtures of the apps and in the exported
 * `custom_field.json` of a site. A field that is defined in the source of
 * the owning app is not a Custom Field record: it is a native field, and
 * it needs no second installer.
 */
async function readCustomFields(
	benchPath: string,
	doctype: string,
	evidence: string[],
): Promise<string[]> {
	const fields = new Set<string>();
	const layout = await readBenchLayout(benchPath);
	for (const app of layout) {
		for (const candidate of [
			join(app.path, "fixtures", "custom_field.json"),
			join(app.path, "custom_fields.json"),
		]) {
			if (!existsSync(candidate)) continue;
			const records = readJsonArray(candidate);
			if (!records) continue;
			for (const record of records) {
				if (!isRecord(record)) continue;
				if (record.dt !== doctype && record.doctype !== doctype) continue;
				const fieldname = record.fieldname;
				if (typeof fieldname === "string" && fieldname.length > 0) {
					fields.add(fieldname);
					evidence.push(
						`the Custom Field record ${fieldname} of ${doctype} is in ${candidate}`,
					);
				}
			}
		}
	}
	return [...fields].sort();
}

/**
 * The fixtures that carry a Custom Field of a DocType.
 */
async function readFixtureFiles(
	benchPath: string,
	doctype: string,
	evidence: string[],
): Promise<string[]> {
	const fixtures: string[] = [];
	const layout = await readBenchLayout(benchPath);
	for (const app of layout) {
		const dir = join(app.path, "fixtures");
		if (!existsSync(dir)) continue;
		let names: string[] = [];
		try {
			names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
		} catch {
			continue;
		}
		for (const name of names) {
			const path = join(dir, name);
			const records = readJsonArray(path);
			if (!records) continue;
			const touches = records.some(
				(record) =>
					isRecord(record) &&
					(record.dt === doctype || record.doctype === doctype),
			);
			if (!touches) continue;
			fixtures.push(path);
			evidence.push(`the fixture ${path} carries records of ${doctype}`);
		}
	}
	return fixtures.sort();
}

/**
 * The lifecycle hooks of an app.
 *
 * The hooks file names the functions of the hooks, and the install module
 * of the namespace is the place where the orchestration lives. Both are
 * read: a hook that is not registered is not a hook, and a function that
 * is registered in a file that the app does not ship is not evidence.
 */
export async function readLifecycleHooks(
	benchPath: string,
	app: string,
): Promise<LifecycleHookEvidence> {
	const layout = (await readBenchLayout(benchPath)).find(
		(entry) => entry.app === app,
	);
	const evidence: string[] = [];
	const hooksFile = layout ? join(layout.path, "hooks.py") : undefined;
	const registered: {
		afterInstall: string[];
		afterMigrate: string[];
		beforeUninstall: string[];
	} = { afterInstall: [], afterMigrate: [], beforeUninstall: [] };
	if (hooksFile && existsSync(hooksFile)) {
		evidence.push(`hooks ${hooksFile}`);
		const source = readFileSync(hooksFile, "utf8");
		registered.afterInstall = hookEntries(source, "after_install");
		registered.afterMigrate = hookEntries(source, "after_migrate");
		registered.beforeUninstall = hookEntries(source, "before_uninstall");
	}
	let installModule: string | undefined;
	if (layout?.namespace) {
		const candidate = join(
			layout.path,
			layout.namespace,
			"setup",
			"install.py",
		);
		if (existsSync(candidate)) {
			installModule = candidate;
			evidence.push(`the install module ${candidate}`);
		}
	}
	return {
		app,
		namespace: layout?.namespace,
		hooksFile: hooksFile && existsSync(hooksFile) ? hooksFile : undefined,
		afterInstall: registered.afterInstall,
		afterMigrate: registered.afterMigrate,
		beforeUninstall: registered.beforeUninstall,
		installModule,
		evidence,
	};
}

/**
 * The entries of one hook of the hooks file.
 *
 * The hooks file is Python, and the hooks are written in three ways: as a
 * list of dotted paths, as one dotted path, and as an entry of a
 * dictionary. All three are read, and the entries are the dotted paths
 * themselves: a hook that is a lambda or a call is not a dotted function
 * path, and the plan asks for one function path per hook.
 */
function hookEntries(source: string, hook: string): string[] {
	const found: string[] = [];
	const list = new RegExp(`^\\s*${hook}\\s*=\\s*\\[([^\\]]*)\\]`, "gm");
	for (const match of source.matchAll(list)) {
		found.push(...quotedNames(match[1]));
	}
	const single = new RegExp(`^\\s*${hook}\\s*=\\s*["']([^"']+)["']`, "gm");
	for (const match of source.matchAll(single)) {
		found.push(match[1].trim());
	}
	const dictionary = new RegExp(`["']${hook}["']\\s*:\\s*\\[([^\\]]*)\\]`, "g");
	for (const match of source.matchAll(dictionary)) {
		found.push(...quotedNames(match[1]));
	}
	return [...new Set(found)];
}

/**
 * The names that a list of strings holds.
 */
function quotedNames(body: string): string[] {
	const names: string[] = [];
	for (const entry of body.matchAll(/["']([^"']+)["']/g)) {
		const value = entry[1].trim();
		if (value.length === 0) continue;
		names.push(value);
	}
	return names;
}

/**
 * The file of a routine.
 *
 * The routine of a proposal is a python function of the app. The file
 * that defines it is the evidence of the place of the routine, of the
 * code that has to be reviewed and of the size of the work. A routine
 * that the bench does not have is a routine nobody inspected, and the
 * policy keeps it unknown.
 */
export async function resolveRoutineFile(
	benchPath: string,
	app: string,
	dotted: string,
): Promise<string | undefined> {
	const layout = (await readBenchLayout(benchPath)).find(
		(entry) => entry.app === app,
	);
	if (!layout?.namespace) return undefined;
	const segments = dotted.split(".").filter((part) => part.length > 0);
	if (segments.length < 2) return undefined;
	if (segments[0] !== layout.namespace) return undefined;
	const name = segments[segments.length - 1];
	const modulePath = segments.slice(1, -1);
	const root = join(layout.path, layout.namespace);
	// The dotted path names the module of the routine and the function in
	// it: the module is a file of the namespace or a package of it, and
	// the function is in that file.
	const candidates = [
		modulePath.length > 0 ? `${join(root, ...modulePath)}.py` : undefined,
		modulePath.length > 0
			? join(root, ...modulePath, "__init__.py")
			: join(root, "__init__.py"),
		join(root, ...modulePath, `${name}.py`),
	].filter((candidate): candidate is string => candidate !== undefined);
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		if (!definesFunction(candidate, name)) continue;
		return candidate;
	}
	return undefined;
}

/**
 * Does the file define the function?
 *
 * The definition of the function is what the file has to show: a file
 * that exists without the function is not the routine.
 */
function definesFunction(path: string, name: string): boolean {
	let source: string;
	try {
		source = readFileSync(path, "utf8");
	} catch {
		return false;
	}
	const pattern = new RegExp(
		`(?:^|\\n)\\s*(?:async\\s+)?def\\s+${name}\\s*\\(`,
	);
	return pattern.test(source);
}

/**
 * The patches of an app.
 *
 * The patches file of the namespace is the registration of the
 * migrations of the app: a patch that is not named there is not
 * registered, and the repetition of a registered patch is recorded by the
 * patch log of the site.
 */
export async function readPatchRegistry(
	benchPath: string,
	app: string,
): Promise<string[]> {
	const layout = (await readBenchLayout(benchPath)).find(
		(entry) => entry.app === app,
	);
	if (!layout?.namespace) return [];
	let source: string;
	try {
		source = readFileSync(
			join(layout.path, layout.namespace, "patches.txt"),
			"utf8",
		);
	} catch {
		return [];
	}
	return source
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * The hash of a file.
 *
 * The hash pins the code that was reviewed: a file that changed after the
 * assessment is a different operation.
 */
export function hashOfFile(path: string): string | undefined {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return undefined;
	}
}

/**
 * The paths of the convention of an app.
 *
 * The paths are the ones the convention names, and they are the paths the
 * evidence of the app uses: the namespace of the app and the module under
 * it. The convention is checked against the real layout of the app, so a
 * routine of another namespace is a finding and not a convention.
 */
export function lifecyclePathsOf(layout: FrappeAppLayout): {
	commands: string;
	setup: string;
	module: string;
} {
	return {
		commands: join(layout.path, layout.namespace ?? "<namespace>", "commands"),
		setup: join(layout.path, layout.namespace ?? "<namespace>", "setup"),
		module: join(
			layout.path,
			layout.namespace ?? "<namespace>",
			layout.modules[0] ?? "<module>",
			"doctype",
		),
	};
}

/**
 * Is the path of a routine inside the convention of the app?
 *
 * A routine of the `commands` or the `setup` directory of the namespace is
 * inside the convention. A routine of the namespace itself is not: the
 * convention names the two directories and the module of the DocTypes.
 *
 * The answer is evidence, never a permission: a routine in the right
 * directory may still delete business records.
 */
export function isInsideLifecycleConvention(
	path: string,
	layout: FrappeAppLayout,
): { inside: boolean; reason: string } {
	if (!layout.namespace) {
		return {
			inside: false,
			reason: `the namespace of the app ${layout.app} is not clear`,
		};
	}
	const normalized = path.split("\\").join("/");
	const namespaceRoot = `${layout.path.split("\\").join("/")}/${layout.namespace}`;
	if (!normalized.startsWith(`${namespaceRoot}/`)) {
		return {
			inside: false,
			reason: `the path is not under the namespace ${layout.namespace} of the app ${layout.app}`,
		};
	}
	const relative = normalized.slice(namespaceRoot.length + 1);
	const segments = relative.split("/");
	const first = segments[0] ?? "";
	if (first === "commands" || first === "setup") {
		return {
			inside: true,
			reason: `the routine is in the ${first} directory of the namespace ${layout.namespace}`,
		};
	}
	if (layout.modules.includes(first)) {
		return {
			inside: true,
			reason: `the routine is in the module ${first} of the namespace ${layout.namespace}`,
		};
	}
	return {
		inside: false,
		reason: `the path ${relative} is not in the commands, the setup or a module of the namespace ${layout.namespace}`,
	};
}

/**
 * Is the value a record of its own?
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The records of a JSON file, when the file holds an array.
 */
function readJsonArray(path: string): unknown[] | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
