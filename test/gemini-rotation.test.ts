import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GoogleGenAI } from '@google/genai';
import {
  GeminiService,
  TokenBucket,
  nextPacificMidnight,
  isDailyQuotaExhausted,
} from '../src/services/gemini.js';

function okResponse() {
  return {
    text: JSON.stringify({
      keyword: 'KW',
      audio_script: 'Script A',
      web_dev_analogy: 'Analogy A',
      icebreaker: 'Ice A',
      graph_data: { nodes: [], edges: [] },
    }),
  };
}

function fakeClient(handlers: {
  generate?: () => unknown;
  embed?: () => unknown;
}): GoogleGenAI {
  return {
    models: {
      generateContent: async () => handlers.generate?.(),
      embedContent: async () => handlers.embed?.(),
    },
  } as unknown as GoogleGenAI;
}

const HIGH_RPM = 100_000;

test('key hết quota → rotate sang key kế và trả kết quả', async () => {
  let aCalls = 0;
  let bCalls = 0;
  const a = fakeClient({
    generate: () => {
      aCalls += 1;
      throw { status: 429, message: 'RATE_LIMIT_EXCEEDED' };
    },
  });
  const b = fakeClient({
    generate: () => {
      bCalls += 1;
      return okResponse();
    },
  });

  const svc = new GeminiService({ clients: [a, b], rpm: HIGH_RPM });
  const out = await svc.summarizeNews('nội dung', 'tiêu đề');

  assert.equal(aCalls, 1);
  assert.equal(bCalls, 1);
  assert.equal(out.keyword, 'KW');
});

test('model 404 → rotate sang model free kế tiếp', async () => {
  let calls = 0;
  const client = fakeClient({
    generate: () => {
      calls += 1;
      if (calls === 1) throw { status: 404, message: 'NOT_FOUND' };
      return okResponse();
    },
  });

  const svc = new GeminiService({ clients: [client], rpm: HIGH_RPM });
  const out = await svc.summarizeNews('x', 'y');

  assert.equal(out.keyword, 'KW');
  assert.ok(calls >= 2, `mong đợi >= 2 lần gọi, thực tế ${calls}`);
});

test('lỗi daily quota (RPD) → key cooldown lâu hơn 60s (chờ reset Pacific)', async () => {
  const dailyErr = { status: 429, message: 'Requests per day limit exceeded for project' };
  const svc = new GeminiService({
    clients: [fakeClient({ generate: () => { throw dailyErr; } })],
    rpm: HIGH_RPM,
  });

  await assert.rejects(() => svc.summarizeNews('x', 'y'));
  const remaining = svc.keyCooldownRemainingMs(0);
  assert.ok(remaining > 60_000, `mong đợi >60s, thực tế ${remaining}ms`);
});

test('lỗi RPM thường → key cooldown ~60s', async () => {
  const svc = new GeminiService({
    clients: [fakeClient({ generate: () => { throw { status: 429, message: 'RATE_LIMIT_EXCEEDED' }; } })],
    rpm: HIGH_RPM,
  });

  await assert.rejects(() => svc.summarizeNews('x', 'y'));
  const remaining = svc.keyCooldownRemainingMs(0);
  assert.ok(remaining > 0 && remaining <= 60_000, `mong đợi 0<..<=60s, thực tế ${remaining}ms`);
});

test('key đang cooldown → bị bỏ qua, không gọi lại', async () => {
  let aCalls = 0;
  let bCalls = 0;
  const a = fakeClient({
    generate: () => {
      aCalls += 1;
      throw { status: 429, message: 'RATE_LIMIT_EXCEEDED' };
    },
  });
  const b = fakeClient({
    generate: () => {
      bCalls += 1;
      return okResponse();
    },
  });

  const svc = new GeminiService({ clients: [a, b], rpm: HIGH_RPM });
  await svc.summarizeNews('x', 'y');
  await svc.summarizeNews('x', 'y');

  assert.equal(aCalls, 1, 'key A chỉ nên được gọi 1 lần rồi bị cooldown');
  assert.equal(bCalls, 2);
});

test('TokenBucket làm mượt RPM với đồng hồ ảo', async () => {
  let fakeNow = 1_000_000;
  const bucket = new TokenBucket(1, () => fakeNow, async (ms) => { fakeNow += ms; });

  await bucket.acquire(); // token đầu có sẵn
  await bucket.acquire(); // chờ refill (60s ảo)

  assert.equal(fakeNow, 1_060_000);
});

test('nextPacificMidnight: đúng mốc nửa đêm Thái Bình Dương', () => {
  assert.equal(
    nextPacificMidnight(new Date('2026-08-14T10:00:00Z')),
    Date.parse('2026-08-15T07:00:00Z')
  );
  assert.equal(
    nextPacificMidnight(new Date('2026-01-15T10:00:00Z')),
    Date.parse('2026-01-16T08:00:00Z')
  );
});

test('isDailyQuotaExhausted nhận diện giới hạn hàng ngày', () => {
  assert.equal(isDailyQuotaExhausted({ status: 429, message: 'Quota exceeded for requests per day' }), true);
  assert.equal(isDailyQuotaExhausted({ status: 429, message: 'RATE_LIMIT_EXCEEDED' }), false);
  assert.equal(isDailyQuotaExhausted({ status: 429 }), false);
});
