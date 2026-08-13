import mongoose, { type Connection, type Model, type Schema } from 'mongoose';
import { env } from '../config/env.js';

mongoose.set('bufferCommands', false);

/**
 * Seam dữ liệu của L.H.T: sở hữu toàn bộ connection MongoDB.
 *
 * Sử dụng MỘT connection gốc tới cluster rồi `useDb()` cho từng workspace
 * (news/kb/chat/memory) — chia sẻ chung một socket pool, tiết kiệm RAM trên
 * Render 512MB và giảm số kết nối lên Atlas.
 *
 * Model được bind LAZY vào đúng connection workspace thông qua `getModel()`
 * (gọi tại lúc query, không phải lúc import module). Điều này tránh bug kinh
 * điển: model compile vào connection mặc định chưa từng connect -> query bị
 * buffer -> timeout (nguyên nhân gây 502 trên Netlify cũ).
 */

export type DbWorkspace = 'news' | 'kb' | 'chat' | 'memory';

const WORKSPACE_DB: Record<DbWorkspace, string> = {
  news: env.NEWS_DB,
  kb: env.KNOWLEDGE_DB,
  chat: env.CHAT_DB,
  memory: env.MEMORY_DB,
};

const CONN_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  maxPoolSize: 5,
  minPoolSize: 0,
};

let base: Connection | null = null;
const workspaceConns = new Map<DbWorkspace, Connection>();

export function isConnected(workspace: DbWorkspace): boolean {
  return workspaceConns.get(workspace)?.readyState === 1;
}

export function getConnection(workspace: DbWorkspace): Connection | null {
  const conn = workspaceConns.get(workspace);
  return conn && conn.readyState === 1 ? conn : null;
}

export function getModel<T>(
  workspace: DbWorkspace,
  name: string,
  schema: Schema,
  collection?: string
): Model<T> {
  const conn = getConnection(workspace);
  if (conn) {
    return (conn.models[name] as Model<T> | undefined) ?? conn.model<T>(name, schema as any, collection);
  }
  return (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema as any, collection);
}

export async function connectAll(): Promise<void> {
  if (!env.MONGODB_URI) {
    console.warn('[L.H.T DB] Thiếu MONGODB_URI — chạy ở chế độ không có cơ sở dữ liệu.');
    return;
  }

  try {
    base = await mongoose.createConnection(env.MONGODB_URI, CONN_OPTIONS).asPromise();

    for (const workspace of Object.keys(WORKSPACE_DB) as DbWorkspace[]) {
      const dbName = WORKSPACE_DB[workspace];
      const conn = dbName && dbName !== 'lht' ? base.useDb(dbName, { useCache: true }) : base;
      workspaceConns.set(workspace, conn);
    }

    console.log('[L.H.T DB] Kết nối MongoDB thành công (news/kb/chat/memory trên cùng pool).');
  } catch (err) {
    console.error('[L.H.T DB] Kết nối MongoDB thất bại:', err instanceof Error ? err.message : err);
  }
}

export async function disconnectAll(): Promise<void> {
  for (const conn of workspaceConns.values()) {
    if (conn !== base) {
      await conn.close().catch(() => undefined);
    }
  }
  if (base) {
    await base.close().catch(() => undefined);
    base = null;
  }
  workspaceConns.clear();
}
