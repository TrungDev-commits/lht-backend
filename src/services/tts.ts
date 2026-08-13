import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';

export interface TtsResult {
  url: string;
  provider: 'fpt' | 'fallback';
}

const FPT_TTS_ENDPOINT = 'https://api.fpt.ai/hmi/tts/v5';

function cacheDir(): string {
  const dir = env.TTS_CACHE_DIR || resolve(process.cwd(), 'cache', 'tts');
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Bỏ qua lỗi tạo thư mục.
    }
  }
  return dir;
}

export function textHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 24);
}

export function cachedTtsPath(text: string): string | null {
  const file = join(cacheDir(), `${textHash(text)}.mp3`);
  return existsSync(file) ? file : null;
}

export async function synthesizeFpt(text: string): Promise<{ audio: Buffer; provider: 'fpt' } | null> {
  if (!env.FPT_TTS_API_KEY) return null;

  try {
    const response = await fetch(FPT_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': env.FPT_TTS_API_KEY,
        voice: env.FPT_TTS_VOICE,
        speed: '-1',
        format: 'mp3',
      },
      body: JSON.stringify({ text: text.slice(0, 4_000) }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { audio?: string; async?: number; error?: number; message?: string };

    if (data.async === 1 || data.error) {
      console.warn('[L.H.T TTS] FPT trả async/error:', data.message ?? data.error);
      return null;
    }

    if (typeof data.audio !== 'string' || !data.audio) return null;

    const parts = data.audio.split(',');
    const base64 = parts.length > 1 ? (parts[1] ?? '') : (parts[0] ?? '');
    return { audio: Buffer.from(base64, 'base64'), provider: 'fpt' };
  } catch (err) {
    console.warn('[L.H.T TTS] FPT lỗi:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function ttsToFile(text: string): Promise<TtsResult | null> {
  const normalized = text.trim();
  if (!normalized) return null;

  const cached = cachedTtsPath(normalized);
  if (cached) {
    return { url: `/api/tts/audio/${textHash(normalized)}.mp3`, provider: 'fpt' };
  }

  const result = await synthesizeFpt(normalized);
  if (!result) return null;

  const file = join(cacheDir(), `${textHash(normalized)}.mp3`);
  try {
    writeFileSync(file, result.audio);
  } catch (err) {
    console.warn('[L.H.T TTS] Không ghi được file cache:', err instanceof Error ? err.message : err);
    return null;
  }

  return { url: `/api/tts/audio/${textHash(normalized)}.mp3`, provider: result.provider };
}