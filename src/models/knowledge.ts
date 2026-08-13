import { Schema, type Model } from 'mongoose';
import { getModel } from '../db/connections.js';
import type { GraphNodeData, GraphEdgeData } from './types.js';

export interface Knowledge {
  source_hash: string;
  title: string;
  topic_tags: string[];
  summary_vn: string;
  audio_script: string;
  web_dev_analogy: string;
  icebreaker: string;
  graph_data: { nodes: GraphNodeData[]; edges: GraphEdgeData[] };
  embedding: number[];
  source_refs: { url: string; source_name: string; published_at?: Date }[];
  quality_score: number;
  last_reviewed?: Date;
  created_at: Date;
}

export const knowledgeSchema = new Schema(
  {
    source_hash: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, index: true },
    topic_tags: { type: [String], default: [], index: true },
    summary_vn: { type: String, default: '', trim: true },
    audio_script: { type: String, default: '', trim: true },
    web_dev_analogy: { type: String, default: '', trim: true },
    icebreaker: { type: String, default: '', trim: true },
    graph_data: {
      type: {
        nodes: { type: [Schema.Types.Mixed], default: [] },
        edges: { type: [Schema.Types.Mixed], default: [] },
      },
      default: () => ({ nodes: [], edges: [] }),
      _id: false,
    },
    embedding: { type: [Number], default: [] },
    source_refs: {
      type: [
        {
          url: { type: String, required: true },
          source_name: { type: String, default: '' },
          published_at: { type: Date },
        },
      ],
      default: [],
      _id: false,
    },
    quality_score: { type: Number, default: 0.5, min: 0, max: 1 },
    last_reviewed: { type: Date },
    created_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

knowledgeSchema.index({ created_at: -1 });

export interface Concept {
  name: string;
  category: 'HARDWARE' | 'SOFTWARE';
  desc: string;
  aliases: string[];
  knowledge_ids: string[];
  created_at: Date;
}

export const conceptSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, index: true },
    category: { type: String, enum: ['HARDWARE', 'SOFTWARE'], default: 'SOFTWARE' },
    desc: { type: String, default: '' },
    aliases: { type: [String], default: [] },
    knowledge_ids: { type: [String], default: [] },
    created_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

export interface Relation {
  source: string;
  target: string;
  relation_type: 'related_to' | 'analogy_of' | 'prerequisite_of';
  created_at: Date;
}

export const relationSchema = new Schema(
  {
    source: { type: String, required: true, index: true },
    target: { type: String, required: true, index: true },
    relation_type: {
      type: String,
      enum: ['related_to', 'analogy_of', 'prerequisite_of'],
      default: 'related_to',
    },
    created_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

relationSchema.index({ source: 1, target: 1 }, { unique: true });

export interface TtsCacheEntry {
  text_hash: string;
  text: string;
  provider: string;
  audio_url: string;
  created_at: Date;
}

export const ttsCacheSchema = new Schema(
  {
    text_hash: { type: String, required: true, unique: true, index: true },
    text: { type: String, default: '' },
    provider: { type: String, default: 'fpt' },
    audio_url: { type: String, default: '' },
    created_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 },
  } as Record<string, unknown>,
  { versionKey: false }
);

export function getKnowledgeModel(): Model<Knowledge> {
  return getModel<Knowledge>('kb', 'Knowledge', knowledgeSchema, 'knowledge');
}

export function getConceptModel(): Model<Concept> {
  return getModel<Concept>('kb', 'Concept', conceptSchema, 'concepts');
}

export function getRelationModel(): Model<Relation> {
  return getModel<Relation>('kb', 'Relation', relationSchema, 'relations');
}

export function getTtsCacheModel(): Model<TtsCacheEntry> {
  return getModel<TtsCacheEntry>('kb', 'TtsCache', ttsCacheSchema, 'tts_cache');
}
