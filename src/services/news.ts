import { createHash } from 'node:crypto';
import { getNewsModel, type News } from '../models/news.js';
import { getInteractionModel } from '../models/memory.js';

export interface NewsSignalsInput {
  news_id: string;
  keyword: string;
  action: 'listened' | 'skipped' | 'bookmarked';
}

export interface NewsCreateInput {
  source_url: string;
  keyword: string;
  audio_script?: string;
  web_dev_analogy?: string;
  graph_data?: unknown;
  icebreaker?: string;
}

function hashTitle(title: string): string {
  return createHash('sha256').update(title.trim().toLowerCase()).digest('hex');
}

export const newsService = {
  async getToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const items = await getNewsModel()
      .find({ created_at: { $gte: startOfDay } })
      .sort({ created_at: -1 })
      .lean()
      .exec();

    return {
      date: new Date().toISOString().slice(0, 10),
      count: items.length,
      items,
    };
  },

  async list(input: { keyword?: string; limit?: number; skip?: number }) {
    const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    const skip = Math.max(Number(input.skip) || 0, 0);

    const filter = keyword ? { keyword: { $regex: keyword, $options: 'i' } } : {};

    const [items, total] = await Promise.all([
      getNewsModel().find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean().exec(),
      getNewsModel().countDocuments(filter).exec(),
    ]);

    return { items, total, limit, skip };
  },

  async getById(id: string) {
    return getNewsModel().findById(id).lean().exec();
  },

  async create(input: NewsCreateInput) {
    const sourceUrl = input.source_url.trim();
    const keyword = input.keyword.trim();

    if (!sourceUrl || !keyword) {
      throw new Error('Thiếu trường bắt buộc: source_url và keyword');
    }

    return getNewsModel().create({
      source_url: sourceUrl,
      keyword,
      audio_script: typeof input.audio_script === 'string' ? input.audio_script : '',
      web_dev_analogy: typeof input.web_dev_analogy === 'string' ? input.web_dev_analogy : '',
      graph_data: input.graph_data ?? { nodes: [], edges: [] },
      title_hash: hashTitle(`${sourceUrl}|${keyword}`),
      icebreaker: typeof input.icebreaker === 'string' ? input.icebreaker : '',
    });
  },

  async update(id: string, body: Record<string, unknown>) {
    const updates: Record<string, unknown> = {};
    if (typeof body.source_url === 'string' && body.source_url.trim()) updates.source_url = body.source_url.trim();
    if (typeof body.keyword === 'string' && body.keyword.trim()) updates.keyword = body.keyword.trim();
    if (typeof body.audio_script === 'string') updates.audio_script = body.audio_script;
    if (typeof body.web_dev_analogy === 'string') updates.web_dev_analogy = body.web_dev_analogy;
    if (body.graph_data !== undefined) updates.graph_data = body.graph_data;

    return getNewsModel().findByIdAndUpdate(id, updates, { new: true }).lean().exec();
  },

  async remove(id: string) {
    return getNewsModel().findByIdAndDelete(id).exec();
  },

  async recordSignals(rawSignals: unknown[]): Promise<number> {
    const signals: NewsSignalsInput[] = (Array.isArray(rawSignals) ? rawSignals : [])
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        news_id: typeof s.news_id === 'string' ? s.news_id : '',
        keyword: typeof s.keyword === 'string' ? s.keyword : '',
        action:
          s.action === 'listened' || s.action === 'skipped' || s.action === 'bookmarked'
            ? s.action
            : null,
      }))
      .filter((s) => s.news_id && s.action !== null) as NewsSignalsInput[];

    if (signals.length === 0) return 0;

    await getInteractionModel().insertMany(
      signals.map((s) => ({
        news_id: s.news_id,
        keyword: s.keyword,
        action: s.action,
        created_at: new Date(),
      })),
      { ordered: false }
    );

    return signals.length;
  },
};
