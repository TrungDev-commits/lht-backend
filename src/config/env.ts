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

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: toNumber(process.env.PORT, 3001),
  MONGODB_URI: process.env.MONGODB_URI ?? '',
  FINANCE_DB_URI: process.env.FINANCE_DB_URI ?? '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  GEMINI_EMBED_MODEL: process.env.GEMINI_EMBED_MODEL ?? 'text-embedding-004',
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
  RESEARCH_SECRET: process.env.RESEARCH_SECRET ?? '',
  PIPELINE_SECRET: process.env.PIPELINE_SECRET ?? '',
} as const;

export const GEMINI_MODEL = env.GEMINI_MODEL;
export const GEMINI_EMBED_MODEL = env.GEMINI_EMBED_MODEL;
