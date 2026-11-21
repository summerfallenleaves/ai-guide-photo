/**
 * 语音播报的时序规则。
 *
 * 这两条公式和"要不要分析"无关 —— 那是 agent 状态机的事。
 * 放在这里是因为它们只被 `use-voice-guide` 用,单独一个文件比混进调度策略里清楚。
 */

/**
 * 播报结束后补跑一轮的延迟。
 *
 * 某些情况下 TTS 会瞬间回调 onDone(没装语音包、引擎报错),
 * 不设下限就会变成"分析 → 秒回 → 立刻再分析"的连续请求。
 */
export function followUpDelay(lastRunAt: number, now: number, minGapMs: number): number {
  return Math.max(0, minGapMs - (now - lastRunAt));
}

/**
 * TTS 的兜底超时:按字数估算,上限 15 秒。
 *
 * 有些引擎不回调 onDone,不设兜底的话"正在播报"的标记会永久卡住,再也不分析。
 */
export function speechWatchdogMs(textLength: number): number {
  return Math.min(15000, textLength * 220 + 2500);
}
