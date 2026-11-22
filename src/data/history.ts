import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';

import { Asset } from 'expo-media-library';

import type { Intervention } from '@/domain/guidance/interventions';
import { toHistoryCopy } from '@/infra/analysis-image';
import type { PhotoMeta } from '@/domain/shared/exif';
import type { CaptureResult, SceneId } from '@/domain/shared/types';

const STORAGE_KEY = 'history.v1';

/**
 * 保留策略:天数和条数**谁先到就按谁裁**。
 *
 * 只按天数是不够的 —— 一天拍 50 张,30 天就是 1500 张;
 * 只按条数也不够 —— 一周拍 3 张的人永远不会被"条数"裁剪,但记录会一直留着。
 * 两者都由设置页配置。
 */
export type HistoryConfig = { retentionDays: number; maxEntries: number };

const DEFAULT_CONFIG: HistoryConfig = { retentionDays: 30, maxEntries: 200 };
let config: HistoryConfig = DEFAULT_CONFIG;
/**
 * 是否已经由设置注入过保留策略。
 *
 * 冷启动时 `loadHistory()` 可能先于设置读取完成(子组件 effect 早于父组件),
 * 那时配置还是默认值 —— 如果按默认的 30 天裁剪,用户设的 90 天记录会被**误删**。
 * 所以:**没配置过就不裁剪**,等 `configureHistory()` 注入后再裁。
 */
let configured = false;

export function getHistoryConfig(): HistoryConfig {
  return config;
}

/** 设置改变时调用:立即按新策略裁一次并落盘 */
export function configureHistory(next: HistoryConfig): void {
  config = next;
  configured = true;
  // 注入后立刻按新策略裁一次(包括"之前没裁过"的情况)
  if (pruneEntries()) {
    persist();
    emit();
  }
}
const DIR_NAME = 'history';

export type HistoryEntry = {
  id: string;
  /** 存在文档目录里的照片副本(不会像 cache 那样被系统清掉) */
  uri: string;
  createdAt: number;
  savedToAlbum: boolean;
  /** 相册条目的 MediaStore id;没有它就无法判断相册那边还在不在 */
  mediaId?: string;
  /** 相册里的原图已删除:副本随之清理,只保留记录 */
  imageGone?: boolean;
  /** 拍照时选的场景(复盘页用来显示"按什么标准点评") */
  scene?: SceneId;
  /** 这次拍摄 AI 动过什么(调参 / 自动按快门) */
  interventions?: Intervention[];
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

/**
 * 把照片的**缩小副本**存进文档目录,返回可长期使用的 file:// 地址。
 *
 * 只存 1280 长边:原图在相册里,历史不需要第二份全尺寸副本
 * (原图一张 3~5MB,7 天能到几百 MB)。
 */
export async function persistPhoto(uri: string, id: string, width = 0, height = 0): Promise<string> {
  const dest = new File(historyDir(), `${id}.jpg`);
  const resized = await toHistoryCopy(uri, width, height);
  const src = new File(resized);
  src.copy(dest);
  return dest.uri;
}

function isExpired(entry: HistoryEntry, now = Date.now()): boolean {
  return now - entry.createdAt > config.retentionDays * 24 * 60 * 60 * 1000;
}

/** 按「天数 + 条数」淘汰并删掉对应照片,返回是否有变化 */
function pruneEntries(): boolean {
  const now = Date.now();
  let changed = false;

  const kept: HistoryEntry[] = [];
  for (const entry of entries) {
    if (isExpired(entry, now)) {
      if (entry.uri) deletePhoto(entry.uri);
      changed = true;
    } else {
      kept.push(entry);
    }
  }

  // 条数上限:超出的按时间从旧到新删(entries 已按时间倒序)
  if (kept.length > config.maxEntries) {
    for (const dropped of kept.slice(config.maxEntries)) {
      if (dropped.uri) deletePhoto(dropped.uri);
    }
    kept.length = config.maxEntries;
    changed = true;
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
          // 超过保留期的记录在启动时清掉;但必须等设置注入过保留策略再裁,
          // 否则会用默认值把用户配置的长保留期记录误删
          if (configured && pruneEntries()) {
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

/**
 * 判断"相册里那张还在不在"。
 *
 * 只有两种情况算已删除:
 * - 查询返回空(条目真的没了)
 * - 明确标记进了回收站(Android 11+ 的 isTrashed)
 *
 * **查询抛错不算删除** —— 可能是权限、系统繁忙,误判会把用户的照片删掉。
 */
export function isAlbumAssetGone(info: { id?: string } | null | undefined): boolean {
  return !info || !info.id;
}

/** 查询相册条目:true=还在,false=没了,undefined=查不了(权限/系统错误) */
async function albumAssetExists(mediaId: string): Promise<boolean | undefined> {
  try {
    // 新 API:`Asset` 实例的 getInfo() 去查这个 id;条目不在会抛错
    const info = await new Asset(mediaId).getInfo();
    return !!info?.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 只有"明确不存在"才算删除;权限、系统繁忙一律当作查不了
    if (/not found|not exist|no such|ENOENT|does not exist/i.test(message)) return false;
    return undefined;
  }
}

/** 哪些条目应该去查相册:存过相册、有 id、还没标记过缺失 */
export function needsAlbumCheck(entry: HistoryEntry): boolean {
  return entry.savedToAlbum === true && !!entry.mediaId && !entry.imageGone;
}

const SYNC_MIN_GAP_MS = 30_000;
const SYNC_BATCH = 20;
let lastSyncAt = 0;

/**
 * 和相册对一次账(方案 A:惰性检查,不监听)。
 *
 * 调用点:打开历史页时。最多查最近 20 条,且 30 秒内不重复查。
 * 查到已删除:删掉我们的副本,保留评分与点评,标记 imageGone。
 */
export async function syncWithAlbum(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastSyncAt < SYNC_MIN_GAP_MS) return false;
  lastSyncAt = now;

  const targets = entries.filter(needsAlbumCheck).slice(0, SYNC_BATCH);
  if (targets.length === 0) return false;

  let changed = false;
  for (const entry of targets) {
    const exists = await albumAssetExists(entry.mediaId as string);
    // undefined = 查不了(权限/系统错误),跳过;只有明确不存在才处理
    if (exists !== false) continue;

    deletePhoto(entry.uri);
    entries = entries.map((item) => (item.id === entry.id ? { ...item, imageGone: true, uri: '' } : item));
    changed = true;
  }

  if (changed) persist();
  emit();
  return changed;
}

/** 清掉"相册已删"的空记录 */
export function removeImageGoneEntries(): number {
  const kept = entries.filter((entry) => !entry.imageGone);
  const removed = entries.length - kept.length;
  if (removed > 0) {
    entries = kept;
    persist();
    emit();
  }
  return removed;
}

export function getHistory(): HistoryEntry[] {
  return entries;
}

export function subscribeHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 历史是否已经从磁盘读上来了。
 *
 * 这一步是异步的(AsyncStorage),而相机页的缩略图在首帧就需要判断"有没有历史"。
 * 没有这个标记的话,冷启动会先显示"空"的白圆,读到数据后才变成缩略图。
 */
export function isHistoryLoaded(): boolean {
  return loaded;
}

export function useHistory(): HistoryEntry[] {
  // 谁消费历史,谁负责把它读上来 —— 否则冷启动时相机页的缩略图会是空的
  useEffect(() => {
    void loadHistory();
  }, []);
  return useSyncExternalStore(subscribeHistory, getHistory, getHistory);
}

/** 历史是否已加载(用来区分"还没有历史"和"还没读完") */
export function useHistoryLoaded(): boolean {
  return useSyncExternalStore(subscribeHistory, isHistoryLoaded, () => false);
}

export function addHistoryEntry(entry: HistoryEntry) {
  entries = [entry, ...entries];
  // pruneEntries 同时处理「天数」和「条数」,不需要再截断一次
  pruneEntries();
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
