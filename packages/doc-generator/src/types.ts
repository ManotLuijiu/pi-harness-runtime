/**
 * Doc Generator Types (RFC-0014)
 */

export interface SourceFile {
  path: string;
  content: string;
  language: string;
}

export type ProjectType =
  | "frappe_erpnext"
  | "frappe_spa"
  | "nextjs"
  | "react_vite"
  | "django"
  | "laravel"
  | "generic_web"
  | "unknown";

export interface ProjectDetection {
  projectType: ProjectType;
  confidence: number;
  signals: string[];
  recommendedSeedStrategy: string;
  recommendedE2EStrategy: string;
}

export interface DetectedSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "constant" | "variable";
  signature?: string;
  docComment?: string;
  file: string;
  line: number;
}

export interface GeneratedDocs {
  title: string;
  sections: DocSection[];
  symbols: DetectedSymbol[];
  projectType: ProjectType;
}

export interface DocSection {
  heading: string;
  level: 1 | 2 | 3;
  content: string;
}

export type SeedStrategy =
  | "frappe_doc_insert"
  | "frappe_fixtures"
  | "nextjs_factory"
  | "vite_seed"
  | "django_migrations"
  | "laravel_seeders"
  | "generic_faker";
