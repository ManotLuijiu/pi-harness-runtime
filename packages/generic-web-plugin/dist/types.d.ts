/**
 * Generic Web Plugin — Types (RFC-0066)
 */
export type WebFrameworkType = "next" | "nuxt" | "remix" | "astro" | "react-vite" | "vue-vite" | "svelte" | "webpack" | "express" | "fastify" | "koa" | "hono" | "flask" | "django" | "rails" | "laravel" | "static";
export interface PageRoute {
    path: string;
    file: string;
    component: string;
}
export interface ApiEndpoint {
    method: string;
    path: string;
    file?: string;
}
export interface GenericWebAnalysis {
    framework: WebFrameworkType;
    routes: PageRoute[];
    endpoints: ApiEndpoint[];
    ssr: boolean;
}
//# sourceMappingURL=types.d.ts.map