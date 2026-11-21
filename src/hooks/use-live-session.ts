import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { analyze } from '@/infra/ai';
import type { CameraLimits } from '@/infra/ai/client';
import type { PhotoMeta } from '@/domain/shared/exif';
import {
  INITIAL_STATE,
  adviceDigest,
  isSessionActive,
  reduce,
  type SessionEvent,
  type SessionState,
} from '@/domain/guidance/agent';
import type { Advice } from '@/domain/guidance/continuity';
import { nextRepeat } from '@/domain/guidance/continuity';
import { appendAdvice } from '@/domain/guidance/agent';
import type { LiveSuggestion } from '@/domain/shared/types';

/** 每一轮分析之间的最小间隔(语音模式下由播报驱动,这里是兜底) */
const VOICE_FALLBACK_TICK_MS = 10000;
/** 启动会话后先等一下再抓第一帧,避免和相机初始化抢资源 */
const WARMUP_MS = 700;

export type LiveSessionDeps = {
  /** 是否允许会话运行(没 Key / 没权限 / 相机没就绪都不行) */
  cameraReady: boolean;
  hasApiKey: boolean;
  hasPermission: boolean;
  focused: boolean;
  appActive: boolean;
  /** 分析节奏(秒) */
  intervalSec: number;
  voiceGuide: boolean;
  apiEndpoint: string;
  /** 设置里的「自动拍摄」开关 */
  autoCapture: boolean;
  /** 专业面板展开 / 播报中 / 拍照中 —— 这些状态下不许抓帧、不许自动拍 */
  isBlocked: () => boolean;
  grab: () => Promise<string>;
  meta: () => PhotoMeta | null;
  limits: () => CameraLimits | undefined;
  /** App 是否在前台 —— 后台的失败不算真故障 */
  isAppActive: () => boolean;
};

export type LiveSession = {
  state: SessionState;
  /** 最新一条建议 */
  suggestion: LiveSuggestion | null;
  analyzing: boolean;
  error: string | null;
  paused: boolean;
  active: boolean;
  /** 会话内建议的摘要,拍摄时交给复盘页 */
  digest: () => string | null;
  start: () => void;
  stop: () => void;
  /** 取消自动拍摄倒计时(点任意处) */
  cancel: () => void;
  retry: () => void;
  clearError: () => void;
  reportError: (message: string) => void;
  getLastRunAt: () => number;
  /** 会话是否正在跑这一轮(定时器据此跳过) */
  shouldTick: boolean;
  /** 立刻跑一轮(语音播报结束后补跑用,不会解除暂停) */
  tick: () => void;
};

/**
 * 取景会话的运行时。
 *
 * 判断逻辑全在 `domain/guidance/agent.ts`(纯状态机),这里只负责:
 * 定时器、抓帧、调模型、把结果派发给状态机。
 *
 * **不直接按快门**:倒计时归零时状态会停在 `counting / countdown 0`,
 * 由页面根据这个状态触发拍摄 —— 副作用集中在页面,方便看清"谁在按快门"。
 */
export function useLiveSession(deps: LiveSessionDeps): LiveSession {
  const busyRef = useRef(false);
  const lastRunAtRef = useRef(0);
  /** 会话内的建议时间线(状态机不管记忆,这样纯函数不必关心历史) */
  const adviceRef = useRef<Advice[]>([]);
  /** 同一条建议连续出现的次数 */
  const repeatRef = useRef(1);
  /** 状态机用的护栏条件;放 ref 里让 reducer 不必每次重建 */
  const [state, dispatch] = useReducer(
    (current: SessionState, event: SessionEvent) => reduce(current, event).state,
    INITIAL_STATE,
  );

  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const send = useCallback((event: SessionEvent) => dispatch(event), []);

  // 把护栏条件同步进状态机:面板/前后台/开关变化时都要刷新
  const { autoCapture, focused, appActive, isBlocked, cameraReady, hasApiKey, hasPermission, voiceGuide, intervalSec } = deps;

  useEffect(() => {
    dispatch({
      type: 'GUARD',
      autoCapture,
      blocked: !focused || !appActive || isBlocked(),
    });
  }, [autoCapture, focused, appActive, isBlocked]);

  /** 一轮:抓帧 → 调模型 → 派发结果 */
  const run = useCallback(async () => {
    const d = depsRef.current;
    if (!d.cameraReady || !d.hasApiKey || !d.hasPermission) return;
    if (!d.focused || !d.appActive) return;
    if (d.isBlocked() || busyRef.current) return;

    busyRef.current = true;
    setAnalyzing(true);
    lastRunAtRef.current = Date.now();

    try {
      const base64 = await d.grab();
      const previous = adviceRef.current[adviceRef.current.length - 1] ?? null;
      const result = await analyze(base64, 'live', {
        thinking: 'disabled',
        endpoint: d.apiEndpoint,
        meta: d.meta(),
        limits: d.limits(),
        previousAdvice: previous ? { advice: previous, repeat: repeatRef.current } : null,
      });

      if (result.mode === 'live') {
        setSuggestion(result);
        setError(null);
        repeatRef.current = nextRepeat(previous, result.action);
        adviceRef.current = appendAdvice(adviceRef.current, {
          headline: result.headline,
          action: result.action,
          dim: result.dim,
        });
        send({ type: 'ROUND_OK', readyToShoot: result.readyToShoot === true });
      }
    } catch (err) {
      // 后台期间的失败不是真故障,计数由状态机负责
      if (depsRef.current.isAppActive()) {
        setError((err as Error).message);
        send({ type: 'ROUND_FAIL' });
      }
    } finally {
      busyRef.current = false;
      setAnalyzing(false);
    }
  }, [send]);

  /** 页面/相机条件不满足时暂停会话(不会结束会话) */
  useEffect(() => {
    if (!focused || !appActive || isBlocked()) send({ type: 'PAUSE' });
    else if (state.paused) send({ type: 'RESUME' });
  }, [focused, appActive, isBlocked, state.paused, send]);

  // 分析定时器:只在 observing 且未暂停时跑
  const shouldTick = state.phase === 'observing' && !state.paused;

  useEffect(() => {
    if (!shouldTick) return;
    if (!cameraReady || !hasApiKey || !hasPermission) return;

    const tickMs = voiceGuide ? VOICE_FALLBACK_TICK_MS : Math.max(1, intervalSec) * 1000;
    const warmup = setTimeout(() => void run(), WARMUP_MS);
    const timer = setInterval(() => void run(), tickMs);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [shouldTick, cameraReady, hasApiKey, hasPermission, voiceGuide, intervalSec, run]);

  // 倒计时:counting 时每秒 tick 一次
  useEffect(() => {
    if (state.phase !== 'counting') return;
    const timer = setInterval(() => send({ type: 'TICK' }), 1000);
    return () => clearInterval(timer);
  }, [state.phase, send]);

  const start = useCallback(() => {
    // 开启时无条件清空上一条残留建议与会话记忆
    adviceRef.current = [];
    repeatRef.current = 1;
    setSuggestion(null);
    setError(null);
    send({ type: 'START' });
  }, [send]);

  const stop = useCallback(() => {
    send({ type: 'STOP' });
  }, [send]);

  const cancel = useCallback(() => {
    send({ type: 'CANCEL' });
  }, [send]);

  const retry = useCallback(() => {
    setError(null);
    send({ type: 'RESUME' });
    void run();
  }, [run, send]);

  const tick = useCallback(() => void run(), [run]);
  const clearError = useCallback(() => setError(null), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const getLastRunAt = useCallback(() => lastRunAtRef.current, []);
  const digest = useCallback(() => adviceDigest(adviceRef.current), []);

  return useMemo(
    () => ({
      state,
      suggestion,
      analyzing,
      error,
      paused: state.paused,
      active: isSessionActive(state),
      digest,
      start,
      stop,
      cancel,
      retry,
      clearError,
      reportError,
      getLastRunAt,
      shouldTick,
      tick,
    }),
    [state, suggestion, analyzing, error, digest, start, stop, cancel, retry, clearError, reportError, getLastRunAt, shouldTick, tick],
  );
}
