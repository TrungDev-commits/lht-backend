import { Router } from 'express';
import { newsService } from '../../services/news.js';

export const newsRouter = Router();

// 1. GET /api/news/today
newsRouter.get('/today', async (_req, res) => {
  res.json(await newsService.getToday());
});

// 2. POST /api/news/signals
newsRouter.post('/signals', async (req, res) => {
  const body = req.body ?? {};
  const signals = Array.isArray(body.signals) ? body.signals : [];
  const saved = await newsService.recordSignals(signals);
  if (saved === 0) {
    res.status(400).json({ error: 'Thiếu signals hợp lệ' });
    return;
  }
  res.json({ saved });
});

// 3. GET /api/news/:id
newsRouter.get('/:id', async (req, res) => {
  const item = await newsService.getById(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Không tìm thấy tin tức' });
    return;
  }
  res.json(item);
});

// 4. PUT /api/news/:id
newsRouter.put('/:id', async (req, res) => {
  const item = await newsService.update(req.params.id, (req.body ?? {}) as Record<string, unknown>);
  if (!item) {
    res.status(404).json({ error: 'Không tìm thấy tin tức' });
    return;
  }
  res.json(item);
});

// 5. DELETE /api/news/:id
newsRouter.delete('/:id', async (req, res) => {
  const item = await newsService.remove(req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Không tìm thấy tin tức' });
    return;
  }
  res.json({ deleted: true, id: req.params.id });
});

// 6. GET /api/news (List with pagination)
newsRouter.get('/', async (req, res) => {
  const q = req.query ?? {};
  res.json(
    await newsService.list({
      keyword: typeof q.keyword === 'string' ? q.keyword : '',
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      skip: typeof q.skip === 'string' ? Number(q.skip) : undefined,
    })
  );
});

// 7. POST /api/news (Create)
newsRouter.post('/', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const item = await newsService.create({
    source_url: String(body.source_url ?? ''),
    keyword: String(body.keyword ?? ''),
    audio_script: typeof body.audio_script === 'string' ? body.audio_script : undefined,
    web_dev_analogy: typeof body.web_dev_analogy === 'string' ? body.web_dev_analogy : undefined,
    graph_data: body.graph_data,
    icebreaker: typeof body.icebreaker === 'string' ? body.icebreaker : undefined,
  });
  res.status(201).json(item);
});