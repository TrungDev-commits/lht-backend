import { Router } from 'express';
import {
  createResearchJob,
  getResearchJob,
  completeResearchJob,
  failResearchJob,
  hasRecentResearchJob,
} from '../../services/research.js';
import { env, normalizeSecret } from '../../config/env.js';

export const researchRouter = Router();

// POST /api/research/jobs — tạo job nghiên cứu
researchRouter.post('/jobs', async (req, res) => {
  const body = req.body ?? {};
  const query = typeof body.query === 'string' ? body.query.trim() : '';

  if (!query) {
    res.status(400).json({ error: 'Thiếu tham số query' });
    return;
  }

  if (await hasRecentResearchJob(query)) {
    res.status(429).json({ error: 'Đã có job nghiên cứu gần đây cho câu hỏi này.' });
    return;
  }

  res.status(201).json(await createResearchJob(query));
});

// GET /api/research/jobs/:id
researchRouter.get('/jobs/:id', async (req, res) => {
  const job = await getResearchJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Không tìm thấy job nghiên cứu' });
    return;
  }
  res.json(job);
});

// POST /api/research/jobs/:id/complete — GH Action gọi về khi xong
researchRouter.post('/jobs/:id/complete', async (req, res) => {
  const secret = normalizeSecret(req.headers['x-lht-research-secret'] as string | undefined);
  if (env.RESEARCH_SECRET && secret !== env.RESEARCH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  const ok = await completeResearchJob(req.params.id, {
    collected: Number(body.collected) || 0,
    created: Number(body.created) || 0,
    message: typeof body.message === 'string' ? body.message : '',
    knowledge_ids: Array.isArray(body.knowledge_ids) ? body.knowledge_ids : [],
  });
  res.json({ ok });
});

// POST /api/research/jobs/:id/fail
researchRouter.post('/jobs/:id/fail', async (req, res) => {
  const secret = normalizeSecret(req.headers['x-lht-research-secret'] as string | undefined);
  if (env.RESEARCH_SECRET && secret !== env.RESEARCH_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body ?? {};
  await failResearchJob(req.params.id, typeof body.message === 'string' ? body.message : 'Lỗi không xác định');
  res.json({ ok: true });
});