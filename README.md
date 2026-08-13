# L.H.T Backend

> Backend Express 5 + TypeScript + MongoDB cho **L.H.T — Logical Heuristic Terminal** (trợ lý AI cá nhân của Lâm Huệ Trung). Được tách từ monorepo cũ (trước đây là Netlify Functions) và chạy trên **Render**.

## Tính năng

- **Deep module qua seam dữ liệu**: mọi connection MongoDB nằm trong 1 module (`src/db/connections.ts`) — 1 connection gốc tới cluster, `useDb()` cho 4 workspace (news/kb/chat/memory) trên **chung 1 socket pool** (tiết kiệm RAM trên Render 512MB).
- **Model bind LAZY** qua `getModel()` (gọi lúc query, không phải lúc import) — sửa bug kinh điển: model compile vào connection mặc định chưa connect → query buffer → timeout (nguyên nhân 502 trên Netlify cũ).
- **Fail-fast**: `mongoose.set('bufferCommands', false)` — nếu DB không kết nối, API trả lỗi ngay thay vì treo.
- AI Gemini (`@google/genai`) — chat, debate, meeting-note, pipeline tóm tắt tin.
- Scraper RSS (Axios + Cheerio, không Puppeteer — tiết kiệm RAM), dedup theo `title_hash`.
- Scheduler cron pipeline tin tức **00:00 Asia/Ho_Chi_Minh** (chỉ chạy khi `NODE_ENV=production`).
- Endpoint kích hoạt pipeline thủ công `/api/pipeline/run` (bảo vệ bằng `X-LHT-Pipeline-Secret`).

## Cấu trúc

```
src/
├── config/       # env, nguồn RSS, DB tài chính
├── db/
│   └── connections.ts   # SEAM dữ liệu: getConnection + getModel (lazy) + useDb
├── models/       # schema + lazy getter model (news, knowledge, memory, chat)
├── services/     # deep modules: gemini, scraper, news, pipeline, rag, knowledge, chat, query, mqtt, tts, research
├── http/
│   ├── app.ts    # Express app (CORS, JSON 64kb, 404 + error middleware)
│   └── routes/   # adapter mỏng: health, news, query, ai, mqtt, pipeline, research
├── cron/
│   └── scheduler.ts
└── index.ts      # bootstrap: connectAll → finance → scheduler → listen + graceful shutdown
```

## Cài đặt & chạy local

```bash
npm install
cp .env.example .env   # điền MONGODB_URI, GEMINI_API_KEY...
npm run dev            # tsx watch
```

Build & chạy production:

```bash
npm run typecheck
npm run build
node --expose-gc --max-old-space-size=384 dist/index.js
```

## API

| Method | Endpoint | Mô tả |
| --- | --- | --- |
| GET | `/api/health` | Trạng thái server, DB, AI, MQTT, RAM |
| GET | `/api/news` | Danh sách tin (filter `keyword`, pagination `limit`/`skip`) |
| GET | `/api/news/today` | Tin từ đầu ngày (sort desc) |
| GET | `/api/news/:id` | Chi tiết 1 tin |
| POST | `/api/news` | Tạo tin thủ công |
| PUT/DELETE | `/api/news/:id` | Sửa / xóa tin |
| POST | `/api/lht/query` | Chat Gemini — chấp nhận `{ prompt }` hoặc `{ query }` |
| POST | `/api/ai/debate` | (không `answer`) tạo câu hỏi thách thức / (có `answer`) chấm điểm |
| POST | `/api/ai/meeting-note` | Trích xuất biên bản họp từ `{ transcript }` |
| POST | `/api/mqtt/state` | Publish trạng thái IoT lên MQTT |
| POST | `/api/pipeline/run` | Chạy pipeline tin tức (cần `X-LHT-Pipeline-Secret`) |
| POST | `/api/research/jobs` | Tạo job nghiên cứu |
| GET | `/api/research/jobs/:id` | Xem kết quả job nghiên cứu |

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
| --- | --- | --- |
| `MONGODB_URI` | ✅ | Chuỗi kết nối MongoDB chính |
| `NEWS_DB` / `KNOWLEDGE_DB` / `CHAT_DB` / `MEMORY_DB` | ✳️ | Tên 4 database workspace (có default) |
| `GEMINI_API_KEY` | ⚠️ | Kích hoạt AI thật |
| `NEWS_RSS_URL` | ⚠️ | Nguồn RSS cho pipeline |
| `FINANCE_DB_URI` | Tùy chọn | DB riêng `LHT-finance` (bản tin sáng) |
| `MQTT_URL` | Tùy chọn | Broker MQTT |
| `PORT` | Tùy chọn | Render inject tự động |
| `PIPELINE_SECRET` | Tùy chọn | Bảo vệ `/api/pipeline/run` |
| `NODE_ENV` | Tùy chọn | `production` mới bật cron |

## Deploy — Render

Repo đi kèm `render.yaml` (Blueprint) + `.github/workflows/deploy.yml`:

1. Tạo **Web Service** mới trên Render (Free/Starter, Node, vùng Singapore nếu muốn).
2. Build: `npm ci && npm run build` — Start: `node --expose-gc --max-old-space-size=384 dist/index.js`. Hoặc dùng Blueprint `render.yaml`.
3. Đặt env (mục trên); `render.yaml` có `sync: false` cho các biến để bạn nhập tay.
4. Tạo **Deploy Hook** trong Render (Settings → Deploy Hook) → lưu URL vào GitHub secret `RENDER_DEPLOY_HOOK_URL`.
5. Push lên `main` → GitHub Actions build + typecheck + gọi deploy hook.

> Cron pipeline chạy 00:00 `Asia/Ho_Chi_Minh` trên Render service (không cần GitHub Action lịch nữa).
