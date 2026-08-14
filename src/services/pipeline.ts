import { getNewsModel } from '../models/news.js';
import { getKnowledgeModel } from '../models/knowledge.js';
import { ScraperService, runGarbageCollection, type ScrapedArticle } from './scraper.js';
import { geminiService, isQuotaExhausted, type ArticleCognitiveOutput, type GraphData } from './gemini.js';
import { buildDegradedCognitive } from './fallback.js';
import { isConnected } from '../db/connections.js';
import { RSS_SOURCES, type RssSourceConfig } from '../config/sources.js';
import { env } from '../config/env.js';

export interface PipelineResult {
  processed: number;
  created: number;
  upgraded: number;
  fallback: number;
  deferred: number;
  duplicatesSkipped: number;
  failed: number;
  errors: string[];
  sourcesProcessed: number;
  quotaLimited: boolean;
}

export type AiProviderLike = Pick<typeof geminiService, 'summarizeNews' | 'embed'>;

export interface NewsRecord {
  source_url: string;
  keyword: string;
  audio_script: string;
  web_dev_analogy: string;
  graph_data: GraphData;
  title_hash: string;
  icebreaker: string;
  source_name: string;
  needs_ai_upgrade: boolean;
}

export interface KnowledgeRecord {
  source_hash: string;
  title: string;
  topic_tags: string[];
  summary_vn: string;
  audio_script: string;
  web_dev_analogy: string;
  icebreaker: string;
  graph_data: GraphData;
  embedding: number[];
  source_refs: { url: string; source_name: string }[];
  quality_score: number;
  needs_ai_upgrade: boolean;
}

/** Ngưỡng ghi chú DB cho pipeline — tách rời khỏi mongoose để test dễ. */
export interface PipelineStore {
  findNewsByHash(titleHash: string): Promise<{ needs_ai_upgrade?: boolean } | null>;
  createNews(data: NewsRecord): Promise<void>;
  createKnowledge(data: KnowledgeRecord): Promise<void>;
  upgradeNews(titleHash: string, patch: Partial<NewsRecord>): Promise<void>;
  upgradeKnowledge(sourceHash: string, patch: Partial<KnowledgeRecord>): Promise<void>;
}

export interface ArticleOutcome {
  status: 'created' | 'upgraded' | 'fallback' | 'duplicate' | 'deferred' | 'failed';
  error?: string;
  aiUsed: boolean;
}

export interface ProcessArticleInput {
  article: ScrapedArticle;
  source: RssSourceConfig;
  ai: AiProviderLike;
  store: PipelineStore;
  aiExhausted: boolean;
}

/**
 * Xử lý 1 bài báo:
 *   - Đã có bản tốt → duplicate.
 *   - Có bản degraded (needs_ai_upgrade) → nâng cấp bằng AI khi quota còn.
 *   - Bài mới + AI OK → lưu đầy đủ (2 call: summarize + embed).
 *   - Bài mới + AI hết quota → lưu bản tạm (fallback heuristic, không embed),
 *     đánh dấu needs_ai_upgrade để lượt sau nâng cấp.
 */
export async function processArticle(input: ProcessArticleInput): Promise<{ outcome: ArticleOutcome; aiExhausted: boolean }> {
  const { article, source, ai, store } = input;
  let aiExhausted = input.aiExhausted;

  try {
    const existing = await store.findNewsByHash(article.titleHash);

    // Bản degraded cũ → nâng cấp bằng AI khi có quota
    if (existing?.needs_ai_upgrade) {
      if (aiExhausted) {
        return { outcome: { status: 'deferred', aiUsed: false }, aiExhausted };
      }
      try {
        const cognitive = await ai.summarizeNews(article.rawText, article.title);
        const embedText = `${article.title}\n${cognitive.audio_script}\n${cognitive.web_dev_analogy}`;
        const embedding = await ai.embed(embedText);

        await store.upgradeKnowledge(article.titleHash, {
          title: article.title,
          topic_tags: [source.category, cognitive.keyword],
          summary_vn: cognitive.audio_script.slice(0, 300),
          audio_script: cognitive.audio_script,
          web_dev_analogy: cognitive.web_dev_analogy,
          icebreaker: cognitive.icebreaker,
          graph_data: cognitive.graph_data,
          embedding,
          quality_score: 0.85,
          needs_ai_upgrade: false,
        });
        await store.upgradeNews(article.titleHash, {
          keyword: cognitive.keyword,
          audio_script: cognitive.audio_script,
          web_dev_analogy: cognitive.web_dev_analogy,
          graph_data: cognitive.graph_data,
          icebreaker: cognitive.icebreaker,
          needs_ai_upgrade: false,
        });
        return { outcome: { status: 'upgraded', aiUsed: true }, aiExhausted };
      } catch (err) {
        if (isQuotaExhausted(err)) {
          aiExhausted = true;
          return { outcome: { status: 'deferred', error: 'AI hết quota khi nâng cấp.', aiUsed: true }, aiExhausted };
        }
        throw err;
      }
    }

    if (existing) {
      return { outcome: { status: 'duplicate', aiUsed: false }, aiExhausted };
    }

    // Bài mới
    let cognitive: ArticleCognitiveOutput | null = null;
    let aiUsed = false;

    if (!aiExhausted) {
      try {
        cognitive = await ai.summarizeNews(article.rawText, article.title);
        aiUsed = true;
      } catch (err) {
        if (!isQuotaExhausted(err)) throw err;
        aiExhausted = true;
      }
    }

    const degraded = cognitive === null;
    const out = cognitive ?? buildDegradedCognitive({
      title: article.title,
      rawText: article.rawText,
      sourceName: source.name,
      category: source.category,
    });

    await store.createNews({
      source_url: article.link,
      keyword: out.keyword,
      audio_script: out.audio_script,
      web_dev_analogy: out.web_dev_analogy,
      graph_data: out.graph_data,
      title_hash: article.titleHash,
      icebreaker: out.icebreaker,
      source_name: source.name,
      needs_ai_upgrade: degraded,
    });

    if (degraded) {
      // AI hết quota → bản tạm, không cần embedding (RAG vẫn chạy keyword/recency)
      await store.createKnowledge({
        source_hash: article.titleHash,
        title: article.title,
        topic_tags: [source.category, out.keyword],
        summary_vn: out.audio_script.slice(0, 300),
        audio_script: out.audio_script,
        web_dev_analogy: out.web_dev_analogy,
        icebreaker: out.icebreaker,
        graph_data: out.graph_data,
        embedding: [],
        source_refs: [{ url: article.link, source_name: source.name }],
        quality_score: 0.3,
        needs_ai_upgrade: true,
      });
    } else {
      try {
        const embedText = `${article.title}\n${out.audio_script}\n${out.web_dev_analogy}`;
        const embedding = await ai.embed(embedText);
        await store.createKnowledge({
          source_hash: article.titleHash,
          title: article.title,
          topic_tags: [source.category, out.keyword],
          summary_vn: out.audio_script.slice(0, 300),
          audio_script: out.audio_script,
          web_dev_analogy: out.web_dev_analogy,
          icebreaker: out.icebreaker,
          graph_data: out.graph_data,
          embedding,
          source_refs: [{ url: article.link, source_name: source.name }],
          quality_score: 0.85,
          needs_ai_upgrade: false,
        });
      } catch (kbErr) {
        console.warn(`[Pipeline] Không thể tạo RAG embedding cho "${article.title}":`, kbErr);
      }
    }

    return { outcome: { status: degraded ? 'fallback' : 'created', aiUsed }, aiExhausted };
  } catch (err) {
    return {
      outcome: {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        aiUsed: false,
      },
      aiExhausted,
    };
  }
}

const defaultStore: PipelineStore = {
  async findNewsByHash(titleHash) {
    return getNewsModel().findOne({ title_hash: titleHash }).lean().exec();
  },
  async createNews(data) {
    await getNewsModel().create(data);
  },
  async createKnowledge(data) {
    await getKnowledgeModel().create(data);
  },
  async upgradeNews(titleHash, patch) {
    await getNewsModel().updateOne({ title_hash: titleHash }, { $set: patch });
  },
  async upgradeKnowledge(sourceHash, patch) {
    await getKnowledgeModel().updateOne({ source_hash: sourceHash }, { $set: patch });
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PipelineDeps {
  ai?: AiProviderLike;
  store?: PipelineStore;
}

export class KnowledgePipeline {
  private readonly scraper: ScraperService;
  private readonly ai: AiProviderLike;
  private readonly store: PipelineStore;
  private running = false;

  constructor(deps: PipelineDeps = {}) {
    this.scraper = new ScraperService({ requestTimeoutMs: 12_000 });
    this.ai = deps.ai ?? geminiService;
    this.store = deps.store ?? defaultStore;
  }

  async run(options?: { rssUrl?: string; limitPerSource?: number }): Promise<PipelineResult> {
    const result: PipelineResult = {
      processed: 0,
      created: 0,
      upgraded: 0,
      fallback: 0,
      deferred: 0,
      duplicatesSkipped: 0,
      failed: 0,
      errors: [],
      sourcesProcessed: 0,
      quotaLimited: false,
    };

    if (this.running) {
      throw new Error('Pipeline đang chạy ở lượt khác — hãy chờ lượt trước hoàn tất rồi thử lại.');
    }
    this.running = true;

    try {
      if (!isConnected('news')) {
        throw new Error('Cơ sở dữ liệu tin tức chưa sẵn sàng — không thể lưu tin tức.');
      }

      const sourcesToRun: RssSourceConfig[] = options?.rssUrl
        ? [{ name: 'Custom RSS', url: options.rssUrl, category: 'Tech', lang: 'vi' }]
        : process.env.NEWS_RSS_URL
        ? [{ name: 'Env RSS', url: process.env.NEWS_RSS_URL, category: 'Tech', lang: 'vi' }, ...RSS_SOURCES]
        : RSS_SOURCES;

      const limit = options?.limitPerSource ?? env.PIPELINE_LIMIT_PER_SOURCE;
      const aiDelay = env.PIPELINE_AI_DELAY_MS;
      let aiExhausted = false;

      for (const source of sourcesToRun) {
        result.sourcesProcessed += 1;
        let articles: ScrapedArticle[] = [];

        try {
          articles = await this.scraper.fetchRssFeed({
            rssUrl: source.url,
            sourceName: source.name,
            limit,
          });
        } catch (err) {
          result.errors.push(`[${source.name}] Không thể lấy RSS: ${err instanceof Error ? err.message : 'Unknown error'}`);
          continue;
        } finally {
          runGarbageCollection();
        }

        for (const article of articles) {
          result.processed += 1;

          const { outcome, aiExhausted: nextAiExhausted } = await processArticle({
            article,
            source,
            ai: this.ai,
            store: this.store,
            aiExhausted,
          });
          aiExhausted = nextAiExhausted;

          switch (outcome.status) {
            case 'created':
              result.created += 1;
              break;
            case 'upgraded':
              result.upgraded += 1;
              break;
            case 'fallback':
              result.fallback += 1;
              break;
            case 'duplicate':
              result.duplicatesSkipped += 1;
              break;
            case 'deferred':
              result.deferred += 1;
              break;
            case 'failed':
              result.failed += 1;
              result.errors.push(
                `[${source.name}] ${article.title.slice(0, 50)}: ${outcome.error ?? 'Unknown error'}`
              );
              break;
          }

          if (outcome.aiUsed && aiDelay > 0) {
            await sleep(aiDelay);
          }
        }
      }

      if (aiExhausted) {
        result.quotaLimited = true;
        result.errors.push(
          '[L.H.T] Gemini đã cạn hạn mức AI (quota) — các bài còn lại được lưu bản tạm (degraded) và sẽ nâng cấp tự động khi quota hồi.'
        );
      }

      runGarbageCollection();
      return result;
    } finally {
      this.running = false;
    }
  }
}

export const knowledgePipeline = new KnowledgePipeline();
