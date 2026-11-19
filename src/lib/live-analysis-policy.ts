/**
 * 取景分析的调度策略。
 *
 * 这些判断原本埋在相机页的 `runLiveAnalysis` 里,和 refs、setState 缠在一起,
 * 出了 bug 只能靠真机复现。抽成纯函数后可以单测,
 * 也让 hook 只剩"什么时候调、拿到结果怎么存"。
 */

export type AnalyzeGate = {
  /** 快速模式 + 自动分析都开着 */
  liveOn: boolean;
  /** 连续失败后暂停了 */
  paused: boolean;
  cameraReady: boolean;
  hasApiKey: boolean;
  hasPermission: boolean;
  /** 已经有一轮在跑 */
  busy: boolean;
  /** 语音正在播报,或正在拍照 */
  blocked: boolean;
};

/** 这一轮分析现在能不能跑 */
export function canRunAnalysis(gate: AnalyzeGate): boolean {
  return (
    gate.liveOn &&
    !gate.paused &&
    gate.cameraReady &&
    gate.hasApiKey &&
    gate.hasPermission &&
    !gate.busy &&
    !gate.blocked
  );
}

/** 定时器要不要挂:在 canRunAnalysis 之外,还要求页面在前台且聚焦 */
export function shouldScheduleAnalysis(
  gate: AnalyzeGate,
  opts: { active: boolean; focused: boolean; appActive: boolean },
): boolean {
  return gate.liveOn && !gate.paused && gate.cameraReady && gate.hasApiKey && gate.hasPermission
    ? opts.active && opts.focused && opts.appActive
    : false;
}

export type FailureOutcome = {
  /** 新的连续失败次数 */
  count: number;
  /** 是否该暂停自动分析 */
  pause: boolean;
  /** 是否算一次真失败(后台期间的失败不算) */
  counts: boolean;
};

export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * 处理一次失败的计数。
 *
 * **后台期间的失败不算真故障** —— 退到后台时在途请求会被挂起或超时,
 * 那不是用户能感知的问题,记成失败会让 App 一回来就显示红字。
 */
export function onAnalysisFailure(
  current: number,
  appActive: boolean,
  threshold = MAX_CONSECUTIVE_FAILURES,
): FailureOutcome {
  if (!appActive) {
    return { count: current, pause: false, counts: false };
  }
  const count = current + 1;
  return { count, pause: count >= threshold, counts: true };
}

/**
 * 下一轮分析的间隔。
 *
 * 语音模式下配置的间隔不生效(设置页会置灰):真正的节奏由播报驱动,
 * 定时器只做兜底,否则播报还没念完就又开始抓帧。
 */
export function analysisTickMs(voiceGuide: boolean, intervalSec: number, voiceFallbackMs: number): number {
  return voiceGuide ? voiceFallbackMs : intervalSec * 1000;
}

/**
 * 播报结束后补一次分析的等待时间。
 *
 * 不能立刻跑:某些 TTS 引擎(没装语音包、报错)会瞬间回调 onDone,
 * 不设下限就变成"分析 → 秒回 → 立刻再分析"的连续请求。
 */
export function followUpDelay(lastRunAt: number, now: number, minGapMs: number): number {
  return Math.max(0, minGapMs - (now - lastRunAt));
}

/** 播报的兜底超时:防止引擎不回调 onDone 导致冻结状态永久卡住 */
export function speechWatchdogMs(textLength: number): number {
  return Math.min(15000, textLength * 220 + 2500);
}
