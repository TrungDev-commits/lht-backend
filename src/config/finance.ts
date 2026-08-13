import mongoose, { type Connection } from 'mongoose';
import { env } from './env.js';

export interface FinanceExpenseLimit {
  date: string;
  dailyLimit: number;
  spent: number;
  remaining: number;
  currency: string;
}

let financeConnection: Connection | null = null;

const FINANCE_SCHEMA = new mongoose.Schema(
  {
    date: { type: String, required: true, index: true },
    dailyLimit: { type: Number, required: true, default: 0 },
    spent: { type: Number, required: true, default: 0 },
    remaining: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'VND' },
  },
  { strict: false, versionKey: false }
);

const FinanceModel = (collectionName: string) =>
  financeConnection?.model('ExpenseLimit', FINANCE_SCHEMA, collectionName) ?? null;

export async function connectFinanceDatabase(): Promise<boolean> {
  const uri = env.FINANCE_DB_URI;
  if (!uri) {
    console.warn('[L.H.T FINANCE] Thiếu FINANCE_DB_URI — bỏ qua đồng bộ tài chính.');
    return false;
  }

  try {
    financeConnection = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 30_000,
      maxPoolSize: 5,
      minPoolSize: 0,
    }).asPromise();
    console.log('[L.H.T FINANCE] Kết nối cơ sở dữ liệu LHT-finance thành công.');
    return true;
  } catch (err) {
    console.error(
      '[L.H.T FINANCE] Không thể kết nối LHT-finance:',
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

export async function getTodayFinanceSummary(): Promise<FinanceExpenseLimit | null> {
  if (!financeConnection || financeConnection.readyState !== 1) {
    return null;
  }

  try {
    const Model = FinanceModel('expense_limits');
    if (!Model) return null;

    const todayKey = new Date().toISOString().slice(0, 10);
    const record = await Model.findOne({ date: todayKey }).sort({ createdAt: -1 }).lean().exec();

    if (!record) return null;

    const typed = record as unknown as FinanceExpenseLimit;
    return {
      date: typed.date ?? todayKey,
      dailyLimit: Number(typed.dailyLimit) || 0,
      spent: Number(typed.spent) || 0,
      remaining: Number(typed.remaining) || Math.max(Number(typed.dailyLimit) - Number(typed.spent), 0),
      currency: typed.currency ?? 'VND',
    };
  } catch (err) {
    console.warn('[L.H.T FINANCE] Lỗi truy vấn hạn mức chi tiêu:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function disconnectFinanceDatabase(): Promise<void> {
  if (financeConnection) {
    await financeConnection.close().catch(() => undefined);
    financeConnection = null;
  }
}
