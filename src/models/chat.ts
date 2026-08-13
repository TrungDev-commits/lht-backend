import { Schema, type Model } from 'mongoose';
import { getModel } from '../db/connections.js';

export interface ChatMessage {
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  refs: { knowledge_ids: string[]; research_job_id?: string };
  feedback: 'up' | 'down' | null;
  created_at: Date;
}

export const chatMessageSchema = new Schema(
  {
    session_id: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    refs: {
      type: {
        knowledge_ids: { type: [String], default: [] },
        research_job_id: { type: String },
      },
      default: () => ({ knowledge_ids: [] }),
      _id: false,
    },
    feedback: { type: String, enum: ['up', 'down', null], default: null },
    created_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

chatMessageSchema.index({ session_id: 1, created_at: 1 });
chatMessageSchema.index({ created_at: -1 });

export interface ChatSession {
  session_id: string;
  user_id: string;
  last_topic?: string;
  message_count: number;
  created_at: Date;
  updated_at: Date;
}

export const chatSessionSchema = new Schema(
  {
    session_id: { type: String, required: true, unique: true },
    user_id: { type: String, default: 'lam_huet_trung' },
    last_topic: { type: String },
    message_count: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  } as Record<string, unknown>,
  { versionKey: false }
);

export function getChatMessageModel(): Model<ChatMessage> {
  return getModel<ChatMessage>('chat', 'ChatMessage', chatMessageSchema, 'messages');
}

export function getChatSessionModel(): Model<ChatSession> {
  return getModel<ChatSession>('chat', 'ChatSession', chatSessionSchema, 'sessions');
}
