/**
 * Skill Embedder
 * 
 * Creates embeddings for skill content using OpenAI.
 * Used to store skills in Qdrant for semantic search.
 */

import type { SkillPoint } from "./client.js";

/**
 * Embedding result
 */
export interface EmbeddingResult {
  embedding: number[];
  tokens: number;
}

/**
 * Get OpenAI API key for embeddings
 */
export function getOpenAIApiKey(): string | null {
  // 1. Env vars (same priority as Jev)
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  if (process.env.TYPESAFE_API_KEY) {
    return process.env.TYPESAFE_API_KEY;
  }
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  // 2. Keys file
  try {
    const { existsSync, readFileSync } = require("node:fs");
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
    const keyPath = `${homedir}/.pi-harness-runtime/keys/openai-api-key.txt`;
    if (existsSync(keyPath)) {
      const val = readFileSync(keyPath, "utf-8").trim();
      if (val.length > 5) return val;
    }
  } catch {
    // ignore
  }

  // 3. pi.dev auth.json (OpenAI OAuth tokens stored by pi.dev login)
  try {
    const { existsSync, readFileSync } = require("node:fs");
    const homedir = process.env.HOME || process.env.USERPROFILE || "/home/frappe";
    const authPath = `${homedir}/.pi/agent/auth.json`;
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf-8")) as {
        openai?: { type?: string; key?: string; access?: string };
        "openai-codex"?: { type?: string; key?: string; access?: string };
      };
      // Try openai first (API key), then openai-codex (OAuth access token)
      const entry = auth.openai ?? auth["openai-codex"];
      if (entry) {
        return entry.access ?? entry.key ?? null;
      }
    }
  } catch {
    // ignore
  }

  return null;
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
  
  const response = await fetch("https://api.openai.com/v1/embeddings", {
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
