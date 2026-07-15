/**
 * Django Plugin — Types (RFC-0064)
 */

export interface DjangoAnalysis {
	framework: FrameworkInfo;
	version?: string;
	apps: DjangoApp[];
	managementCommands: string[];
	middleware: string[];
	drfEnabled: boolean;
	requirements: string[];
	configs: ConfigFile[];
}

export interface FrameworkInfo {
	id: string;
	name: string;
	category: string;
	description: string;
	tags: string[];
}

export interface DjangoApp {
	name: string;
	path: string;
	modelCount: number;
	hasAdmin: boolean;
	hasMigrations: boolean;
}

export interface ConfigFile {
	name: string;
	path: string;
}
