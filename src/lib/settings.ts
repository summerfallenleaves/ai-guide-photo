import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Thinking = 'disabled' | 'high';

export type AppSettings = {
  /** 快速模式:开 → 不思考(disabled,1.6~1.8 秒);关 → high(3~6 秒,更细致) */
  fastMode: boolean;
  /** 自动分析:取景时定时给建议 */
  autoAnalyze: boolean;
  /** 自动分析间隔(秒) */
  intervalSec: number;
};

export const INTERVAL_MIN = 3;
export const INTERVAL_MAX = 10;

export const DEFAULT_SETTINGS: AppSettings = {
  fastMode: true,
  autoAnalyze: true,
  intervalSec: 3,
};

const STORAGE_KEY = 'ai-guide-photo:settings:v1';

let settings: AppSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

export function getSettings(): AppSettings {
  return settings;
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: AppSettings) {
  settings = next;
  listeners.forEach((notify) => notify());
}

export function updateSettings(patch: Partial<AppSettings>) {
  commit(sanitize({ ...settings, ...patch }));
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch((err) => {
    console.warn('[settings] 保存失败:', err);
  });
}

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    commit(sanitize(JSON.parse(raw)));
  } catch (err) {
    console.warn('[settings] 读取失败,使用默认值:', err);
  }
}

function sanitize(input: Partial<AppSettings>): AppSettings {
  const interval = Number(input.intervalSec);
  return {
    fastMode: typeof input.fastMode === 'boolean' ? input.fastMode : DEFAULT_SETTINGS.fastMode,
    autoAnalyze: typeof input.autoAnalyze === 'boolean' ? input.autoAnalyze : DEFAULT_SETTINGS.autoAnalyze,
    intervalSec: Number.isFinite(interval)
      ? Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(interval)))
      : DEFAULT_SETTINGS.intervalSec,
  };
}

/**
 * 思考强度由快速模式推导。
 * 注意:DeepSeek 的 `low` 只是"想得浅一点",实测仍会产生 300~800 个思维链 token、
 * 单次 3.5~8 秒,和 high 差别不大。真正快的是 `disabled`(0 思考,1.6~1.8 秒)。
 */
export function thinkingOf(s: AppSettings): Thinking {
  return s.fastMode ? 'disabled' : 'high';
}

/**
 * 自动分析是否真的生效。
 * 规则:只有快速模式打开时自动分析才生效——高思考强度下每次要 3~6 秒,
 * 再按 3 秒一轮去抓帧只会让建议永远滞后于画面。
 */
export function liveAnalysisEnabled(s: AppSettings): boolean {
  return s.fastMode && s.autoAnalyze;
}

export function liveIntervalMs(s: AppSettings): number {
  return s.intervalSec * 1000;
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
