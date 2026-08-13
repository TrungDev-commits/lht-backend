import { Router } from 'express';
import { isConnected } from '../../db/connections.js';
import { geminiService } from '../../services/gemini.js';
import { isMqttConnected } from '../../services/mqtt.js';
import { env } from '../../config/env.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    db: {
      news: isConnected('news'),
      kb: isConnected('kb'),
      chat: isConnected('chat'),
      memory: isConnected('memory'),
    },
    ai: { available: geminiService.isAvailable(), model: env.GEMINI_MODEL },
    mqtt: { connected: isMqttConnected(), configured: Boolean(env.MQTT_URL) },
    ram: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});