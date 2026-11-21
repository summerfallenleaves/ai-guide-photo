import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SceneId } from '@/domain/shared/types';
import { useSyncExternalStore } from 'react';

export type Thinking = 'disabled' | 'high';

export type AppSettings = {
  /** 快速模式:开 → 不思考(disabled,1.6~1.8 秒);关 → high(3~6 秒,更细致) */
  fastMode: boolean;
  /** 自动分析间隔(秒) */
  intervalSec: number;
  /** DeepSeek 接口地址(留空用官方地址) */
  apiEndpoint: string;
  /** 读取相机记录的光学参数,让建议能涉及焦距/ISO/快门 */
  paramAdvice: boolean;
  /** 取景九宫格辅助线 */
  gridEnabled: boolean;
  /** 连续两轮"可以拍了"后自动按快门(会话内的护栏开关) */
  autoCapture: boolean;
  /** 允许 Agent 直接把曝光/白平衡/对焦下发给相机 */
  aiParams: boolean;
  /** 上次选的拍摄场景(下次打开还停在这里) */
  scene: SceneId;
  /**
   * 语音播报取景建议。
   * **默认关闭** —— 户外/公共场合出声可能打扰别人,必须用户主动打开。
   */
  voiceGuide: boolean;
};

export const INTERVAL_MIN = 3;
export const INTERVAL_MAX = 10;

const SCENE_IDS: SceneId[] = ['portrait', 'landscape', 'food', 'street', 'other'];
function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as string[]).includes(value);
}

export const DEFAULT_SETTINGS: AppSettings = {
  fastMode: true,
  intervalSec: 3,
  apiEndpoint: '',
  paramAdvice: true,
  gridEnabled: true,
  autoCapture: true,
  aiParams: true,
  scene: 'other',
  voiceGuide: false,
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
    voiceGuide: typeof input.voiceGuide === 'boolean' ? input.voiceGuide : DEFAULT_SETTINGS.voiceGuide,
    intervalSec: Number.isFinite(interval)
      ? Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, Math.round(interval)))
      : DEFAULT_SETTINGS.intervalSec,
    apiEndpoint: typeof input.apiEndpoint === 'string' ? input.apiEndpoint.trim() : DEFAULT_SETTINGS.apiEndpoint,
    paramAdvice: typeof input.paramAdvice === 'boolean' ? input.paramAdvice : DEFAULT_SETTINGS.paramAdvice,
    gridEnabled: typeof input.gridEnabled === 'boolean' ? input.gridEnabled : DEFAULT_SETTINGS.gridEnabled,
    autoCapture: typeof input.autoCapture === 'boolean' ? input.autoCapture : DEFAULT_SETTINGS.autoCapture,
    aiParams: typeof input.aiParams === 'boolean' ? input.aiParams : DEFAULT_SETTINGS.aiParams,
    scene: isSceneId(input.scene) ? input.scene : DEFAULT_SETTINGS.scene,
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
/**
 * 取景会话由相机页的「开始 AI 取景」按钮控制,不再是设置开关。
 * 这个函数保留给「设置页摘要」判断当前是否有能力跑取景。
 */
export function liveAnalysisEnabled(s: AppSettings): boolean {
  return s.fastMode;
}

export function liveIntervalMs(s: AppSettings): number {
  return s.intervalSec * 1000;
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
