/**
 * Laravel Plugin — Types (RFC-0065)
 */

export interface LaravelAnalysis {
	framework: FrameworkInfo;
	version?: string;
	controllers: string[];
	models: string[];
	views: string[];
	commands: string[];
	migrations: number;
	authType?: string;
	envVars: string[];
	packages: string[];
}

export interface FrameworkInfo {
	id: string;
	name: string;
	category: string;
	description: string;
	tags: string[];
}
