/**
 * Next.js Plugin — Types (RFC-0062)
 */

export interface NextJsAnalysis {
	framework: FrameworkInfo;
	version?: string;
	usingAppRouter: boolean;
	usingPagesRouter: boolean;
	apiRoutes: string[];
	appRoutes: AppRoute[];
	middleware?: string;
	middlewareConfig?: Record<string, unknown>;
	environmentVars: string[];
	configs: ConfigFile[];
}

export interface FrameworkInfo {
	id: string;
	name: string;
	category: string;
	description: string;
	tags: string[];
}

export interface AppRoute {
	path: string;
	method: string;
	isDynamic: boolean;
	file: string;
}

export interface ConfigFile {
	name: string;
	path: string;
}
