import { getKnowledgeModel, getConceptModel, getRelationModel } from '../models/knowledge.js';
import { getUserMemoryModel } from '../models/memory.js';
import { geminiService } from './gemini.js';
import { cosineSimilarity, getRelatedKnowledgeIds } from './knowledge.js';

export interface RetrievalHit {
  knowledge_id: string;
  title: string;
  summary_vn: string;
  web_dev_analogy: string;
  topic_tags: string[];
  score: number;
}

export interface RetrieveContext {
  interests?: Record<string, number>;
  days?: number;
  limit?: number;
}

const DEFAULT_TOPICS = ['Frontend', 'Backend', 'AI', 'System Design', 'DevOps', 'IoT'];

export async function getUserInterests(): Promise<Record<string, number>> {
  const memory = await getUserMemoryModel().findOne({ user_id: 'lam_huet_trung' }).lean().exec();
  if (memory?.interests) {
    return memory.interests;
  }
  return {
    Frontend: 82,
    Backend: 90,
    AI: 70,
    'System Design': 75,
    DevOps: 60,
    IoT: 45,
  };
}

function topicBoost(topic_tags: string[] | undefined, interests: Record<string, number>): number {
  if (!topic_tags || topic_tags.length === 0) return 1;
  let max = 1;
  for (const tag of topic_tags) {
    const weight = interests[tag];
    if (typeof weight === 'number') {
      max = Math.max(max, weight / 50);
    }
  }
  return max;
}

type KnowledgeCandidate = {
  _id: unknown;
  title: string;
  summary_vn: string;
  web_dev_analogy: string;
  topic_tags: string[];
  embedding: number[];
  created_at: Date;
};

export async function retrieveKnowledge(query: string, context?: RetrieveContext): Promise<RetrievalHit[]> {
  const interests = context?.interests ?? (await getUserInterests());
  const days = context?.days ?? 180;
  const limit = context?.limit ?? 6;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const queryEmbedding = await geminiService.embed(query);

  const baseFilter = { created_at: { $gte: since } };

  let keywordCandidates: KnowledgeCandidate[] = [];

  try {
    keywordCandidates = await getKnowledgeModel()
      .find({
        ...baseFilter,
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { topic_tags: { $regex: query, $options: 'i' } },
          { summary_vn: { $regex: query, $options: 'i' } },
        ],
      })
      .select({ title: 1, summary_vn: 1, web_dev_analogy: 1, topic_tags: 1, embedding: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(30)
      .lean()
      .exec();
  } catch {
    keywordCandidates = [];
  }

  let recentCandidates: KnowledgeCandidate[] = [];
  try {
    recentCandidates = await getKnowledgeModel()
      .find(baseFilter)
      .select({ title: 1, summary_vn: 1, web_dev_analogy: 1, topic_tags: 1, embedding: 1, created_at: 1 })
      .sort({ created_at: -1 })
      .limit(50)
      .lean()
      .exec();
  } catch {
    recentCandidates = [];
  }

  const merged = new Map<string, KnowledgeCandidate>();
  for (const item of [...keywordCandidates, ...recentCandidates]) {
    merged.set(String(item._id), item);
  }

  const now = Date.now();
  const recencyFactor = (createdAt: Date | undefined): number => {
    if (!createdAt) return 0.6;
    const ageDays = (now - new Date(createdAt).getTime()) / 86_400_000;
    return Math.max(0.3, 1 - ageDays / days);
  };

  const hits: RetrievalHit[] = [];
  for (const item of merged.values()) {
    const keywordScore = keywordCandidates.some((k) => String(k._id) === String(item._id)) ? 0.6 : 0;
    const semanticScore = queryEmbedding.length > 0 ? cosineSimilarity(queryEmbedding, item.embedding ?? []) : 0;
    const score =
      (keywordScore + semanticScore * 1.4) *
      topicBoost(item.topic_tags, interests) *
      recencyFactor(item.created_at);

    hits.push({
      knowledge_id: String(item._id),
      title: item.title,
      summary_vn: item.summary_vn,
      web_dev_analogy: item.web_dev_analogy,
      topic_tags: item.topic_tags ?? [],
      score,
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export async function expandWithGraph(hits: RetrievalHit[]): Promise<RetrievalHit[]> {
  const byId = new Map(hits.map((h) => [h.knowledge_id, h]));
  const extraIds = new Set<string>();

  for (const hit of hits) {
    const related = await getRelatedKnowledgeIds(hit.knowledge_id, 1);
    for (const id of related) {
      if (!byId.has(id) && !extraIds.has(id) && extraIds.size < 4) {
        extraIds.add(id);
      }
    }
  }

  if (extraIds.size === 0) return hits;

  const extra = await getKnowledgeModel()
    .find({ _id: { $in: Array.from(extraIds) } })
    .select({ title: 1, summary_vn: 1, web_dev_analogy: 1, topic_tags: 1 })
    .lean()
    .exec();

  const extraHits: RetrievalHit[] = extra.map((item) => ({
    knowledge_id: String(item._id),
    title: item.title,
    summary_vn: item.summary_vn,
    web_dev_analogy: item.web_dev_analogy,
    topic_tags: item.topic_tags ?? [],
    score: 0.3,
  }));

  return [...hits, ...extraHits];
}

export async function searchConcepts(query: string): Promise<{ name: string; category: string; desc: string }[]> {
  try {
    return getConceptModel()
      .find({ name: { $regex: query, $options: 'i' } })
      .select({ name: 1, category: 1, desc: 1 })
      .limit(10)
      .lean()
      .exec();
  } catch {
    return [];
  }
}

export async function getRelationTypes(): Promise<string[]> {
  try {
    return getRelationModel().distinct('relation_type').exec();
  } catch {
    return [];
  }
}

export { DEFAULT_TOPICS };