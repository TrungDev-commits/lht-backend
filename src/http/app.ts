import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { newsRouter } from './routes/news.js';
import { queryRouter } from './routes/query.js';
import { aiRouter } from './routes/ai.js';
import { mqttRouter } from './routes/mqtt.js';
import { pipelineRouter } from './routes/pipeline.js';
import { researchRouter } from './routes/research.js';

export function createApp(): express.Express {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/news', newsRouter);
  app.use('/api/lht/query', queryRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/mqtt', mqttRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/research', researchRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Không tìm thấy API tương ứng' });
  });

  // Express 5 tự chuyển promise rejection từ route async lên đây.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[L.H.T API] Lỗi xử lý request:', err);
      res.status(500).json({
        error: 'Lỗi máy chủ',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  );

  return app;
}