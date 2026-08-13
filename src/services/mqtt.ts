import mqtt, { type MqttClient } from 'mqtt';
import { env } from '../config/env.js';

export interface MqttPublishPayload {
  topic: string;
  payload: unknown;
  qos?: 0 | 1 | 2;
}

let client: MqttClient | null = null;
let connecting = false;

function getClient(): MqttClient | null {
  if (client) return client;
  if (!env.MQTT_URL) return null;
  if (connecting) return null;

  connecting = true;
  try {
    client = mqtt.connect(env.MQTT_URL, {
      keepalive: 30,
      connectTimeout: 10_000,
      reconnectPeriod: 30_000,
      clean: true,
      clientId: `lht-terminal-${Math.random().toString(16).slice(2, 10)}`,
    });

    client.on('connect', () => {
      console.log(`[L.H.T MQTT] Kết nối thành công tới ${env.MQTT_URL}`);
    });

    client.on('error', (err) => {
      console.warn('[L.H.T MQTT] Lỗi client:', err.message);
    });

    client.on('close', () => {
      console.warn('[L.H.T MQTT] Kết nối đã đóng.');
    });

    return client;
  } finally {
    connecting = false;
  }
}

export async function publishMqtt(publish: MqttPublishPayload): Promise<boolean> {
  const mqttClient = getClient();
  if (!mqttClient || mqttClient.connected === false) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    mqttClient.publish(
      publish.topic,
      JSON.stringify(publish.payload),
      { qos: publish.qos ?? 1, retain: true },
      (err) => resolve(!err)
    );
  });
}

export async function publishXRayState(active: boolean): Promise<boolean> {
  return publishMqtt({
    topic: 'lht/desktop/sync',
    payload: {
      source: 'lht-mobile',
      event: 'XRAY_MODE',
      active,
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
  });
}

export async function publishState(payload: {
  event: string;
  active: boolean;
  data?: Record<string, unknown>;
}): Promise<boolean> {
  return publishMqtt({
    topic: 'lht/desktop/sync',
    payload: {
      source: 'lht-mobile',
      event: payload.event,
      active: payload.active,
      ...(payload.data ?? {}),
      timestamp: new Date().toISOString(),
    },
  });
}

export function closeMqtt(): void {
  if (client) {
    client.end(true);
    client = null;
  }
}

export function isMqttConnected(): boolean {
  return client?.connected === true;
}