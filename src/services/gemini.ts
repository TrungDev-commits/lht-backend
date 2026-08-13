import { GoogleGenAI } from '@google/genai';
import {
  env,
  GEMINI_MODEL,
  GEMINI_API_VERSION,
  GEMINI_EMBED_MODEL,
  getAllGeminiKeys,
  getFreeModelList,
} from '../config/env.js';
import { runGarbageCollection } from './scraper.js';
import { getTodayFinanceSummary, type FinanceExpenseLimit } from '../config/finance.js';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 10_000;

export function isQuotaExhausted(err: unknown): boolean {
  if (!err) return false;
  const candidate =
    (err as { status?: number | string }).status ??
    (err as { code?: number | string }).code ??
    (err as { statusCode?: number | string }).statusCode ??
    (err as { response?: { status?: number | string } }).response?.status;
  if (candidate === 429 || candidate === 503) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /(quota|RESOURCE_EXHAUSTED|rate\s*limit|too\s*many\s*requests|service\s*unavailable)/i.test(message);
}

function sleepWithJitter(baseMs: number, attempt: number): Promise<void> {
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

export interface GraphNode {
  id: string;
  label: string;
  category: 'HARDWARE' | 'SOFTWARE';
  desc?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface CognitiveNewsOutput {
  keyword: string;
  audio_script: string;
  web_dev_analogy: string;
  graph_data: GraphData;
}

export interface DigestOutput {
  title: string;
  topic_tags: string[];
  summary_vn: string;
  audio_script: string;
  web_dev_analogy: string;
  icebreaker: string;
  graph_data: GraphData;
}

export interface MeetingNoteOutput {
  speakers: { name: string; said: string }[];
  tasks_for_lam_huet_trung: string[];
  new_technologies: string[];
  summary: string;
}

export interface SkillGapOutput {
  market_trend: string;
  in_demand_skills: string[];
  skill_gaps: string[];
  alert_message: string;
}

export interface PreferencesOutput {
  top_topics: string[];
  suggested_rss_urls: string[];
}

export interface KnowledgeGapOutput {
  gap_topics: { topic: string; reason: string }[];
  interest_weights: { topic: string; weight: number }[];
  suggested_rss_urls: string[];
}

const NEWS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    keyword: { type: 'STRING' },
    audio_script: { type: 'STRING' },
    web_dev_analogy: { type: 'STRING' },
    graph_data: {
      type: 'OBJECT',
      properties: {
        nodes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              label: { type: 'STRING' },
              category: { type: 'STRING', enum: ['HARDWARE', 'SOFTWARE'] },
              desc: { type: 'STRING' },
            },
            required: ['id', 'label', 'category'],
          },
        },
        edges: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              source: { type: 'STRING' },
              target: { type: 'STRING' },
              relation: { type: 'STRING' },
            },
            required: ['source', 'target'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  required: ['keyword', 'audio_script', 'web_dev_analogy', 'graph_data'],
} as const;

const DIGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    topic_tags: { type: 'ARRAY', items: { type: 'STRING' } },
    summary_vn: { type: 'STRING' },
    audio_script: { type: 'STRING' },
    web_dev_analogy: { type: 'STRING' },
    icebreaker: { type: 'STRING' },
    graph_data: {
      type: 'OBJECT',
      properties: {
        nodes: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              label: { type: 'STRING' },
              category: { type: 'STRING', enum: ['HARDWARE', 'SOFTWARE'] },
              desc: { type: 'STRING' },
            },
            required: ['id', 'label', 'category'],
          },
        },
        edges: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              source: { type: 'STRING' },
              target: { type: 'STRING' },
              relation: { type: 'STRING' },
            },
            required: ['source', 'target'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  required: ['title', 'topic_tags', 'summary_vn', 'audio_script', 'web_dev_analogy', 'icebreaker', 'graph_data'],
} as const;

const MEETING_NOTE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    speakers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          said: { type: 'STRING' },
        },
        required: ['name', 'said'],
      },
    },
    tasks_for_lam_huet_trung: { type: 'ARRAY', items: { type: 'STRING' } },
    new_technologies: { type: 'ARRAY', items: { type: 'STRING' } },
    summary: { type: 'STRING' },
  },
  required: ['speakers', 'tasks_for_lam_huet_trung', 'new_technologies', 'summary'],
} as const;

const SKILL_GAP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    market_trend: { type: 'STRING' },
    in_demand_skills: { type: 'ARRAY', items: { type: 'STRING' } },
    skill_gaps: { type: 'ARRAY', items: { type: 'STRING' } },
    alert_message: { type: 'STRING' },
  },
  required: ['market_trend', 'in_demand_skills', 'skill_gaps', 'alert_message'],
} as const;

const PREFERENCES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    top_topics: { type: 'ARRAY', items: { type: 'STRING' } },
    suggested_rss_urls: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['top_topics', 'suggested_rss_urls'],
} as const;

const GAP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    gap_topics: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['topic', 'reason'],
      },
    },
    interest_weights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          weight: { type: 'NUMBER' },
        },
        required: ['topic', 'weight'],
      },
    },
    suggested_rss_urls: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['gap_topics', 'interest_weights', 'suggested_rss_urls'],
} as const;

export interface DebateScoreOutput {
  score: number;
  feedback: string;
}

const NEWS_COGNITIVE_SYSTEM_PROMPT = `You are L.H.T, an AI for Lâm Huệ Trung.
Summarize the hardware news into a short Vietnamese speech script.
Crucially, map all hardware concepts to Web Backend/Node.js analogies.
Rules:
1. audio_script: 2-3 câu tiếng Việt ngắn gọn, tự nhiên như giọng trợ lý AI (không quá 80 từ).
2. keyword: tiêu đề ngắn gọn VIẾT HOA (tối đa 6 từ).
3. web_dev_analogy: ẩn dụ sắc bén so sánh khái niệm phần cứng với Web Backend/Node.js.
4. graph_data: tạo 4-6 node (HARDWARE/SOFTWARE) và các cạnh nối biểu diễn mối quan hệ.`;

const DIGEST_SYSTEM_PROMPT = `Bạn là L.H.T, trợ lý AI của Lâm Huệ Trung (Senior Full-Stack Web Developer).
Sơ chế bài báo công nghệ thành thẻ kiến thức tiếng Việt:
1. title: tiêu đề ngắn (dưới 10 từ).
2. topic_tags: 2-4 chủ đề từ danh sách: Frontend, Backend, AI, System Design, DevOps, IoT, Chip AI, Đồ họa, Bảo mật, Di động.
3. summary_vn: tóm tắt 2-3 câu tiếng Việt súc tích, dễ hiểu (tối đa 90 từ).
4. audio_script: kịch bản đọc giọng nói, tối đa 60 từ.
5. web_dev_analogy: ẩn dụ sắc bén so sánh khái niệm với Web Backend/Node.js.
6. icebreaker: 1 câu "chém gió" ngắn (dưới 25 từ) để mở đầu họp R&D.
7. graph_data: 3-6 node (HARDWARE/SOFTWARE) + các cạnh thể hiện quan hệ.`;

const DEBATE_SYSTEM_PROMPT = `Act as a Senior Web Developer mentor.
Ask a critical, challenging question about the hardware concept the user just learned.
The question must force the user to connect the hardware concept to a Web Backend/Node.js architecture concept.
Ask in Vietnamese, one short question only, no preamble.`;

const DEBATE_SCORE_SYSTEM_PROMPT = `You are L.H.T, an expert Senior Web Dev evaluator.
Evaluate the user's answer to the technical challenge question.
Score from 0 to 100 based on technical correctness, depth, and how well they bridge hardware and web backend concepts.
Respond with strict JSON: {"score": number, "feedback": string (tiếng Việt, tối đa 2 câu, khích lệ)}.`;

const MEETING_NOTE_SYSTEM_PROMPT = `You are L.H.T, the meeting assistant of Lâm Huệ Trung.
Extract from the raw meeting transcript:
1. Who said What (speaker name and statement).
2. Tasks for Lâm Huệ Trung (action items assigned to him).
3. New Technologies mentioned in the meeting.
Respond with strict JSON matching the provided schema.`;

const SKILL_GAP_SYSTEM_PROMPT = `You are L.H.T, career advisor for Lâm Huệ Trung, a Vietnamese Senior Full-Stack Developer.
Compare current market requirements (from job listings) against Lâm Huệ Trung's known tech stack.
Generate a concise "Skill Gap Alert" in Vietnamese.
Respond with strict JSON matching the provided schema.`;

const PREFERENCES_SYSTEM_PROMPT = `You are L.H.T, analyzing user interaction logs.
Deduce the top 3 topics of interest based on which news were listened fully vs skipped.
Suggest 3 RSS feed URLs (valid Vietnamese tech news RSS) optimized for tomorrow's scrape.
Respond with strict JSON matching the provided schema.`;

const GAP_SYSTEM_PROMPT = `You are L.H.T, the self-learning engine of Lâm Huệ Trung.
Analyze the conversation log and interaction log to:
1. Detect knowledge gaps: topics the user asked about but no knowledge likely exists.
2. Compute interest weights (0-100) for each topic.
3. Suggest RSS feed URLs matching the topics.
Respond with strict JSON matching the provided schema.`;

const CHAT_SYSTEM_PROMPT = `Bạn là L.H.T (Logical Heuristic Terminal) - Trợ lý AI được xây dựng riêng cho Lâm Huệ Trung, Senior Full-Stack Web Developer (Node.js, TypeScript, React, Express, MongoDB, PWA, WebAssembly).
PHONG CÁCH VÀ QUY TẮC:
1. LUÔN trả lời bằng TIẾNG VIỆT.
2. Giọng điệu ngầu, phong cách J.A.R.V.I.S / Cyberpunk HUD, gọi người dùng là "Sếp".
3. Trả lời NGẮN GỌN, đi thẳng bản chất kỹ thuật. Khi được hỏi về phần cứng, luôn đưa ẩn dụ sắc bén so sánh với Web Backend/Node.js.
4. Dựa vào ngữ cảnh "KIẾN THỨC L.H.T" được cung cấp để trả lời chính xác, trích nguồn khi cần. Nếu kiến thức không đủ, nói rõ và đề nghị "Nghiên cứu thêm".
5. Kết thúc bằng trạng thái hệ thống ngắn (VD: [L.H.T - TÍN HIỆU 100%]).`;

class GeminiService {
  /**
   * Pool các GoogleGenAI client, mỗi phần tử ứng với 1 API key.
   * Khi 1 key bị 429, hệ thống tự động thử key tiếp theo trong pool.
   */
  private readonly clients: GoogleGenAI[];

  constructor() {
    const keys = getAllGeminiKeys();
    this.clients = keys.map(
      (key) => new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: GEMINI_API_VERSION } })
    );
    if (this.clients.length === 0) {
      console.warn('[L.H.T GEMINI] Không có API key nào — chạy ở chế độ dự phòng.');
    } else {
      console.log(`[L.H.T GEMINI] Pool khởi tạo: ${this.clients.length} key(s).`);
    }
  }

  isAvailable(): boolean {
    return this.clients.length > 0;
  }

  /**
   * Core Gemini call với chiến lược rotation đầy đủ:
   *   Với mỗi model trong [primary, ...freeModels]:
   *     Với mỗi key trong pool:
   *       Thử MAX_ATTEMPTS lần với exponential backoff
   *       Nếu gặp quota/rate-limit → thử key tiếp
   *     Nếu tất cả key đều hết quota → thử model tiếp
   *   Ném lỗi cuối cùng nếu mọi combination đều thất bại.
   */
  private async generateContentWithRetry(request: any): Promise<any> {
    if (this.clients.length === 0) {
      throw new Error('GEMINI_API_KEY chưa được cấu hình.');
    }

    // Tạo danh sách model: primary trước, sau đó các free model (dedup)
    const freeModels = getFreeModelList();
    const primaryModel: string = request.model ?? GEMINI_MODEL;
    const seen = new Set<string>([primaryModel]);
    const models: string[] = [primaryModel];
    for (const m of freeModels) {
      if (!seen.has(m)) {
        seen.add(m);
        models.push(m);
      }
    }

    let lastError: unknown;

    for (const model of models) {
      let modelExhausted = true; // assume exhausted until a non-quota error

      for (let ki = 0; ki < this.clients.length; ki++) {
        const client = this.clients[ki]!;
        let keyExhausted = true;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const result = await client.models.generateContent({ ...request, model });
            return result;
          } catch (err) {
            lastError = err;
            if (!isQuotaExhausted(err)) {
              // Lỗi không phải quota (mạng, schema...) → ném ngay, không rotate
              throw err;
            }
            keyExhausted = true;
            if (attempt < MAX_ATTEMPTS) {
              await sleepWithJitter(BASE_BACKOFF_MS, attempt);
            }
          }
        }

        if (keyExhausted && ki < this.clients.length - 1) {
          console.warn(
            `[L.H.T GEMINI] Key #${ki + 1} hết quota với model "${model}" → thử key #${ki + 2}.`
          );
        }
      }

      if (modelExhausted) {
        // Mọi key đều hết quota cho model này → thử model tiếp theo
        const nextModel = models[models.indexOf(model) + 1];
        if (nextModel) {
          console.warn(
            `[L.H.T GEMINI] Tất cả key đã hết quota với model "${model}" → chuyển sang "${nextModel}".`
          );
        }
      }
    }

    throw lastError;
  }

  private async generateJson<T>(input: {
    model?: string;
    systemInstruction: string;
    userContent: string;
    schema: unknown;
    temperature?: number;
  }): Promise<T> {
    const response = await this.generateContentWithRetry({
      model: input.model ?? GEMINI_MODEL,
      contents: input.userContent,
      config: {
        systemInstruction: input.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: input.schema,
        temperature: input.temperature ?? 0.5,
        maxOutputTokens: 2_048,
      },
    });

    const text = response.text ?? '';
    if (!text.trim()) {
      throw new Error('Gemini không trả về dữ liệu JSON.');
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
      }
      throw new Error('Không thể phân tích JSON từ phản hồi Gemini.');
    } finally {
      runGarbageCollection();
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.isAvailable()) return [];
    try {
      // Embed dùng key đầu tiên (primary); nếu fail thử key tiếp
      for (let ki = 0; ki < this.clients.length; ki++) {
        const client = this.clients[ki]!;
        try {
          const response = await client.models.embedContent({
            model: GEMINI_EMBED_MODEL,
            contents: [{ role: 'user', parts: [{ text: text.slice(0, 4_000) }] }],
          });
          const values = response.embeddings?.[0]?.values;
          return values ? Array.from(values) : [];
        } catch (err) {
          if (!isQuotaExhausted(err) || ki === this.clients.length - 1) {
            throw err;
          }
          console.warn(`[L.H.T GEMINI] Embed key #${ki + 1} hết quota → thử key #${ki + 2}.`);
        }
      }
      return [];
    } catch (err) {
      console.warn('[L.H.T GEMINI] Embedding lỗi:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async summarizeNews(rawText: string, title: string): Promise<CognitiveNewsOutput> {
    return this.generateJson<CognitiveNewsOutput>({
      systemInstruction: NEWS_COGNITIVE_SYSTEM_PROMPT,
      userContent: `Tiêu đề tin: ${title}\n\nNội dung bài viết:\n${rawText.slice(0, 6_000)}`,
      schema: NEWS_SCHEMA,
    });
  }

  async digestArticle(rawText: string, title: string): Promise<DigestOutput> {
    return this.generateJson<DigestOutput>({
      systemInstruction: DIGEST_SYSTEM_PROMPT,
      userContent: `Tiêu đề bài báo: ${title}\n\nNội dung:\n${rawText.slice(0, 8_000)}`,
      schema: DIGEST_SCHEMA,
      temperature: 0.4,
    });
  }

  async generateIceBreaker(keyword: string): Promise<string> {
    if (!this.isAvailable()) return '';

    try {
      const response = await this.generateContentWithRetry({
        model: GEMINI_MODEL,
        contents: `Dựa trên tin tức công nghệ hôm nay về: "${keyword}". Hãy tạo 1 câu "ice-breaker" tiếng Việt tự nhiên, ngầu, hợp để mở đầu buổi nói chuyện với anh em team R&D. Chỉ trả về 1 câu duy nhất, tối đa 30 từ.`,
        config: { systemInstruction: 'Bạn là L.H.T. Trả lời bằng tiếng Việt.', temperature: 0.8 },
      });
      return (response.text ?? '').trim();
    } catch (err) {
      console.warn('[L.H.T GEMINI] Không tạo được ice-breaker:', err instanceof Error ? err.message : err);
      return '';
    }
  }

  formatFinanceContext(finance: FinanceExpenseLimit | null): string {
    if (!finance) return 'Báo cáo tài chính hôm nay: không có dữ liệu.';

    return [
      'Báo cáo tài chính hôm nay:',
      `- Hạn mức chi tiêu: ${finance.dailyLimit.toLocaleString('vi-VN')} ${finance.currency}`,
      `- Đã chi: ${finance.spent.toLocaleString('vi-VN')} ${finance.currency}`,
      `- Còn lại: ${finance.remaining.toLocaleString('vi-VN')} ${finance.currency}`,
    ].join('\n');
  }

  async morningBriefing(newsContext: string): Promise<string> {
    const finance = await getTodayFinanceSummary();
    const financeContext = this.formatFinanceContext(finance);

    if (!this.isAvailable()) {
      return [
        '[L.H.T BẢN TIN SÁNG]',
        'Hệ thống đang ở chế độ dự phòng nội bộ.',
        newsContext,
        financeContext,
      ].join('\n');
    }

    try {
      const response = await this.generateContentWithRetry({
        model: GEMINI_MODEL,
        contents: `Tin tức công nghệ hôm nay:\n${newsContext}\n\n${financeContext}\n\nHãy chào Lâm Huệ Trung bằng giọng điệu L.H.T (ngầu, sci-fi), tóm tắt 1-2 tin nổi bật và nhắc nhở ngắn gọn tình hình tài chính hôm nay. Tiếng Việt, tối đa 5 câu.`,
        config: {
          systemInstruction:
            'Bạn là L.H.T, trợ lý AI cho Lâm Huệ Trung. Trả lời tiếng Việt, giọng điệu J.A.R.V.I.S.',
          temperature: 0.7,
        },
      });
      return (response.text ?? '').trim();
    } catch (err) {
      console.warn('[L.H.T GEMINI] Không tạo được bản tin sáng:', err instanceof Error ? err.message : err);
      return `${newsContext}\n\n${financeContext}`;
    }
  }

  async debateQuestion(context: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('GEMINI_API_KEY chưa được cấu hình.');
    }
    const response = await this.generateContentWithRetry({
      model: GEMINI_MODEL,
      contents: `Ngữ cảnh tin tức vừa học:\n${context}`,
      config: {
        systemInstruction: DEBATE_SYSTEM_PROMPT,
        temperature: 0.9,
        maxOutputTokens: 200,
      },
    });
    return (response.text ?? '').trim();
  }

  async scoreDebateAnswer(question: string, answer: string): Promise<DebateScoreOutput> {
    return this.generateJson<DebateScoreOutput>({
      systemInstruction: DEBATE_SCORE_SYSTEM_PROMPT,
      userContent: `Câu hỏi: ${question}\n\nCâu trả lời của Lâm Huệ Trung:\n${answer}`,
      schema: {
        type: 'OBJECT',
        properties: {
          score: { type: 'NUMBER' },
          feedback: { type: 'STRING' },
        },
        required: ['score', 'feedback'],
      },
    });
  }

  async meetingNote(rawText: string): Promise<MeetingNoteOutput> {
    return this.generateJson<MeetingNoteOutput>({
      systemInstruction: MEETING_NOTE_SYSTEM_PROMPT,
      userContent: `Biên bản cuộc họp (raw transcript):\n${rawText.slice(0, 20_000)}`,
      schema: MEETING_NOTE_SCHEMA,
    });
  }

  async skillGapAnalysis(userStack: string, jobRequirements: string): Promise<SkillGapOutput> {
    return this.generateJson<SkillGapOutput>({
      systemInstruction: SKILL_GAP_SYSTEM_PROMPT,
      userContent: `Tech stack hiện tại của Lâm Huệ Trung:\n${userStack}\n\nYêu cầu từ thị trường:\n${jobRequirements.slice(0, 10_000)}`,
      schema: SKILL_GAP_SCHEMA,
    });
  }

  async preferenceDiscovery(interactionLog: string): Promise<PreferencesOutput> {
    return this.generateJson<PreferencesOutput>({
      systemInstruction: PREFERENCES_SYSTEM_PROMPT,
      userContent: `Nhật ký tương tác của người dùng:\n${interactionLog.slice(0, 8_000)}`,
      schema: PREFERENCES_SCHEMA,
    });
  }

  async discoverGaps(conversationLog: string, interactionLog: string): Promise<KnowledgeGapOutput> {
    return this.generateJson<KnowledgeGapOutput>({
      systemInstruction: GAP_SYSTEM_PROMPT,
      userContent: `Nhật ký hội thoại:\n${conversationLog.slice(0, 12_000)}\n\nNhật ký tương tác:\n${interactionLog.slice(0, 6_000)}`,
      schema: GAP_SCHEMA,
      temperature: 0.4,
    });
  }

  async chatWithContext(userPrompt: string, context: string): Promise<string> {
    if (!this.isAvailable()) {
      return `[L.H.T HEURISTIC]: Nhận tín hiệu lệnh: "${userPrompt.trim()}". Hệ thống đang ở chế độ dự phòng nội bộ (thiếu GEMINI_API_KEY).`;
    }

    try {
      const response = await this.generateContentWithRetry({
        model: GEMINI_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: `${CHAT_SYSTEM_PROMPT}\n\n===== KIẾN THỨC L.H.T =====\n${context.slice(0, 9_000)}`,
          temperature: 0.7,
        },
      });
      return (response.text ?? '').trim();
    } catch (err) {
      console.error('[L.H.T GEMINI] Lỗi chat:', err instanceof Error ? err.message : err);
      throw err;
    }
  }
}

export const geminiService = new GeminiService();
