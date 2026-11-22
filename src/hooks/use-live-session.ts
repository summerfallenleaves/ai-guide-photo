import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import {
  lastParamsNote,
  pushIntervention,
  summarizeInterventions,
  type Intervention,
} from '@/domain/guidance/interventions';
import { appendAdvice } from '@/domain/guidance/agent';
import type { AdjustParams, LiveSuggestion, SceneId } from '@/domain/shared/types';
import {
  decideAgentParams,
  describeApplied,
  normalizeAgentParams,
} from '@/domain/guidance/param-policy';
import type { ParamSnapshot } from '@/domain/guidance/param-policy';

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
  /** 设置里的「AI 调参」开关 */
  aiParams: boolean;
  /** 当前场景(决定用哪套标准) */
  scene: SceneId;
  /** 当前相机参数(给护栏判断变化够不够大) */
  getParams: () => ParamSnapshot | null;
  /** 把参数下发给相机 */
  applyParams: (adj: AdjustParams) => void;
  /** 用户是否在本次会话里手动接管了参数 */
  isUserManual: () => boolean;
  /** 是否正在拍照(拍照时不调参) */
  isBusy: () => boolean;
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
  /** 最近一次自动调参的说明 */
  appliedNote: string | null;
  /** 本次会话的 AI 干预记录(拍完写进复盘/历史) */
  interventions: Intervention[];
  /** 上一次会话的小结(会话结束后显示,新会话开始不影响) */
  lastSessionNote: string | null;
  /** 拍照时取走干预记录 */
  getInterventions: () => Intervention[];
  /** 会话内建议的摘要,拍摄时交给复盘页 */
  digest: () => string | null;
  start: () => void;
  stop: () => void;
  /**
   * 自动拍摄请求的序号:每满足一次"连续两轮 ready",这个数 +1。
   * 页面据此触发一次真正的快门(副作用留在页面,方便看清谁在拍)。
   */
  captureRequest: number;
  /** 取走一次拍摄请求(同一次请求只会返回一次 true) */
  consumeCaptureRequest: () => boolean;
  retry: () => void;
  clearError: () => void;
  reportError: (message: string) => void;
  getLastRunAt: () => number;
  /** 会话是否正在跑这一轮(定时器据此跳过) */
  shouldTick: boolean;
  /** 立刻跑一轮(语音播报结束后补跑用,不会解除暂停) */
  tick: () => void;
  /** 换场景:清"连续 ready"和重复计数,保留建议历史 */
  resetAfterSceneChange: () => void;
};

/**
 * 取景会话的运行时。
 *
 * 判断逻辑全在 `domain/guidance/agent.ts`(纯状态机),这里只负责:
 * 定时器、抓帧、调模型、把结果派发给状态机。
 *
 * **不直接按快门**:状态机给出"这一刻可以拍"的信号(变成 `captureRequest` 序号),
 * 真正按快门的是页面 —— 副作用集中在一处,方便看清"谁在按快门"。
 */
export function useLiveSession(deps: LiveSessionDeps): LiveSession {
  const busyRef = useRef(false);
  const lastRunAtRef = useRef(0);
  /** 上一次自动调参的时间(限速用) */
  const lastAppliedAtRef = useRef(0);
  /** 会话内的建议时间线(状态机不管记忆,这样纯函数不必关心历史) */
  const adviceRef = useRef<Advice[]>([]);
  /** 同一条建议连续出现的次数 */
  const repeatRef = useRef(1);
  /** 状态机用的护栏条件;放 ref 里让 reducer 不必每次重建 */
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  /** 状态放 ref,让 send 能连续派发;只在回调里读写,不在渲染期碰 */
  const stateRef = useRef<SessionState>(INITIAL_STATE);
  const [captureRequest, setCaptureRequest] = useState(0);
  const captureRequestRef = useRef(0);
  const consumedCaptureRef = useRef(0);

  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 最近一次自动调参的说明,用于卡片上的一行提示 */
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  /** 本次会话 AI 的干预记录(调参 / 自动按快门),拍完写进复盘与历史 */
  const interventionsRef = useRef<Intervention[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  /** 上一次会话的小结(会话结束后留在卡片上,供事后查看) */
  const [lastSessionNote, setLastSessionNote] = useState<string | null>(null);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const send = useCallback((event: SessionEvent) => {
    const result = reduce(stateRef.current, event);
    stateRef.current = result.state;
    setState(result.state);
    if (result.capture) {
      const next = pushIntervention(interventionsRef.current, {
        at: Date.now(),
        kind: 'auto-shot',
        detail: '连续两轮判断可以拍了',
      });
      interventionsRef.current = next;
      setInterventions(next);
      captureRequestRef.current += 1;
      setCaptureRequest(captureRequestRef.current);
    }
  }, []);

  // 把护栏条件同步进状态机:面板/前后台/开关变化时都要刷新
  const { autoCapture, focused, appActive, isBlocked, cameraReady, hasApiKey, hasPermission, voiceGuide, intervalSec } = deps;

  useEffect(() => {
    send({
      type: 'GUARD',
      autoCapture,
      blocked: !focused || !appActive || isBlocked(),
    });
  }, [autoCapture, focused, appActive, isBlocked, send]);

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
        scene: d.scene,
      });

      if (result.mode === 'live') {
        // Agent 直接调参:只有护栏全过才下发,失败/跳过都不影响建议本身
        if (d.aiParams && result.params) {
          const params = normalizeAgentParams(result.params, d.limits() ?? null);
          const decision = decideAgentParams({
            enabled: d.aiParams,
            busy: d.isBusy(),
            userTakeover: d.isUserManual(),
            now: Date.now(),
            lastAppliedAt: lastAppliedAtRef.current,
            params,
            current: d.getParams(),
          });
          if (decision.apply && params) {
            d.applyParams(params);
            lastAppliedAtRef.current = Date.now();
            const detail = describeApplied(params).replace(/^已自动调\s*/, '');
            const next = pushIntervention(interventionsRef.current, {
              at: Date.now(),
              kind: 'params',
              detail,
              reason: result.reason || undefined,
            });
            interventionsRef.current = next;
            setInterventions(next);
            setAppliedNote(lastParamsNote(next));
          }
        }
        setSuggestion(result);
        setError(null);
        repeatRef.current = nextRepeat(previous, result.action);
        adviceRef.current = appendAdvice(adviceRef.current, {
          headline: result.headline,
          action: result.action,
          dim: result.dim,
          scene: d.scene,
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

  const consumeCaptureRequest = useCallback(() => {
    if (captureRequestRef.current === 0 || consumedCaptureRef.current === captureRequestRef.current) {
      return false;
    }
    consumedCaptureRef.current = captureRequestRef.current;
    return true;
  }, []);

  const start = useCallback(() => {
    // 开启时无条件清空上一条残留建议与会话记忆
    adviceRef.current = [];
    repeatRef.current = 1;
    interventionsRef.current = [];
    lastAppliedAtRef.current = 0;
    setInterventions([]);
    setAppliedNote(null);
    setSuggestion(null);
    setError(null);
    send({ type: 'START' });
  }, [send]);

  const stop = useCallback(() => {
    // 先留一份小结,再把记录清空 ——
    // 否则用户随手拍一张,拍照流程会把"上次会话调过参"写进这张的复盘里
    setLastSessionNote(summarizeInterventions(interventionsRef.current));
    interventionsRef.current = [];
    setInterventions([]);
    setAppliedNote(null);
    send({ type: 'STOP' });
  }, [send]);

  /** 拍照流程要在快门那一刻取走干预记录 */
  const getInterventions = useCallback(() => interventionsRef.current, []);

  const retry = useCallback(() => {
    setError(null);
    send({ type: 'RESUME' });
    void run();
  }, [run, send]);

  const tick = useCallback(() => void run(), [run]);
  const resetAfterSceneChange = useCallback(() => {
    repeatRef.current = 1;
    send({ type: 'RESET_READY' });
  }, [send]);
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
      appliedNote,
      interventions,
      lastSessionNote,
      getInterventions,
      digest,
      start,
      stop,
      captureRequest,
      consumeCaptureRequest,
      retry,
      clearError,
      reportError,
      getLastRunAt,
      shouldTick,
      tick,
      resetAfterSceneChange,
    }),
    [
      state,
      suggestion,
      analyzing,
      error,
      appliedNote,
      interventions,
      lastSessionNote,
      getInterventions,
      captureRequest,
      consumeCaptureRequest, digest, start, stop, retry, clearError, reportError, getLastRunAt, shouldTick, tick, resetAfterSceneChange],
  );
}
