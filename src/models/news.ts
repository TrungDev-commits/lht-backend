import { Schema, type Model } from 'mongoose';
import { getModel } from '../db/connections.js';

export interface News {
  source_url: string;
  keyword: string;
  audio_script: string;
  web_dev_analogy: string;
  graph_data: { nodes: unknown[]; edges: unknown[] };
  title_hash: string;
  icebreaker: string;
  source_name: string;
  created_at: Date;
}

const graphDataSchema = new Schema(
  {
    nodes: { type: [Schema.Types.Mixed], default: [] },
    edges: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

export const newsSchema = new Schema(
  {
    source_url: { type: String, required: true, trim: true },
    keyword: { type: String, required: true, trim: true, index: true },
    audio_script: { type: String, default: '', trim: true },
    web_dev_analogy: { type: String, default: '', trim: true },
    graph_data: { type: graphDataSchema, default: () => ({ nodes: [], edges: [] }) },
    title_hash: { type: String, required: true, unique: true, index: true },
    icebreaker: { type: String, default: '', trim: true },
    source_name: { type: String, default: '', trim: true },
    created_at: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
    minimize: false,
  }
);

newsSchema.index({ created_at: -1 });

export function getNewsModel(): Model<News> {
  return getModel<News>('news', 'News', newsSchema, 'news');
}
