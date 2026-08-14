// Deep fallback module: chế biến bài báo thành thẻ kiến thức hợp lệ khi AI hết quota.
//
// Small interface: buildDegradedCognitive(input) -> FallbackCognitive.
// Implementation hides: trích xuất câu dẫn, tạo keyword, ẩn dụ template,
// graph heuristic, icebreaker template — thuần hàm, deterministic, không cần network.

import type { CognitiveNewsOutput, GraphData, GraphNode, GraphEdge } from './gemini.js';

export interface FallbackInput {
  title: string;
  rawText: string;
  sourceName?: string;
  category?: string;
}

export interface FallbackCognitive extends CognitiveNewsOutput {
  icebreaker: string;
}

const MAX_KEYWORD_WORDS = 6;
const MAX_SCRIPT_WORDS = 80;

const HARDWARE_HINTS = [
  'chip', 'cpu', 'gpu', 'ram', 'ssd', 'card', 'mainboard', 'bộ nhớ', 'ổ cứng',
  'điện thoại', 'laptop', 'pin', 'màn hình', 'vi xử lý', 'npu', 'rtx', 'ryzen',
  'snapdragon', 'iphone', 'macbook', 'máy tính', 'ổ đĩa', 'tản nhiệt', 'card đồ họa',
];

const ANALOGY_TEMPLATES = [
  (k: string) =>
    `Hãy tưởng tượng "${k}" như một service phía backend: muốn cả hệ thống chạy mượt, service đó phải ổn định và được giám sát chặt chẽ.`,
  (k: string) =>
    `Cũng như "${k}" trong phần cứng, một endpoint web backend phải tối ưu latency — nếu không, toàn bộ trải nghiệm người dùng sẽ nghẽn lại.`,
  (k: string) =>
    `"${k}" giống như một middleware: nằm giữa hai hệ thống, xử lý tốt thì dữ liệu chảy thông suốt.`,
  (k: string) =>
    `Xem "${k}" như một dependency trong Node.js: version mới bảo mật hơn, version cũ tiềm ẩn lỗi — quản lý nó là cả một nghệ thuật.`,
];

const ICEBREAKER_TEMPLATES = [
  (k: string) => `Hôm nay team R&D mình được món mới: "${k}". Mai mốt đem ra chém gió cho nóng nhé!`,
  (k: string) => `Nóng hổi này — "${k}" vừa được cập nhật. Anh em rảnh thì xem để tối có tài liệu nói chuyện.`,
  (k: string) => `Cập nhật nhanh: "${k}". Đây chính là chủ đề hot để mở đầu buổi họp R&D tiếp theo.`,
];

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Rút keyword từ tiêu đề: làm sạch, viết hoa, tối đa 6 từ. */
export function toKeyword(title: string): string {
  const cleaned = title.trim().replace(/\s+/g, ' ').replace(/[.,;:!?"'()[\]{}<>]+$/g, '');
  const words = cleaned.split(' ').filter(Boolean);
  return words.slice(0, MAX_KEYWORD_WORDS).join(' ').toUpperCase();
}

/** Trích 1-3 câu dẫn đầu bài viết, giới hạn số từ. */
export function extractLeadSentences(text: string, maxWords: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const picked: string[] = [];
  let words = 0;
  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (sentenceWords < 3) continue;
    if (words + sentenceWords > maxWords) break;
    picked.push(sentence);
    words += sentenceWords;
  }
  return picked.join(' ').trim();
}

/** Phân loại chủ đề vào HARDWARE / SOFTWARE dựa trên từ khoá phần cứng. */
export function classifyCategory(text: string): 'HARDWARE' | 'SOFTWARE' {
  const lower = text.toLowerCase();
  return HARDWARE_HINTS.some((hint) => lower.includes(hint)) ? 'HARDWARE' : 'SOFTWARE';
}

function buildAudioScript(keyword: string, rawText: string): string {
  const intro = `Trong tin hôm nay: ${keyword}.`;
  const lead = extractLeadSentences(rawText, MAX_SCRIPT_WORDS - countWords(intro));
  if (!lead) return `${intro} Nội dung bài viết đang được cập nhật.`;
  return `${intro} ${lead}`;
}

function buildGraph(keyword: string, sourceName: string | undefined, categoryHint: string): GraphData {
  const keywordCategory = classifyCategory(`${keyword} ${categoryHint}`);

  const nodes: GraphNode[] = [
    { id: 'k', label: keyword, category: keywordCategory, desc: 'Chủ đề chính của bài viết' },
    { id: 'web', label: 'Web Backend', category: 'SOFTWARE', desc: 'Hệ sinh thái so sánh' },
    { id: 'kb', label: 'Kiến thức L.H.T', category: 'SOFTWARE', desc: 'Kho kiến thức hệ thống' },
  ];
  if (sourceName) {
    nodes.push({ id: 'src', label: sourceName.slice(0, 24), category: 'SOFTWARE', desc: 'Nguồn tin' });
  }

  const edges: GraphEdge[] = [
    { source: 'k', target: 'web', relation: 'analogy_of' },
    { source: 'k', target: 'kb', relation: 'related_to' },
  ];
  if (sourceName) {
    edges.push({ source: 'src', target: 'web', relation: 'related_to' });
  }

  return { nodes, edges };
}

function pickTemplate<T>(templates: Array<(k: string) => T>, keyword: string): (k: string) => T {
  return templates[hashOf(keyword) % templates.length]!;
}

/** Chế biến bài báo thành thẻ kiến thức hợp lệ (chất lượng thấp) khi AI không khả dụng. */
export function buildDegradedCognitive(input: FallbackInput): FallbackCognitive {
  const keyword = toKeyword(input.title) || 'BẢN TIN CÔNG NGHỆ';

  const analogy = pickTemplate(ANALOGY_TEMPLATES, keyword)(keyword);
  const icebreaker = pickTemplate(ICEBREAKER_TEMPLATES, keyword)(keyword);

  return {
    keyword,
    audio_script: buildAudioScript(keyword, input.rawText),
    web_dev_analogy: analogy,
    graph_data: buildGraph(keyword, input.sourceName, input.category ?? ''),
    icebreaker,
  };
}
