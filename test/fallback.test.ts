import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDegradedCognitive,
  toKeyword,
  extractLeadSentences,
  classifyCategory,
  countWords,
} from '../src/services/fallback.js';

const SAMPLE_RAW =
  'Đây là bài viết giới thiệu về bộ vi xử lý mới nhất từ nhà sản xuất. Con chip này được chế tạo trên tiến trình 3nm, hứa hẹn hiệu năng vượt trội so với thế hệ trước. Bên cạnh đó, mức tiêu thụ điện năng cũng được tối ưu đáng kể. Đội ngũ kỹ sư cho biết sẽ bắt đầu xuất xưởng trong quý sau.';

test('buildDegradedCognitive trả về đầy đủ shape CognitiveNewsOutput + icebreaker', () => {
  const out = buildDegradedCognitive({
    title: 'NVIDIA công bố chip AI mới cho trung tâm dữ liệu',
    rawText: SAMPLE_RAW,
    sourceName: 'TechCrunch',
    category: 'Tech',
  });

  assert.equal(typeof out.keyword, 'string');
  assert.equal(typeof out.audio_script, 'string');
  assert.equal(typeof out.web_dev_analogy, 'string');
  assert.equal(typeof out.icebreaker, 'string');
  assert.ok(Array.isArray(out.graph_data.nodes));
  assert.ok(Array.isArray(out.graph_data.edges));
  assert.ok(out.keyword.length > 0);
  assert.ok(out.audio_script.length > 0);
});

test('keyword viết hoa, tối đa 6 từ', () => {
  const out = buildDegradedCognitive({
    title: 'nvidia công bố chip ai mới nhất trong năm 2026 cho trung tâm',
    rawText: SAMPLE_RAW,
  });
  assert.equal(out.keyword, out.keyword.toUpperCase());
  assert.ok(countWords(out.keyword) <= 6, `keyword "${out.keyword}" vượt 6 từ`);
});

test('audio_script không quá 80 từ', () => {
  const longRaw = Array.from({ length: 30 }, (_, i) => `Câu số ${i + 1} mô tả chi tiết nội dung bài viết công nghệ mới nhất hôm nay.`).join(' ');
  const out = buildDegradedCognitive({
    title: 'Bài viết công nghệ dài',
    rawText: longRaw,
  });
  assert.ok(countWords(out.audio_script) <= 80, `audio_script có ${countWords(out.audio_script)} từ`);
});

test('audio_script nhắc keyword như phần mở đầu', () => {
  const out = buildDegradedCognitive({ title: 'RTX 5090 ra mắt', rawText: SAMPLE_RAW });
  assert.ok(out.audio_script.startsWith('Trong tin hôm nay:'));
});

test('graph có >= 3 node, mọi edge tham chiếu id tồn tại', () => {
  const out = buildDegradedCognitive({
    title: 'Chip AI mới',
    rawText: SAMPLE_RAW,
    sourceName: 'HackerNews',
  });
  assert.ok(out.graph_data.nodes.length >= 3);
  const ids = new Set(out.graph_data.nodes.map((n) => n.id));
  for (const edge of out.graph_data.edges) {
    assert.ok(ids.has(edge.source), `edge source "${edge.source}" không tồn tại`);
    assert.ok(ids.has(edge.target), `edge target "${edge.target}" không tồn tại`);
  }
});

test('deterministic: cùng input trả cùng output', () => {
  const input = { title: 'iPhone mới pin tốt hơn', rawText: SAMPLE_RAW, sourceName: 'VNExpress', category: 'VN Tech' };
  const a = buildDegradedCognitive(input);
  const b = buildDegradedCognitive(input);
  assert.deepEqual(a, b);
});

test('web_dev_analogy có nhắc keyword và không rỗng', () => {
  const out = buildDegradedCognitive({ title: 'RAM DDR5 mới', rawText: SAMPLE_RAW });
  assert.ok(out.web_dev_analogy.includes('RAM DDR5 MỚI'));
  assert.ok(out.icebreaker.length > 0);
});

test('toKeyword: làm sạch, viết hoa, cắt đuôi dấu câu', () => {
  assert.equal(toKeyword('  Hello world,  '), 'HELLO WORLD');
  assert.equal(toKeyword('Một hai ba bốn năm sáu bảy tám'), 'MỘT HAI BA BỐN NĂM SÁU');
});

test('extractLeadSentences: giới hạn từ, bỏ câu quá ngắn, cắt câu vượt hạn', () => {
  const text = [
    'Đây là câu đầu tiên.',
    'Ngắn.',
    'Câu thứ ba dài hơn một chút và đủ ý nghĩa.',
    'Câu bốn bị cắt vì vượt giới hạn từ tối đa.',
  ].join(' ');
  const lead = extractLeadSentences(text, 16);
  assert.ok(countWords(lead) <= 16);
  assert.ok(lead.includes('Câu thứ ba'));
  assert.ok(!lead.includes('Ngắn'), 'câu quá ngắn phải bị bỏ');
  assert.ok(!lead.includes('Câu bốn'), 'câu vượt hạn từ phải bị cắt');
});

test('classifyCategory: phần cứng -> HARDWARE, còn lại -> SOFTWARE', () => {
  assert.equal(classifyCategory('chip AI mới'), 'HARDWARE');
  assert.equal(classifyCategory('card đồ họa rời'), 'HARDWARE');
  assert.equal(classifyCategory('tutorial react hook'), 'SOFTWARE');
});
