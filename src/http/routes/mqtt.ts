import { Router } from 'express';
import { publishState, isMqttConnected } from '../../services/mqtt.js';

export const mqttRouter = Router();

// POST /api/mqtt/state — publish trạng thái lên MQTT (IoT sync)
mqttRouter.post('/state', async (req, res) => {
  const body = req.body ?? {};
  const event = typeof body.event === 'string' && body.event.trim() ? body.event.trim() : 'GENERIC';
  const active = body.active === true || body.active === 'true';
  const data = body.data && typeof body.data === 'object' ? body.data : {};

  const published = await publishState({ event, active, data: data as Record<string, unknown> });
  res.json({
    published,
    connected: isMqttConnected(),
    event,
    active,
    note: published ? undefined : 'MQTT_URL chưa được cấu hình hoặc broker không kết nối.',
  });
});