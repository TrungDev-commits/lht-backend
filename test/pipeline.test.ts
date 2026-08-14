import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  processArticle,
  type AiProviderLike,
  type PipelineStore,
  type ProcessArticleInput,
} from '../src/services/pipeline.js';
import type { ScrapedArticle } from '../src/services/scraper.js';
import type { RssSourceConfig } from '../src/config/sources.js';

const article: ScrapedArticle = {
  title: 'NVIDIA công bố chip AI mới',
  link: 'https://example.com/1',
  rawText:
    'Đây là bài viết giới thiệu về con chip mới nhất. Nó hứa hẹn hiệu năng vượt trội. Các kỹ sư bắt đầu xuất xưởng trong quý sau.',
  titleHash: 'hash-1',
  publishedAt: new Date(),
  sourceName: 'Test',
};

const source: RssSourceConfig = {
  name: 'Test',
  url: 'https://example.com/rss',
  category: 'Tech',
  lang: 'vi',
};

function makeAi(mode: 'ok' | 'quota' | 'boom'): AiProviderLike {
  return {
    summarizeNews: async () => {
      if (mode === 'quota') throw { status: 429, message: 'RATE_LIMIT_EXCEEDED' };
      if (mode === 'boom') throw new Error('mạng lỗi');
      return {
        keyword: 'KW',
        audio_script: 'Kịch bản tiếng Việt ngắn gọn cho tin này.',
        web_dev_analogy: 'Ẩn dụ web backend.',
        icebreaker: 'Câu chém gió.',
        graph_data: { nodes: [], edges: [] },
      };
    },
    embed: async () => [0.1, 0.2, 0.3],
  };
}

function makeStore(opts: {
  existing?: { needs_ai_upgrade?: boolean } | null;
  createdNews?: unknown[];
  createdKb?: unknown[];
  upgradedNews?: { titleHash: string; patch: unknown }[];
  upgradedKb?: { sourceHash: string; patch: unknown }[];
} = {}): PipelineStore {
  const createdNews = opts.createdNews ?? [];
  const createdKb = opts.createdKb ?? [];
  const upgradedNews = opts.upgradedNews ?? [];
  const upgradedKb = opts.upgradedKb ?? [];
  return {
    findNewsByHash: async () => opts.existing ?? null,
    createNews: async (data) => { createdNews.push(data); },
    createKnowledge: async (data) => { createdKb.push(data); },
    upgradeNews: async (titleHash, patch) => { upgradedNews.push({ titleHash, patch }); },
    upgradeKnowledge: async (sourceHash, patch) => { upgradedKb.push({ sourceHash, patch }); },
  };
}

function makeInput(overrides: Partial<ProcessArticleInput> = {}): ProcessArticleInput {
  return {
    article,
    source,
    ai: makeAi('ok'),
    store: makeStore(),
    aiExhausted: false,
    ...overrides,
  };
}

test('AI OK → bài mới lưu đầy đủ (created, quality 0.85)', async () => {
  const createdNews: unknown[] = [];
  const createdKb: unknown[] = [];
  const store = makeStore({ createdNews, createdKb });

  const { outcome, aiExhausted } = await processArticle(makeInput({ ai: makeAi('ok'), store }));

  assert.equal(outcome.status, 'created');
  assert.equal(outcome.aiUsed, true);
  assert.equal(aiExhausted, false);
  assert.equal(createdNews.length, 1);
  assert.equal((createdNews[0] as { needs_ai_upgrade: boolean }).needs_ai_upgrade, false);
  assert.equal(createdKb.length, 1);
  assert.equal((createdKb[0] as { quality_score: number }).quality_score, 0.85);
  assert.equal((createdKb[0] as { needs_ai_upgrade: boolean }).needs_ai_upgrade, false);
});

test('AI hết quota → lưu bản tạm (fallback, quality 0.3), aiExhausted=true', async () => {
  const createdNews: unknown[] = [];
  const createdKb: unknown[] = [];
  const store = makeStore({ createdNews, createdKb });

  const { outcome, aiExhausted } = await processArticle(makeInput({ ai: makeAi('quota'), store }));

  assert.equal(outcome.status, 'fallback');
  assert.equal(aiExhausted, true);
  assert.equal((createdNews[0] as { needs_ai_upgrade: boolean }).needs_ai_upgrade, true);
  assert.ok((createdNews[0] as { icebreaker: string }).icebreaker.length > 0);
  assert.equal((createdKb[0] as { quality_score: number }).quality_score, 0.3);
  assert.equal((createdKb[0] as { needs_ai_upgrade: boolean }).needs_ai_upgrade, true);
  assert.deepEqual((createdKb[0] as { embedding: number[] }).embedding, []);
});

test('aiExhausted từ trước → bỏ qua AI, dùng fallback', async () => {
  let aiCalls = 0;
  const aiProxy: AiProviderLike = {
    summarizeNews: async () => { aiCalls += 1; throw new Error('không được gọi'); },
    embed: async () => { aiCalls += 1; throw new Error('không được gọi'); },
  };
  const createdNews: unknown[] = [];
  const store = makeStore({ createdNews });

  const { outcome } = await processArticle(makeInput({ ai: aiProxy, store, aiExhausted: true }));

  assert.equal(outcome.status, 'fallback');
  assert.equal(aiCalls, 0);
});

test('nguồn tiếng Anh + AI hết quota → audio_script tiếng Việt thuần', async () => {
  const enSource: RssSourceConfig = {
    name: 'Dev.to Top',
    url: 'https://dev.to/feed',
    category: 'DevOps',
    lang: 'en',
  };
  const enArticle: ScrapedArticle = {
    title: 'How to Build a Minimal SIEM',
    link: 'https://dev.to/1',
    rawText: 'Most teams cannot afford Splunk. Elastic SIEM takes real time to tune.',
    titleHash: 'hash-en-1',
    publishedAt: new Date(),
    sourceName: 'Dev.to Top',
  };
  const createdNews: unknown[] = [];
  const createdKb: unknown[] = [];
  const store = makeStore({ createdNews, createdKb });

  const { outcome } = await processArticle(
    makeInput({ ai: makeAi('quota'), store, source: enSource, article: enArticle })
  );

  assert.equal(outcome.status, 'fallback');
  const audio = (createdNews[0] as { audio_script: string }).audio_script;
  assert.ok(audio.startsWith('Trong tin hôm nay:'));
  assert.ok(!audio.includes('Splunk'), 'audio không được chứa câu gốc tiếng Anh');
  assert.ok(audio.includes('Dev.to Top'));
});

test('đã tồn tại bản tốt → duplicate', async () => {
  const store = makeStore({ existing: { needs_ai_upgrade: false } });

  const { outcome } = await processArticle(makeInput({ store }));

  assert.equal(outcome.status, 'duplicate');
});

test('bản degraded cũ → nâng cấp bằng AI (upgraded)', async () => {
  const upgradedNews: { titleHash: string; patch: unknown }[] = [];
  const upgradedKb: { sourceHash: string; patch: unknown }[] = [];
  const store = makeStore({ existing: { needs_ai_upgrade: true }, upgradedNews, upgradedKb });

  const { outcome, aiExhausted } = await processArticle(makeInput({ ai: makeAi('ok'), store }));

  assert.equal(outcome.status, 'upgraded');
  assert.equal(aiExhausted, false);
  assert.equal(upgradedNews.length, 1);
  assert.equal((upgradedNews[0].patch as { needs_ai_upgrade: boolean }).needs_ai_upgrade, false);
  assert.equal(upgradedKb.length, 1);
  assert.equal((upgradedKb[0].patch as { quality_score: number }).quality_score, 0.85);
  assert.equal((upgradedKb[0].patch as { needs_ai_upgrade: boolean }).needs_ai_upgrade, false);
});

test('nâng cấp gặp quota → deferred, aiExhausted=true', async () => {
  const store = makeStore({ existing: { needs_ai_upgrade: true } });

  const { outcome, aiExhausted } = await processArticle(makeInput({ ai: makeAi('quota'), store }));

  assert.equal(outcome.status, 'deferred');
  assert.equal(aiExhausted, true);
});

test('lỗi thật (không phải quota) → failed', async () => {
  const store = makeStore();

  const { outcome } = await processArticle(makeInput({ ai: makeAi('boom'), store }));

  assert.equal(outcome.status, 'failed');
  assert.ok(outcome.error);
});
