import { Schema, type Model } from 'mongoose';
import { getModel } from '../db/connections.js';

export interface UserMemory {
  user_id: string;
  name: string;
  tech_stack: string[];
  interests: Record<string, number>;
  suggested_rss_urls: string[];
  updated_at: Date;
}

export const userMemorySchema = new Schema(
  {
    user_id: { type: String, required: true, unique: true },
    name: { type: String, default: 'Lâm Huệ Trung' },
    tech_stack: { type: [String], default: [] },
    interests: { type: Map, of: Number, default: {} },
    suggested_rss_urls: { type: [String], default: [] },
    updated_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

export interface Interaction {
  news_id: string;
  keyword: string;
  action: 'listened' | 'skipped' | 'bookmarked';
  created_at: Date;
}

export const interactionSchema = new Schema(
  {
    news_id: { type: String, required: true, index: true },
    keyword: { type: String, default: '' },
    action: { type: String, enum: ['listened', 'skipped', 'bookmarked'], required: true },
    created_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

interactionSchema.index({ created_at: -1 });

export interface ResearchJob {
  query: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  dispatch_id?: string;
  result?: { collected: number; created: number; message: string };
  knowledge_ids: string[];
  error?: string;
  created_at: Date;
  updated_at: Date;
}

export const researchJobSchema = new Schema(
  {
    query: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed'],
      default: 'queued',
    },
    dispatch_id: { type: String },
    result: {
      type: {
        collected: { type: Number, default: 0 },
        created: { type: Number, default: 0 },
        message: { type: String, default: '' },
      },
      default: undefined,
      _id: false,
    },
    knowledge_ids: { type: [String], default: [] },
    error: { type: String },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

researchJobSchema.index({ status: 1, created_at: -1 });

export function getUserMemoryModel(): Model<UserMemory> {
  return getModel<UserMemory>('memory', 'UserMemory', userMemorySchema, 'user_memory');
}

export function getInteractionModel(): Model<Interaction> {
  return getModel<Interaction>('memory', 'Interaction', interactionSchema, 'interactions');
}

export function getResearchJobModel(): Model<ResearchJob> {
  return getModel<ResearchJob>('memory', 'ResearchJob', researchJobSchema, 'research_jobs');
}
