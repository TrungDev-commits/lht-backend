import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const candidateEnvFiles = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')];

for (const envFile of candidateEnvFiles) {
  if (existsSync(envFile)) {
    loadEnv({ path: envFile });
    break;
  }
}

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Làm sạch bí mật: bỏ khoảng trắng thừa và cặp nháy ngoài (dễ dán nhầm từ dashboard/.env) */
export function normalizeSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let out = value.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: toNumber(process.env.PORT, 3001),
  MONGODB_URI: process.env.MONGODB_URI ?? '',
  FINANCE_DB_URI: process.env.FINANCE_DB_URI ?? '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  // Nhiều API key cách nhau dấu phẩy — rotate khi quota key trước hết
  GEMINI_API_KEYS: process.env.GEMINI_API_KEYS ?? '',
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  GEMINI_API_VERSION: process.env.GEMINI_API_VERSION ?? 'v1',
  GEMINI_EMBED_MODEL: process.env.GEMINI_EMBED_MODEL ?? 'gemini-embedding-2',
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL ?? '',
  // Danh sách model free để rotate khi quota hết, cách nhau dấu phẩy
  // Thứ tự ưu tiên: primary -> mỗi model trong list này
  GEMINI_FREE_MODELS: process.env.GEMINI_FREE_MODELS ?? 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.0-flash-lite,gemini-1.5-flash',
  // Số request tối đa mỗi phút trên toàn app (token bucket) — thấp hơn limit free để không đụng 429
  GEMINI_RPM: toNumber(process.env.GEMINI_RPM, 12),
  PIPELINE_LIMIT_PER_SOURCE: toNumber(process.env.PIPELINE_LIMIT_PER_SOURCE, 5),
  PIPELINE_AI_DELAY_MS: toNumber(process.env.PIPELINE_AI_DELAY_MS, 1000),
  NEWS_RSS_URL: process.env.NEWS_RSS_URL ?? '',
  MQTT_URL: process.env.MQTT_URL ?? '',
  FRONTEND_DIST: process.env.FRONTEND_DIST ?? '',
  NEWS_DB: process.env.NEWS_DB ?? 'lht-news',
  KNOWLEDGE_DB: process.env.KNOWLEDGE_DB ?? 'lht-kb',
  CHAT_DB: process.env.CHAT_DB ?? 'lht-chat',
  MEMORY_DB: process.env.MEMORY_DB ?? 'lht-memory',
  FPT_TTS_API_KEY: process.env.FPT_TTS_API_KEY ?? '',
  FPT_TTS_VOICE: process.env.FPT_TTS_VOICE ?? 'banmai',
  TTS_CACHE_DIR: process.env.TTS_CACHE_DIR ?? '',
  LHT_GH_TOKEN: process.env.LHT_GH_TOKEN ?? '',
  LHT_GH_REPO: process.env.LHT_GH_REPO ?? 'TrungDev-commits/lht-backend',
  RESEARCH_SECRET: normalizeSecret(process.env.RESEARCH_SECRET) ?? '',
  PIPELINE_SECRET: normalizeSecret(process.env.PIPELINE_SECRET) ?? '',
} as const;

export const GEMINI_MODEL = env.GEMINI_MODEL;
export const GEMINI_API_VERSION = env.GEMINI_API_VERSION;
export const GEMINI_EMBED_MODEL = env.GEMINI_EMBED_MODEL;
export const GEMINI_FALLBACK_MODEL = env.GEMINI_FALLBACK_MODEL;

/** Trả về danh sách tất cả Gemini API keys (primary + extras) theo thứ tự ưu tiên */
export function getAllGeminiKeys(): string[] {
  const primary = env.GEMINI_API_KEY.trim();
  const extras = env.GEMINI_API_KEYS
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return [primary, ...extras].filter((k) => {
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Trả về danh sách model free để rotate khi quota hết */
export function getFreeModelList(): string[] {
  return env.GEMINI_FREE_MODELS
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}
