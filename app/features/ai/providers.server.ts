// ─────────────────────────────────────────────────────────────────────────
// AI provider chain with multi-key, multi-provider fallback.
//
// Supports OpenAI and Groq (both expose an OpenAI-compatible Chat Completions
// API). You can configure several API keys per provider; when one key is rate
// limited (HTTP 429), unavailable (5xx), invalid (4xx) or times out, the next
// key — and then the next provider — is tried automatically.
//
// Environment variables (any combination works). Every provider below is
// OpenAI-compatible. Groq and OpenRouter both have generous FREE tiers — add
// several free keys and the chain rotates through them as limits are hit.
//   GROQ_API_KEY / GROQ_API_KEYS / GROQ_API_KEY_1..N        (FREE tier)
//   OPENROUTER_API_KEY / OPENROUTER_API_KEYS / ..._1..N     (FREE models)
//   OPENAI_API_KEY / OPENAI_API_KEYS / OPENAI_API_KEY_1..N  (paid)
//   GROQ_MODEL        default "llama-3.3-70b-versatile"
//   OPENROUTER_MODEL  default "meta-llama/llama-3.3-70b-instruct:free"
//   OPENAI_MODEL      default "gpt-4o-mini"
//   AI_PROVIDER_ORDER which provider is tried first, default "groq,openrouter,openai"
// "comma-separated keys" example:  GROQ_API_KEYS=gsk_a,gsk_b,gsk_c
// ─────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIProviderConfig {
  provider: "openai" | "groq" | "openrouter";
  apiKey: string;
  baseUrl: string;
  model: string;
  label: string; // human-readable, e.g. "groq#2" (never logs the key itself)
}

const PROVIDER_DEFS = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    modelEnv: "GROQ_MODEL",
    prefix: "GROQ",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    modelEnv: "OPENROUTER_MODEL",
    prefix: "OPENROUTER",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    modelEnv: "OPENAI_MODEL",
    prefix: "OPENAI",
  },
} as const;

type ProviderName = keyof typeof PROVIDER_DEFS;

// How many numbered keys (PREFIX_API_KEY_1 .. _N) to scan for.
const MAX_NUMBERED_KEYS = 20;
// Per-attempt network timeout.
const REQUEST_TIMEOUT_MS = 30_000;

// Collect every API key configured for a provider, in a stable order, de-duped.
function collectKeys(prefix: string): string[] {
  const keys: string[] = [];
  const push = (value: string | undefined) => {
    if (!value) return;
    for (const part of value.split(",")) {
      const k = part.trim();
      if (k) keys.push(k);
    }
  };

  push(process.env[`${prefix}_API_KEY`]);
  push(process.env[`${prefix}_API_KEYS`]);
  for (let i = 1; i <= MAX_NUMBERED_KEYS; i++) {
    push(process.env[`${prefix}_API_KEY_${i}`]);
  }

  return [...new Set(keys)];
}

// Build the ordered list of provider/key attempts from the environment.
export function getAIProviders(): AIProviderConfig[] {
  const order = (process.env.AI_PROVIDER_ORDER || "groq,openrouter,openai")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => s in PROVIDER_DEFS);

  const providers: AIProviderConfig[] = [];
  for (const name of order) {
    const def = PROVIDER_DEFS[name];
    const model = process.env[def.modelEnv]?.trim() || def.defaultModel;
    const keys = collectKeys(def.prefix);
    keys.forEach((apiKey, index) => {
      providers.push({
        provider: name,
        apiKey,
        baseUrl: def.baseUrl,
        model,
        label: `${name}#${index + 1}`,
      });
    });
  }
  return providers;
}

export function hasAIProviders(): boolean {
  return getAIProviders().length > 0;
}

// A short, safe description of the configured chain for logs (no secrets).
export function describeAIProviders(): string {
  const providers = getAIProviders();
  if (providers.length === 0) return "none";
  const counts: Record<string, number> = {};
  for (const p of providers) counts[p.provider] = (counts[p.provider] || 0) + 1;
  return Object.entries(counts)
    .map(([name, n]) => `${name}×${n}`)
    .join(", ");
}

/**
 * Sends a chat completion request expecting a JSON object response, trying each
 * configured provider/key in order. Moves to the next key on rate limit, error,
 * or timeout. Returns the raw assistant content string (JSON), or throws if
 * every configured key fails.
 */
export async function callChatJSON(messages: ChatMessage[]): Promise<string> {
  const providers = getAIProviders();
  if (providers.length === 0) {
    throw new Error("No AI providers configured (set OPENAI_API_KEY(S) and/or GROQ_API_KEY(S)).");
  }

  let lastError: unknown = null;

  for (const p of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
      };
      // OpenRouter recommends identifying the calling app (optional but polite).
      if (p.provider === "openrouter") {
        headers["HTTP-Referer"] = process.env.SHOPIFY_APP_URL || "https://geoengine-d1o3.onrender.com";
        headers["X-Title"] = "GEO Engine";
      }

      const response = await fetch(p.baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: p.model,
          messages,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      // Rate limited or server-side issue → try the next key/provider.
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${p.label}: HTTP ${response.status}`);
        console.warn(`[AI] ${p.label} rate-limited/unavailable (HTTP ${response.status}); falling over to next key.`);
        continue;
      }

      // Any other non-2xx (e.g. 401 invalid key, 400 bad model) → skip this key.
      if (!response.ok) {
        lastError = new Error(`${p.label}: HTTP ${response.status}`);
        console.warn(`[AI] ${p.label} request rejected (HTTP ${response.status}); falling over to next key.`);
        continue;
      }

      const json = await response.json();
      const content = json?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        lastError = new Error(`${p.label}: empty response`);
        console.warn(`[AI] ${p.label} returned empty content; falling over to next key.`);
        continue;
      }

      console.log(`[AI] Suggestion generated via ${p.label} (${p.provider}: ${p.model}).`);
      return content;
    } catch (error) {
      lastError = error;
      console.warn(`[AI] ${p.label} request failed (${error instanceof Error ? error.message : "error"}); falling over to next key.`);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `All ${providers.length} AI key(s) failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}
