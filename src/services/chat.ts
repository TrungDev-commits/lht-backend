import { randomUUID } from 'node:crypto';
import { getChatMessageModel, getChatSessionModel, type ChatMessage } from '../models/chat.js';
import { getTodayFinanceSummary } from '../config/finance.js';
import { geminiService } from './gemini.js';
import {
  retrieveKnowledge,
  expandWithGraph,
  getUserInterests,
  type RetrievalHit,
} from './rag.js';

export interface ChatResponse {
  reply: string;
  references: { knowledge_id: string; title: string }[];
  needs_research: boolean;
  session_id: string;
}

const RESEARCH_SCORE_THRESHOLD = 0.65;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function createChatSession(userId = 'lam_huet_trung'): Promise<string> {
  const sessionId = randomUUID();
  await getChatSessionModel().create({ session_id: sessionId, user_id: userId });
  return sessionId;
}

export type ChatMessageDoc = ChatMessage & { _id: unknown; created_at: Date };

export async function getRecentMessages(sessionId: string, limit = 10): Promise<ChatMessageDoc[]> {
  return getChatMessageModel()
    .find({ session_id: sessionId })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean()
    .exec();
}

export async function chat(sessionId: string, message: string): Promise<ChatResponse> {
  const session = await getChatSessionModel().findOne({ session_id: sessionId }).lean().exec();
  const effectiveSessionId = session ? sessionId : await createChatSession();

  const interests = await getUserInterests();
  let hits = await retrieveKnowledge(message, { interests, limit: 6 });
  hits = await expandWithGraph(hits);

  const topScore = hits.length > 0 ? (hits[0]?.score ?? 0) : 0;

  const recentMessages = await getChatMessageModel()
    .find({ session_id: effectiveSessionId })
    .sort({ created_at: -1 })
    .limit(10)
    .lean()
    .exec();

  const historyText = recentMessages
    .reverse()
    .map((m) => `${m.role === 'user' ? 'Sếp' : 'L.H.T'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const finance = await getTodayFinanceSummary();
  const financeText = finance
    ? `Tài chính hôm nay: còn ${finance.remaining.toLocaleString('vi-VN')} ${finance.currency}.`
    : '';

  const contextParts: string[] = ['(Không có kiến thức phù hợp trong kho — trả lời từ kiến thức nền và đề nghị nghiên cứu thêm nếu cần.)'];
  if (hits.length > 0) {
    contextParts.length = 0;
    for (const hit of hits) {
      contextParts.push(
        `### ${hit.title} [độ liên quan ${hit.score.toFixed(2)}]\n` +
          `Tóm tắt: ${hit.summary_vn}\n` +
          `Ẩn dụ Web Dev: ${hit.web_dev_analogy}\n` +
          `Chủ đề: ${(hit.topic_tags ?? []).join(', ')}`
      );
    }
  }

  const userPrompt = [
    `Sếp nói: ${message}`,
    financeText ? `\n[CẬP NHẬT TÀI CHÍNH]\n${financeText}` : '',
    historyText ? `\n[HỘI THOẠI GẦN ĐÂY]\n${historyText}` : '',
  ].join('\n');

  const reply = await geminiService.chatWithContext(userPrompt, contextParts.join('\n\n'));

  await getChatMessageModel().create([
    { session_id: effectiveSessionId, role: 'user', content: message, refs: { knowledge_ids: [] } },
    {
      session_id: effectiveSessionId,
      role: 'assistant',
      content: reply,
      refs: { knowledge_ids: hits.map((h) => h.knowledge_id) },
    },
  ]);

  await getChatSessionModel()
    .updateOne(
      { session_id: effectiveSessionId },
      { $inc: { message_count: 2 }, $set: { updated_at: new Date(), last_topic: hits[0]?.title } },
      { upsert: true }
    )
    .exec();

  return {
    reply,
    references: hits
      .filter((h) => h.score >= 0.3)
      .map((h) => ({ knowledge_id: h.knowledge_id, title: h.title }))
      .slice(0, 5),
    needs_research: topScore < RESEARCH_SCORE_THRESHOLD,
    session_id: effectiveSessionId,
  };
}

export async function getChatHistory(sessionId: string, limit = 30): Promise<ChatMessageDoc[]> {
  return getChatMessageModel()
    .find({ session_id: sessionId })
    .sort({ created_at: -1 })
    .limit(limit)
    .lean()
    .exec();
}

export async function setFeedback(sessionId: string, messageId: string, rating: 'up' | 'down'): Promise<boolean> {
  const result = await getChatMessageModel()
    .updateOne(
      { _id: messageId, session_id: sessionId, role: 'assistant' },
      { $set: { feedback: rating } }
    )
    .exec();
  return result.modifiedCount > 0;
}

export function buildTtsText(reply: string): string {
  const sentences = splitSentences(reply);
  const withoutSystemTag = sentences.filter((s) => !s.startsWith('['));
  const joined = withoutSystemTag.join(' ');
  return joined.slice(0, 500);
}

export type { RetrievalHit };
export { splitSentences };