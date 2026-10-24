/**
 * Skill Embedder
 * 
 * Creates embeddings for skill content using OpenAI.
 * Used to store skills in Qdrant for semantic search.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import type { SkillPoint } from "./client.js";

/**
 * Embedding result
 */
export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

/** The embeddings endpoint of OpenAI. */
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

/** The home directory of the current user. */
function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || osHomedir();
}

/**
 * Read a key file. A file that cannot be read is no key - the caller must
 * not see an exception of an unreadable file as a broken installation.
 */
function readKeyFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const value = readFileSync(path, "utf8").trim();
    return value.length > 5 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The OpenAI token of a pi.dev login (an OAuth access token).
 */
function readPiAuthToken(): string | null {
  const authPath = join(homeDir(), ".pi", "agent", "auth.json");
  try {
    if (!existsSync(authPath)) return null;
    const auth = JSON.parse(readFileSync(authPath, "utf8")) as {
      openai?: { key?: string; access?: string };
      "openai-codex"?: { key?: string; access?: string };
    };
    // The api key first, then the OAuth access token of the codex login.
    const entry = auth.openai ?? auth["openai-codex"];
    if (!entry) return null;
    return (entry.access ?? entry.key ?? "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Get the OpenAI API key for embeddings.
 *
 * Only a key of OpenAI belongs here: the embeddings endpoint of OpenAI does
 * not accept the key of another provider. A TypeSafe or an OpenRouter key is
 * a different credential and must never be sent to that endpoint.
 */
export function getOpenAIApiKey(): string | null {
  // 1. The environment.
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  // 2. The key file of the installation.
  const fromFile = readKeyFile(
    join(homeDir(), ".pi-harness-runtime", "keys", "openai-api-key.txt"),
  );
  if (fromFile) return fromFile;

  // 3. pi.dev auth.json (the OpenAI token of a pi.dev login).
  return readPiAuthToken();
}

/**
 * Create embedding for text using OpenAI
 */
export async function createEmbedding(
  text: string,
  apiKey?: string
): Promise<EmbeddingResult> {
  const key = apiKey || getOpenAIApiKey();
  if (!key) {
    throw new Error("No OpenAI API key available for embeddings");
  }
  
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000), // Limit to avoid token limits
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding failed: ${error}`);
  }
  
  const data = await response.json() as {
    data: Array<{ embedding: number[] }>;
    usage: { total_tokens: number };
  };
  
  return {
    embedding: data.data[0]?.embedding || [],
    tokens: data.usage?.total_tokens || 0,
  };
}

/**
 * Create embedding for a skill document
 */
export async function embedSkillDocument(
  skill: SkillPoint,
  apiKey?: string
): Promise<{ id: number; embedding: number[]; payload: SkillPoint }> {
  // Combine name and description for embedding
  const textToEmbed = [skill.name, skill.description].join(". ");
  
  const { embedding } = await createEmbedding(textToEmbed, apiKey);
  
  return {
    id: skill.id,
    embedding,
    payload: skill,
  };
}

/**
 * Batch embed multiple skills
 */
export async function embedSkillsBatch(
  skills: SkillPoint[],
  apiKey?: string,
  onProgress?: (index: number, total: number) => void
): Promise<Array<{ id: number; embedding: number[]; payload: SkillPoint }>> {
  const results: Array<{ id: number; embedding: number[]; payload: SkillPoint }> = [];
  
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    try {
      const result = await embedSkillDocument(skill, apiKey);
      results.push(result);
    } catch (err) {
      console.error(`[QdrantSkills] Failed to embed skill ${skill.name}:`, err);
    }
    
    if (onProgress) {
      onProgress(i + 1, skills.length);
    }
    
    // Small delay to avoid rate limiting
    if (i < skills.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}
