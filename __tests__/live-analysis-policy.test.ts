import {
  analysisTickMs,
  canRunAnalysis,
  followUpDelay,
  MAX_CONSECUTIVE_FAILURES,
  onAnalysisFailure,
  shouldScheduleAnalysis,
  speechWatchdogMs,
  type AnalyzeGate,
} from '../src/lib/live-analysis-policy';

const base: AnalyzeGate = {
  liveOn: true,
  paused: false,
  cameraReady: true,
  hasApiKey: true,
  hasPermission: true,
  busy: false,
  blocked: false,
};

describe('canRunAnalysis', () => {
  it('都满足时能跑', () => {
    expect(canRunAnalysis(base)).toBe(true);
  });

  it.each([
    ['自动分析关闭', { liveOn: false }],
    ['连续失败已暂停', { paused: true }],
    ['相机没就绪', { cameraReady: false }],
    ['没有 API Key', { hasApiKey: false }],
    ['没有相机权限', { hasPermission: false }],
    ['上一轮还在跑', { busy: true }],
    ['语音正在播报', { blocked: true }],
  ])('%s 就不跑', (_label, patch) => {
    expect(canRunAnalysis({ ...base, ...patch })).toBe(false);
  });
});

describe('shouldScheduleAnalysis', () => {
  const foreground = { active: true, focused: true, appActive: true };

  it('前台且聚焦时挂定时器', () => {
    expect(shouldScheduleAnalysis(base, foreground)).toBe(true);
  });

  it('退到后台 / 离开页面时不挂', () => {
    expect(shouldScheduleAnalysis(base, { ...foreground, appActive: false })).toBe(false);
    expect(shouldScheduleAnalysis(base, { ...foreground, focused: false })).toBe(false);
  });

  it('暂停或关闭时不挂', () => {
    expect(shouldScheduleAnalysis({ ...base, paused: true }, foreground)).toBe(false);
    expect(shouldScheduleAnalysis({ ...base, liveOn: false }, foreground)).toBe(false);
  });
});

describe('onAnalysisFailure', () => {
  it('前台失败会累加', () => {
    expect(onAnalysisFailure(0, true)).toEqual({ count: 1, pause: false, counts: true });
    expect(onAnalysisFailure(1, true)).toEqual({ count: 2, pause: false, counts: true });
  });

  it('连续三次后暂停', () => {
    expect(onAnalysisFailure(2, true)).toEqual({
      count: MAX_CONSECUTIVE_FAILURES,
      pause: true,
      counts: true,
    });
  });

  it('后台期间的失败不计入,也不会暂停', () => {
    expect(onAnalysisFailure(2, false)).toEqual({ count: 2, pause: false, counts: false });
  });
});

describe('analysisTickMs', () => {
  it('普通模式按设置间隔', () => {
    expect(analysisTickMs(false, 3, 10000)).toBe(3000);
    expect(analysisTickMs(false, 10, 10000)).toBe(10000);
  });

  it('语音模式下配置的间隔不生效,用兜底周期', () => {
    expect(analysisTickMs(true, 3, 10000)).toBe(10000);
  });
});

describe('followUpDelay', () => {
  it('离上次分析够久了就立刻跑', () => {
    expect(followUpDelay(0, 5000, 1500)).toBe(0);
  });

  it('太近就等剩下的时间', () => {
    expect(followUpDelay(4000, 4500, 1500)).toBe(1000);
  });
});

describe('speechWatchdogMs', () => {
  it('按字数估算,并且有上限', () => {
    expect(speechWatchdogMs(0)).toBe(2500);
    expect(speechWatchdogMs(10)).toBe(4700);
    expect(speechWatchdogMs(1000)).toBe(15000);
  });
});
