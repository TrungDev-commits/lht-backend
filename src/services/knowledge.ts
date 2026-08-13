import { createHash } from 'node:crypto';
import { getKnowledgeModel, getConceptModel, getRelationModel } from '../models/knowledge.js';
import { geminiService, type DigestOutput } from './gemini.js';
import { runGarbageCollection } from './scraper.js';

export interface DigestSource {
  url: string;
  source_name: string;
  published_at?: Date;
}

export interface DigestResult {
  created: boolean;
  knowledgeId?: string;
  title?: string;
  reason?: 'created' | 'duplicate' | 'error';
}

export function hashSource(url: string, title: string): string {
  return createHash('sha256').update(`${title.trim().toLowerCase()}|${url.trim()}`).digest('hex');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizeConceptId(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

async function upsertConceptsAndRelations(digest: DigestOutput, knowledgeId: string): Promise<void> {
  const nodes = digest.graph_data?.nodes ?? [];
  for (const node of nodes) {
    const conceptId = normalizeConceptId(node.label);
    if (!conceptId) continue;

    await getConceptModel()
      .updateOne(
        { name: node.label },
        {
          $setOnInsert: {
            category: node.category,
            desc: node.desc ?? '',
          },
          $addToSet: { knowledge_ids: knowledgeId },
        },
        { upsert: true }
      )
      .exec();

    try {
      await getConceptModel()
        .updateOne(
          { name: node.label },
          { $addToSet: { knowledge_ids: knowledgeId } },
          { upsert: false }
        )
        .exec();
    } catch {
      // Bỏ qua lỗi trùng lặp alias.
    }
  }

  const edges = digest.graph_data?.edges ?? [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await getRelationModel()
        .updateOne(
          { source: edge.source, target: edge.target },
          { $setOnInsert: { relation_type: 'related_to', created_at: new Date() } },
          { upsert: true }
        )
        .exec();
    } catch {
      // Duplicate key — bỏ qua.
    }
  }
}

export async function digestAndStore(input: {
  rawText: string;
  title: string;
  source: DigestSource;
}): Promise<DigestResult> {
  const { rawText, title, source } = input;
  const sourceHash = hashSource(source.url, title);

  const existing = await getKnowledgeModel().findOne({ source_hash: sourceHash }).lean().exec();
  if (existing) {
    return { created: false, reason: 'duplicate' };
  }

  try {
    const digest = await geminiService.digestArticle(rawText, title);
    if (!digest.title || !digest.summary_vn) {
      return { created: false, reason: 'error' };
    }

    const embeddingText = `${digest.title}. ${digest.summary_vn}. ${digest.web_dev_analogy}`;
    const [embedding, icebreaker] = await Promise.all([
      geminiService.embed(embeddingText),
      digest.icebreaker
        ? Promise.resolve(digest.icebreaker)
        : geminiService.generateIceBreaker(digest.title),
    ]);

    const knowledge = await getKnowledgeModel().create({
      source_hash: sourceHash,
      title: digest.title,
      topic_tags: digest.topic_tags ?? [],
      summary_vn: digest.summary_vn,
      audio_script: digest.audio_script ?? '',
      web_dev_analogy: digest.web_dev_analogy ?? '',
      icebreaker,
      graph_data: digest.graph_data ?? { nodes: [], edges: [] },
      embedding,
      source_refs: [{ url: source.url, source_name: source.source_name, published_at: source.published_at }],
      quality_score: 0.6,
      created_at: new Date(),
    });

    await upsertConceptsAndRelations(digest, String(knowledge._id));

    return {
      created: true,
      knowledgeId: String(knowledge._id),
      title: digest.title,
      reason: 'created',
    };
  } catch (err) {
    console.warn('[L.H.T KNOWLEDGE] Digest thất bại:', err instanceof Error ? err.message : err);
    return { created: false, reason: 'error' };
  } finally {
    runGarbageCollection();
  }
}

export async function getKnowledgeByIds(ids: string[]): Promise<
  { _id: string; title: string; summary_vn: string; web_dev_analogy: string; topic_tags: string[] }[]
> {
  if (ids.length === 0) return [];
  const docs = await getKnowledgeModel()
    .find({ _id: { $in: ids } })
    .select({ title: 1, summary_vn: 1, web_dev_analogy: 1, topic_tags: 1 })
    .lean()
    .exec();
  return docs.map((d) => ({
    _id: String(d._id),
    title: d.title,
    summary_vn: d.summary_vn,
    web_dev_analogy: d.web_dev_analogy,
    topic_tags: d.topic_tags ?? [],
  }));
}

export async function getRelatedKnowledgeIds(knowledgeId: string, depth = 1): Promise<string[]> {
  const visited = new Set<string>([knowledgeId]);
  let frontier = [knowledgeId];

  for (let d = 0; d < depth; d++) {
    const relations = await getRelationModel()
      .find({
        $or: [
          { source: { $in: frontier } },
          { target: { $in: frontier } },
        ],
      })
      .select({ source: 1, target: 1 })
      .lean()
      .exec();

    const neighbors: string[] = [];
    for (const rel of relations) {
      if (!visited.has(rel.source)) neighbors.push(rel.source);
      if (!visited.has(rel.target)) neighbors.push(rel.target);
    }

    const next: string[] = [];
    const concepts = await getConceptModel()
      .find({ name: { $in: [...new Set(neighbors)] } })
      .select({ knowledge_ids: 1 })
      .lean()
      .exec();

    for (const concept of concepts) {
      for (const kid of concept.knowledge_ids ?? []) {
        if (!visited.has(kid) && kid !== knowledgeId) {
          visited.add(kid);
          next.push(kid);
        }
      }
    }

    frontier = next;
  }

  visited.delete(knowledgeId);
  return Array.from(visited).slice(0, 8);
}