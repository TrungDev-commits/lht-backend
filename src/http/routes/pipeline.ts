import { Router } from 'express';
import { knowledgePipeline } from '../../services/pipeline.js';
import { env } from '../../config/env.js';

export const pipelineRouter = Router();

// POST /api/pipeline/run — kích hoạt pipeline tin tức thủ công (bảo vệ bằng PIPELINE_SECRET)
pipelineRouter.post('/run', async (req, res) => {
  const secret =
    (req.headers['x-lht-pipeline-secret'] as string | undefined) ??
    (req.body?.secret as string | undefined);

  if (env.PIPELINE_SECRET && secret !== env.PIPELINE_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized: Sai bí mật X-LHT-Pipeline-Secret.' });
    return;
  }

  const body = req.body ?? {};
  try {
    const result = await knowledgePipeline.run({
      rssUrl: typeof body.rssUrl === 'string' && body.rssUrl.trim() ? body.rssUrl.trim() : undefined,
      limitPerSource: typeof body.limit === 'number' ? body.limit : undefined,
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Pipeline gặp lỗi không xác định.',
    });
  }
});