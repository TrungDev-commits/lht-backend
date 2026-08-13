import { Router } from 'express';
import { queryAI } from '../../services/query.js';

export const queryRouter = Router();

// POST /api/lht/query — chat với Gemini (RAG). Chấp nhận cả `prompt` và `query`.
queryRouter.post('/', async (req, res) => {
  const body = req.body ?? {};
  const prompt =
    typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt.trim()
      : typeof body.query === 'string'
        ? body.query.trim()
        : '';

  if (!prompt) {
    res.status(400).json({ error: 'Thiếu tham số prompt' });
    return;
  }

  const result = await queryAI({ prompt, mode: body.mode });
  if (typeof body.session_id === 'string' && body.session_id) {
    res.json({ ...result, session_id: body.session_id });
    return;
  }
  res.json(result);
});