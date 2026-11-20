import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef } from 'react';

import { followUpDelay, speechWatchdogMs } from '@/domain/guidance/live-analysis-policy';
import type { LiveSuggestion } from '@/domain/shared/types';

/** 两次分析之间的最小间隔:防止 TTS 秒回导致连续请求 */
const MIN_ANALYZE_GAP_MS = 1500;

export type VoiceGuideDeps = {
  enabled: boolean;
  focused: boolean;
  appActive: boolean;
  suggestion: LiveSuggestion | null;
  /** 播报结束后补一次分析 */
  onFollowUp: () => void;
  /** 上一次分析开始的时间,用来算最小间隔 */
  getLastRunAt: () => number;
  /**
   * 由调用方持有的"正在播报"标志。
   * 分析循环要靠它决定这一轮跳过 —— 用外部 ref 而不是双向依赖,
   * 否则两个 hook 会互相需要对方的返回值。
   */
  speakingFlag: { current: boolean };
};

export type VoiceGuide = {
  /** 立刻闭嘴(离开页面、用户点重试时用) */
  stop: () => void;
};

/**
 * 语音播报取景建议。
 *
 * 它同时承担一个副作用:**播报期间冻结取景建议**。
 * 一句中文要 4~5 秒,而分析间隔最短 3 秒,不冻结的话每句话都会被下一轮顶掉,
 * 用户听到半句、看到的还是另一条 —— 比不说更糟。
 */
export function useVoiceGuide(deps: VoiceGuideDeps): VoiceGuide {
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenRef = useRef('');

  // 依赖放 ref,避免 effect 每次渲染都重跑
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const clearTimers = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (followUpRef.current) {
      clearTimeout(followUpRef.current);
      followUpRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    depsRef.current.speakingFlag.current = false;
    clearTimers();
    void Speech.stop();
  }, [clearTimers]);

  const { enabled, focused, appActive, suggestion } = deps;

  useEffect(() => {
    if (!enabled || !focused || !appActive) return;
    if (!suggestion || suggestion.mode !== 'live') return;

    const text = suggestion.readyToShoot ? suggestion.headline : suggestion.action;
    if (!text || text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;

    const flag = depsRef.current.speakingFlag;
    flag.current = true;

    const finish = () => {
      flag.current = false;
      clearTimers();
      // 说完补一次分析,但和上一轮隔开
      const wait = followUpDelay(depsRef.current.getLastRunAt(), Date.now(), MIN_ANALYZE_GAP_MS);
      followUpRef.current = setTimeout(() => {
        followUpRef.current = null;
        depsRef.current.onFollowUp();
      }, wait);
    };

    // 兜底:某些 TTS 引擎不回调 onDone,标记会一直卡住,导致再也不分析
    watchdogRef.current = setTimeout(finish, speechWatchdogMs(text.length));

    void Speech.stop().then(() => {
      Speech.speak(text, {
        language: 'zh-CN',
        rate: 1.0,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    });
  }, [enabled, focused, appActive, suggestion, clearTimers]);

  // 离开页面 / 退到后台立刻闭嘴
  useEffect(() => {
    if (focused && appActive) return;
    stop();
  }, [focused, appActive, stop]);

  // 卸载时也停掉
  useEffect(() => stop, [stop]);

  return { stop };
}
