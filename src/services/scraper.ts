import { createHash } from 'node:crypto';
import axios, { type AxiosInstance } from 'axios';
import { load, type CheerioAPI } from 'cheerio';

export interface ScrapedArticle {
  title: string;
  link: string;
  rawText: string;
  titleHash: string;
  publishedAt: Date;
  sourceName: string;
}

export interface ScraperOptions {
  rssUrl: string;
  sourceName?: string;
  limit?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
}

interface RssItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; LHT-Terminal/1.0; +https://github.com/lht-terminal)';

const ARTICLE_TEXT_SELECTORS = [
  'article',
  '.article-content',
  '.detail-content',
  '.content-detail',
  '.main-content',
  'main p',
];

const MAX_ARTICLE_TEXT_LENGTH = 8_000;
const MAX_RAW_TEXT_LENGTH = 12_000;

export function hashTitle(title: string): string {
  return createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

function extractTextFromHtml(html: string): string {
  const $ = load(html);
  $('script, style, noscript, iframe, nav, header, footer, form').remove();

  const collected: string[] = [];
  for (const selector of ARTICLE_TEXT_SELECTORS) {
    $(selector).each((_index, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > 120) {
        collected.push(text);
      }
    });
  }

  if (collected.length > 0) {
    return collected.join('\n').slice(0, MAX_ARTICLE_TEXT_LENGTH);
  }

  const paragraphs: string[] = [];
  $('p').each((_index, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 40) {
      paragraphs.push(text);
    }
  });

  return paragraphs.join('\n').slice(0, MAX_ARTICLE_TEXT_LENGTH);
}

export function parseRssFeed(xml: string): RssItem[] {
  const $ = load(xml, { xmlMode: true });

  const items: RssItem[] = [];
  $('item').each((_index, el) => {
    const title = $(el).find('title').first().text().trim();
    const link = $(el).find('link').first().text().trim();
    const description = $(el).find('description').first().text().trim();
    const pubDate = $(el).find('pubDate').first().text().trim();

    if (!title || !link) return;

    items.push({
      title,
      link: link.replace(/&amp;/g, '&'),
      description: description || undefined,
      pubDate: pubDate || undefined,
    });
  });

  return items;
}

export class ScraperService {
  private readonly http: AxiosInstance;

  constructor(options?: { requestTimeoutMs?: number }) {
    this.http = axios.create({
      timeout: options?.requestTimeoutMs ?? 12_000,
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      maxRedirects: 5,
    });
  }

  async fetchRssFeed(options: ScraperOptions): Promise<ScrapedArticle[]> {
    const {
      rssUrl,
      sourceName = 'L.H.T Tech News',
      limit = 10,
    } = options;

    const response = await this.http.get<string>(rssUrl, {
      responseType: 'text',
      headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });

    const items = parseRssFeed(response.data);
    const sliced = items.slice(0, Math.max(1, Math.min(limit, 30)));

    const articles: ScrapedArticle[] = [];
    for (const item of sliced) {
      const rawText = await this.fetchArticleText(item.link, item.description);
      articles.push({
        title: item.title,
        link: item.link,
        rawText: rawText || item.title,
        titleHash: hashTitle(item.title),
        publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        sourceName,
      });
    }

    return articles;
  }

  async fetchArticleText(link: string, fallbackDescription?: string): Promise<string> {
    try {
      const response = await this.http.get<string>(link, {
        responseType: 'text',
        headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
      });

      const contentType = String(response.headers['content-type'] ?? '');
      const isHtml = /html|xml/i.test(contentType);

      if (!isHtml) {
        return this.stripTags(response.data).slice(0, MAX_RAW_TEXT_LENGTH);
      }

      return extractTextFromHtml(response.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown scrape error';
      console.warn(`[L.H.T SCRAPER] Không thể lấy bài viết ${link}: ${message}`);
      return fallbackDescription ? this.stripTags(fallbackDescription) : '';
    }
  }

  private stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function runGarbageCollection(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}
