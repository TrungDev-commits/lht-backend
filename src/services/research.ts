import { getResearchJobModel, type ResearchJob } from '../models/memory.js';
import { env } from '../config/env.js';

export interface ResearchJobResult {
  job: {
    id: string;
    query: string;
    status: ResearchJob['status'];
    created_at: Date;
    updated_at: Date;
    result?: ResearchJob['result'];
    knowledge_ids: string[];
    error?: string;
  };
  dispatched: boolean;
  reason: string;
}

async function dispatchGitHubAction(query: string, jobId: string): Promise<boolean> {
  if (!env.LHT_GH_TOKEN || !env.LHT_GH_REPO) return false;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.LHT_GH_REPO}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.LHT_GH_TOKEN}`,
          'User-Agent': 'LHT-Backend',
        },
        body: JSON.stringify({
          event_type: 'lht-collect',
          client_payload: {
            query,
            job_id: jobId,
            secret: env.RESEARCH_SECRET,
          },
        }),
      }
    );
    return response.ok;
  } catch (err) {
    console.error('[L.H.T RESEARCH] Dispatch GitHub Action lỗi:', err instanceof Error ? err.message : err);
    return false;
  }
}

function toResult(doc: ResearchJob & { _id: unknown }, dispatched: boolean, reason = ''): ResearchJobResult {
  return {
    job: {
      id: String(doc._id),
      query: doc.query,
      status: doc.status,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      result: doc.result,
      knowledge_ids: doc.knowledge_ids ?? [],
      error: doc.error,
    },
    dispatched,
    reason,
  };
}

export async function createResearchJob(query: string): Promise<ResearchJobResult> {
  const trimmed = query.trim().slice(0, 200);
  const job = await getResearchJobModel().create({ query: trimmed, status: 'queued' });

  const dispatched = await dispatchGitHubAction(trimmed, String(job._id));

  if (!dispatched) {
    await getResearchJobModel()
      .updateOne(
        { _id: job._id },
        { $set: { status: 'queued', updated_at: new Date(), error: 'GH Action không được dispatch (thiếu LHT_GH_TOKEN?) — job chờ chạy thủ công.' } }
      )
      .exec();
  } else {
    await getResearchJobModel()
      .updateOne(
        { _id: job._id },
        { $set: { status: 'running', updated_at: new Date() } }
      )
      .exec();
  }

  const updated = await getResearchJobModel().findById(job._id).lean().exec();
  const jobDoc = (updated ?? job) as ResearchJob & { _id: unknown };
  return toResult(
    jobDoc,
    dispatched,
    dispatched
      ? 'GitHub Action đang thu thập dữ liệu.'
      : 'Không dispatch được — hãy chạy workflow_collect thủ công hoặc cấu hình LHT_GH_TOKEN.'
  );
}

export async function getResearchJob(id: string): Promise<ResearchJobResult | null> {
  const job = await getResearchJobModel().findById(id).lean().exec();
  if (!job) return null;
  return toResult(job as ResearchJob & { _id: unknown }, true);
}

export async function completeResearchJob(
  id: string,
  payload: { collected: number; created: number; message: string; knowledge_ids: string[] }
): Promise<boolean> {
  const result = await getResearchJobModel()
    .updateOne(
      { _id: id },
      {
        $set: {
          status: 'done',
          result: {
            collected: payload.collected ?? 0,
            created: payload.created ?? 0,
            message: payload.message ?? '',
          },
          knowledge_ids: payload.knowledge_ids ?? [],
          updated_at: new Date(),
        },
      }
    )
    .exec();
  return result.modifiedCount > 0;
}

export async function failResearchJob(id: string, message: string): Promise<void> {
  await getResearchJobModel()
    .updateOne(
      { _id: id },
      { $set: { status: 'failed', error: message.slice(0, 300), updated_at: new Date() } }
    )
    .exec();
}

export async function hasRecentResearchJob(query: string, minutes = 15): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000);
  const job = await getResearchJobModel()
    .findOne({
      query,
      created_at: { $gte: since },
      status: { $in: ['queued', 'running'] },
    })
    .lean()
    .exec();
  return job !== null;
}