import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { LRU } from '../lib/lru.js';

// AI-call cache. Identical (system + user + jsonShape + model) prompts return
// the cached JSON instantly. Keyed by sha256 hex of the request payload.
const askJsonCache = new LRU<string, unknown>(256);

let client: Anthropic | null = null;
let cachedKey: string | null = null;

// Read the key live from process.env so a hot-reloaded .env takes effect
// without a manual restart (see server.ts .env watcher).
function currentKey(): string {
  return process.env.ANTHROPIC_API_KEY ?? config.anthropic.apiKey ?? '';
}
function currentModel(): string {
  return process.env.ANTHROPIC_MODEL ?? config.anthropic.model;
}

export function getAnthropic(): Anthropic | null {
  const key = currentKey();
  if (!key) { client = null; cachedKey = null; return null; }
  if (!client || cachedKey !== key) { client = new Anthropic({ apiKey: key }); cachedKey = key; }
  return client;
}

/** Force the client to be rebuilt on next use (call after reloading .env). */
export function resetAnthropic(): void { client = null; cachedKey = null; }

export function anthropicConfigured(): boolean { return Boolean(currentKey()); }

export async function askJson<T>(opts: { system: string; user: string; jsonShape: string; maxTokens?: number }): Promise<T | null> {
  const a = getAnthropic();
  if (!a) return null;
  const cacheKey = createHash('sha256').update(currentModel() + '|' + opts.system + '|' + opts.user + '|' + opts.jsonShape).digest('hex');
  const cached = askJsonCache.get(cacheKey);
  if (cached !== undefined) return cached as T;
  const msg = await a.messages.create({
    model: currentModel(),
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system + '\n\nIMPORTANT: Respond with ONLY valid JSON, no prose, matching this shape:\n' + opts.jsonShape,
    messages: [{ role: 'user', content: opts.user }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const a0 = text.indexOf('{'), b0 = text.lastIndexOf('}');
  if (a0 < 0 || b0 < 0) return null;
  try { const parsed = JSON.parse(text.slice(a0, b0 + 1)) as T; askJsonCache.set(cacheKey, parsed); return parsed; } catch { return null; }
}
