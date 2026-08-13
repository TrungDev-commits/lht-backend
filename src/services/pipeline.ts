import { getNewsModel } from '../models/news.js';
import { getKnowledgeModel } from '../models/knowledge.js';
import { ScraperService, runGarbageCollection, type ScrapedArticle } from './scraper.js';
import { geminiService, isQuotaExhausted } from './gemini.js';
import { isConnected } from '../db/connections.js';
import { RSS_SOURCES, type RssSourceConfig } from '../config/sources.js';
import { env } from '../config/env.js';

export interface PipelineResult {
  processed: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  errors: string[];
  sourcesProcessed: number;
  quotaLimited: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class KnowledgePipeline {
  private readonly scraper: ScraperService;
  private running = false;

  constructor() {
    this.scraper = new ScraperService({ requestTimeoutMs: 12_000 });
  }

  async run(options?: { rssUrl?: string; limitPerSource?: number }): Promise<PipelineResult> {
    const result: PipelineResult = {
      processed: 0,
      created: 0,
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

      for (const source of sourcesToRun) {
        if (result.quotaLimited) break;

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
          if (result.quotaLimited) break;

          result.processed += 1;
          try {
            const existing = await getNewsModel().findOne({ title_hash: article.titleHash }).lean().exec();
            if (existing) {
              result.duplicatesSkipped += 1;
              continue;
            }

            const cognitive = await geminiService.summarizeNews(article.rawText, article.title);
            const icebreaker = await geminiService.generateIceBreaker(cognitive.keyword);

            // 1. Lưu bản ghi News (cho Feed UI)
            await getNewsModel().create({
              source_url: article.link,
              keyword: cognitive.keyword,
              audio_script: cognitive.audio_script,
              web_dev_analogy: cognitive.web_dev_analogy,
              graph_data: cognitive.graph_data,
              title_hash: article.titleHash,
              icebreaker,
              source_name: source.name,
            });

            // 2. Tạo Vector Embedding & lưu vào KnowledgeModel (cho RAG retrieval)
            try {
              const embedText = `${article.title}\n${cognitive.audio_script}\n${cognitive.web_dev_analogy}`;
              const embedding = await geminiService.embed(embedText);

              await getKnowledgeModel().create({
                source_hash: article.titleHash,
                title: article.title,
                topic_tags: [source.category, cognitive.keyword],
                summary_vn: cognitive.audio_script.slice(0, 300),
                audio_script: cognitive.audio_script,
                web_dev_analogy: cognitive.web_dev_analogy,
                icebreaker,
                graph_data: cognitive.graph_data,
                embedding,
                source_refs: [{ url: article.link, source_name: source.name }],
                quality_score: 0.85,
              });
            } catch (kbErr) {
              console.warn(`[Pipeline] Không thể tạo RAG embedding cho "${article.title}":`, kbErr);
            }

            result.created += 1;
          } catch (err) {
            result.failed += 1;
            result.errors.push(
              `[${source.name}] ${article.title.slice(0, 50)}: ${err instanceof Error ? err.message : 'Unknown error'}`
            );
            if (isQuotaExhausted(err)) {
              result.quotaLimited = true;
              result.errors.push(
                '[L.H.T] Gemini đã cạn hạn mức AI (quota) — dừng pipeline sớm để tránh tiêu tốn thêm lượt gọi.'
              );
            }
          } finally {
            runGarbageCollection();
          }

          if (!result.quotaLimited && aiDelay > 0) {
            await sleep(aiDelay);
          }
        }
      }

      runGarbageCollection();
      return result;
    } finally {
      this.running = false;
    }
  }
}

export const knowledgePipeline = new KnowledgePipeline();
