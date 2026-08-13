import { Router } from 'express';
import { geminiService } from '../../services/gemini.js';

export const aiRouter = Router();

aiRouter.use((_req, res, next) => {
  if (!geminiService.isAvailable()) {
    res.status(503).json({ error: 'GEMINI_API_KEY chưa được cấu hình' });
    return;
  }
  next();
});

// POST /api/ai/debate — (không `answer`) tạo câu hỏi; (có `answer`) chấm điểm
aiRouter.post('/debate', async (req, res) => {
  const body = req.body ?? {};
  const context = typeof body.context === 'string' ? body.context.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';

  if (!context) {
    res.status(400).json({ error: 'Thiếu ngữ cảnh tin tức (context)' });
    return;
  }

  if (!answer) {
    const question = await geminiService.debateQuestion(context.slice(0, 4_000));
    res.json({ stage: 'QUESTION', question });
    return;
  }

  const evaluation = await geminiService.scoreDebateAnswer(context.slice(0, 4_000), answer);
  res.json({ stage: 'SCORE', ...evaluation });
});

// POST /api/ai/meeting-note — trích xuất biên bản cuộc họp
aiRouter.post('/meeting-note', async (req, res) => {
  const body = req.body ?? {};
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';

  if (!transcript) {
    res.status(400).json({ error: 'Thiếu nội dung cuộc họp (transcript)' });
    return;
  }

  const note = await geminiService.meetingNote(transcript);
  res.json(note);
});