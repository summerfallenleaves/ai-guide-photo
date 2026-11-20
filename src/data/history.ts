import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import type { PhotoMeta } from '@/domain/shared/exif';
import type { CaptureResult } from '@/domain/shared/types';

const STORAGE_KEY = 'history.v1';
/** 只保留最近多少天(按自然日算) */
export const RETENTION_DAYS = 7;
/** 安全上限:防止某天密集拍摄把存储撑爆,正常不会触发 */
const MAX_ENTRIES = 200;
const DIR_NAME = 'history';

export type HistoryEntry = {
  id: string;
  /** 存在文档目录里的照片副本(不会像 cache 那样被系统清掉) */
  uri: string;
  createdAt: number;
  savedToAlbum: boolean;
  meta: PhotoMeta | null;
  status: 'analyzing' | 'done' | 'failed';
  result?: CaptureResult;
  error?: string;
};

let entries: HistoryEntry[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function persist() {
  // 异步写盘,失败不阻塞 UI
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
}

function historyDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

/** 把刚拍的照片复制进文档目录,返回可长期使用的 file:// 地址 */
export async function persistPhoto(uri: string, id: string): Promise<string> {
  const dest = new File(historyDir(), `${id}.jpg`);
  const src = new File(uri);
  await src.copy(dest);
  return dest.uri;
}

/** 过期判定:早于「今天往前数 RETENTION_DAYS 天的零点」就算过期 */
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function isExpired(entry: HistoryEntry, now = Date.now()): boolean {
  return now - entry.createdAt > RETENTION_MS;
}

/** 淘汰过期条目并删掉对应照片,返回是否有变化 */
function pruneExpired(): boolean {
  const now = Date.now();
  const kept: HistoryEntry[] = [];
  let changed = false;
  for (const entry of entries) {
    if (isExpired(entry, now)) {
      deletePhoto(entry.uri);
      changed = true;
    } else {
      kept.push(entry);
    }
  }
  if (changed) entries = kept;
  return changed;
}

function deletePhoto(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 删不掉就算了,不该影响主流程
  }
}

export async function loadHistory(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw) as HistoryEntry[];
        if (Array.isArray(parsed)) {
          // 上次退出时还没点评完的记录,重启后不会再更新,直接标记为失败
          entries = parsed.map((e) => {
            if (e.status === 'analyzing') {
              return { ...e, status: 'failed' as const, error: '上次点评没有完成' };
            }
            // 兼容旧版本记录:补上后加的字段
            if (e.result && Array.isArray(e.result.improvements)) {
              return {
                ...e,
                result: {
                  ...e.result,
                  strengths: e.result.strengths ?? [],
                  verdict: e.result.verdict ?? 'tweak',
                },
              };
            }
            return e;
          });
          // 超过保留期的记录在启动时清掉
          if (pruneExpired()) {
            void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
          }
        }
      }
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      loadPromise = null;
      emit();
    });
  return loadPromise;
}

export function getHistory(): HistoryEntry[] {
  return entries;
}

export function subscribeHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribeHistory, getHistory, getHistory);
}

export function addHistoryEntry(entry: HistoryEntry) {
  entries = [entry, ...entries];
  pruneExpired();
  for (const dropped of entries.slice(MAX_ENTRIES)) deletePhoto(dropped.uri);
  entries = entries.slice(0, MAX_ENTRIES);
  emit();
  persist();
}

export function updateHistoryEntry(id: string, patch: Partial<HistoryEntry>) {
  let changed = false;
  entries = entries.map((e) => {
    if (e.id !== id) return e;
    changed = true;
    return { ...e, ...patch };
  });
  if (!changed) return;
  emit();
  persist();
}

export function removeHistoryEntry(id: string) {
  const target = entries.find((e) => e.id === id);
  entries = entries.filter((e) => e.id !== id);
  if (target) deletePhoto(target.uri);
  emit();
  persist();
}

export function clearHistory() {
  entries.forEach((e) => deletePhoto(e.uri));
  entries = [];
  emit();
  persist();
}
