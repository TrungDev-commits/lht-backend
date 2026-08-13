import { geminiService } from './gemini.js';
import { retrieveKnowledge, expandWithGraph, getUserInterests } from './rag.js';
import { runGarbageCollection } from './scraper.js';

export interface QueryResult {
  reply: string;
  references: { knowledge_id: string; title: string }[];
  timestamp: string;
}

function fallbackReply(prompt: string): string {
  return `[L.H.T HEURISTIC]: Nhận tín hiệu lệnh: "${prompt}". Hệ thống đang trong chế độ dự phòng nội bộ (thiếu GEMINI_API_KEY). Kết nối Neural Link sẵn sàng.`;
}

export async function queryAI(input: { prompt: string; mode?: string }): Promise<QueryResult> {
  const prompt = input.prompt.trim();

  if (!geminiService.isAvailable()) {
    return {
      reply: fallbackReply(prompt),
      references: [],
      timestamp: new Date().toISOString(),
    };
  }

  const interests = await getUserInterests();
  let hits = await retrieveKnowledge(prompt, { interests, limit: 5 });
  hits = await expandWithGraph(hits);

  const contextParts =
    hits.length > 0
      ? hits.map(
          (h) =>
            `### ${h.title}\nTóm tắt: ${h.summary_vn}\nẨn dụ Web Dev: ${h.web_dev_analogy}`
        )
      : ['(Không có kiến thức phù hợp — trả lời từ kiến thức nền.)'];

  const useAnalogy = input.mode === 'ANALOGY';
  const userMessage = useAnalogy
    ? `Sếp muốn tìm hiểu liên kết giữa Hardware và Web Dev cho khái niệm: "${prompt}". Hãy giải thích ngắn gọn và đưa ra phép so sánh sắc bén giữa Phần Cứng và Phần Mềm Web.`
    : prompt;

  const reply = await geminiService.chatWithContext(userMessage, contextParts.join('\n\n'));
  runGarbageCollection();

  return {
    reply,
    references: hits.map((h) => ({ knowledge_id: h.knowledge_id, title: h.title })),
    timestamp: new Date().toISOString(),
  };
}