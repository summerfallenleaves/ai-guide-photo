import { useCallback, useEffect, useRef, useState } from 'react';

import { analyze } from '@/lib/api';
import type { CameraLimits } from '@/lib/deepseek';
import type { PhotoMeta } from '@/lib/exif';
import {
  analysisTickMs,
  canRunAnalysis,
  onAnalysisFailure,
  shouldScheduleAnalysis,
  type AnalyzeGate,
} from '@/lib/live-analysis-policy';
import type { LiveSuggestion } from '@/lib/types';

/** 语音模式下定时器的兜底周期:真正的节奏由播报驱动 */
const VOICE_FALLBACK_TICK_MS = 10000;
/** 进入页面后先等一下再开始,避免和相机初始化抢资源 */
const WARMUP_MS = 700;

export type LiveAnalysisDeps = {
  /** 快速模式 + 自动分析都开启 */
  liveOn: boolean;
  cameraReady: boolean;
  hasApiKey: boolean;
  hasPermission: boolean;
  focused: boolean;
  appActive: boolean;
  intervalSec: number;
  voiceGuide: boolean;
  apiEndpoint: string;
  /** 抓一帧预览画面(base64),失败请抛错 */
  grab: () => Promise<string>;
  /** 拼给模型的光学参数 */
  meta: () => PhotoMeta | null;
  /** 相机硬件范围,用于约束模型给的建议 */
  limits: () => CameraLimits | undefined;
  /** 当前是否被别的事情占用(语音播报中、拍照中) */
  isBlocked: () => boolean;
  /** App 是否在前台 —— 后台的失败不算真故障 */
  isAppActive: () => boolean;
};

export type LiveAnalysis = {
  suggestion: LiveSuggestion | null;
  analyzing: boolean;
  error: string | null;
  paused: boolean;
  /** 最近一次开始分析的时间戳,语音补跑用它算最小间隔 */
  getLastRunAt: () => number;
  /** 立刻分析一轮(会受前提条件约束) */
  run: () => Promise<void>;
  /** 用户点「重试」:清掉暂停和失败计数,再跑一轮 */
  retry: () => void;
  /** 清掉错误(App 回到前台时用) */
  clearError: () => void;
  /** 由调用方上报一个错误(比如拍照失败),共用同一个提示位置 */
  reportError: (message: string) => void;
  /** 重置连续失败计数 */
  resetFailures: () => void;
};

/**
 * 取景分析循环。
 *
 * 从相机页抽出来的原因:这段逻辑有 7 个前提条件、3 种失败语义(后台失败不算、
 * 连续失败暂停、播报/拍照期间跳过),和 JSX、refs 混在一起时改一处要靠脑内推演。
 * 调度判断抽到了 `live-analysis-policy.ts`,有单测锁着。
 */
export function useLiveAnalysis(deps: LiveAnalysisDeps): LiveAnalysis {
  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const busyRef = useRef(false);
  const failuresRef = useRef(0);
  const lastRunAtRef = useRef(0);
  const pausedRef = useRef(false);

  // 把最新的依赖放进 ref,让 run 的 identity 保持稳定,定时器不会反复重建
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const run = useCallback(async () => {
    const d = depsRef.current;
    const gate: AnalyzeGate = {
      liveOn: d.liveOn,
      paused: pausedRef.current,
      cameraReady: d.cameraReady,
      hasApiKey: d.hasApiKey,
      hasPermission: d.hasPermission,
      busy: busyRef.current,
      blocked: d.isBlocked(),
    };
    if (!canRunAnalysis(gate)) return;

    lastRunAtRef.current = Date.now();
    busyRef.current = true;
    setAnalyzing(true);
    try {
      const base64 = await d.grab();
      // 取景建议一律关闭思考:实测 thinking=low 也要 3.5~8 秒,disabled 只要 1.6~1.8 秒
      const result = await analyze(base64, 'live', {
        thinking: 'disabled',
        endpoint: d.apiEndpoint,
        meta: d.meta(),
        limits: d.limits(),
      });
      if (result.mode === 'live') {
        setSuggestion(result);
        setError(null);
        failuresRef.current = 0;
      }
    } catch (err) {
      const outcome = onAnalysisFailure(failuresRef.current, depsRef.current.isAppActive());
      if (outcome.counts) {
        failuresRef.current = outcome.count;
        setError((err as Error).message);
        if (outcome.pause) {
          pausedRef.current = true;
          setPaused(true);
        }
      }
    } finally {
      busyRef.current = false;
      setAnalyzing(false);
    }
  }, []);

  const retry = useCallback(() => {
    failuresRef.current = 0;
    pausedRef.current = false;
    setPaused(false);
    setError(null);
    void run();
  }, [run]);

  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const resetFailures = useCallback(() => {
    failuresRef.current = 0;
  }, []);
  const getLastRunAt = useCallback(() => lastRunAtRef.current, []);

  const { liveOn, cameraReady, hasApiKey, hasPermission, focused, appActive, intervalSec, voiceGuide } = deps;

  useEffect(() => {
    const scheduledNow: AnalyzeGate = {
      liveOn,
      paused,
      cameraReady,
      hasApiKey,
      hasPermission,
      busy: false,
      blocked: false,
    };
    if (!shouldScheduleAnalysis(scheduledNow, { active: true, focused, appActive })) return;

    const tickMs = analysisTickMs(voiceGuide, intervalSec, VOICE_FALLBACK_TICK_MS);
    const warmup = setTimeout(() => void run(), WARMUP_MS);
    const timer = setInterval(() => void run(), tickMs);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [liveOn, paused, cameraReady, hasApiKey, hasPermission, focused, appActive, intervalSec, voiceGuide, run]);

  return {
    suggestion,
    analyzing,
    error,
    paused,
    getLastRunAt,
    run,
    retry,
    clearError,
    reportError,
    resetFailures,
  };
}
