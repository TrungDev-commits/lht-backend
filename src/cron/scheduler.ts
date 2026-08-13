import cron from 'node-cron';
import { env } from '../config/env.js';
import { knowledgePipeline } from '../services/pipeline.js';

export function startScheduler(): void {
  if (env.NODE_ENV !== 'production') {
    console.log('[L.H.T CRON] Bỏ qua scheduler (chỉ chạy trong production).');
    return;
  }

  // Pipeline tin tức 00:00 hằng ngày
  cron.schedule(
    '0 0 * * *',
    () => {
      console.log('[L.H.T CRON] Bắt đầu pipeline tin tức 00:00...');
      knowledgePipeline
        .run()
        .then((result) => console.log('[L.H.T CRON] Pipeline xong:', result))
        .catch((err) => console.error('[L.H.T CRON] Pipeline lỗi:', err instanceof Error ? err.message : err));
    },
    { timezone: 'Asia/Ho_Chi_Minh' }
  );

  console.log('[L.H.T CRON] Scheduler đã khởi động (pipeline 00:00 hằng ngày).');
}