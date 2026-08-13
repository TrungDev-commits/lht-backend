import { env } from './config/env.js';
import { connectAll, disconnectAll } from './db/connections.js';
import { connectFinanceDatabase, disconnectFinanceDatabase } from './config/finance.js';
import { closeMqtt } from './services/mqtt.js';
import { createApp } from './http/app.js';
import { startScheduler } from './cron/scheduler.js';

async function main(): Promise<void> {
  await connectAll();
  await connectFinanceDatabase();
  startScheduler();

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`[L.H.T] Server chạy tại http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[L.H.T] Nhận ${signal}, đang tắt...`);
    server.close();
    closeMqtt();
    await disconnectAll();
    await disconnectFinanceDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[L.H.T] Khởi động thất bại:', err);
  process.exit(1);
});