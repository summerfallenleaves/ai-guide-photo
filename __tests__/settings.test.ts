import {
  DEFAULT_SETTINGS,
  liveAnalysisEnabled,
  liveIntervalMs,
  thinkingOf,
  type AppSettings,
} from '@/data/settings';

const base: AppSettings = { ...DEFAULT_SETTINGS };

describe('设置之间的依赖关系', () => {
  it('快速模式开 → 用 disabled(不思考),因为要快', () => {
    expect(thinkingOf({ ...base, fastMode: true })).toBe('disabled');
  });

  it('快速模式关 → 用 high(慢但质量高)', () => {
    expect(thinkingOf({ ...base, fastMode: false })).toBe('high');
  });

  it('自动分析需要快速模式作为前置', () => {
    // 会话由相机页按钮控制,这里只判断"有没有能力跑"(快速模式)
    expect(liveAnalysisEnabled({ ...base, fastMode: false })).toBe(false);
    expect(liveAnalysisEnabled({ ...base, fastMode: true })).toBe(true);
  });

  it('间隔毫秒数 = 秒数 × 1000', () => {
    expect(liveIntervalMs({ ...base, intervalSec: 3 })).toBe(3000);
    expect(liveIntervalMs({ ...base, intervalSec: 10 })).toBe(10000);
  });
});

describe('默认值', () => {
  it('默认开启快速模式和自动拍摄', () => {
    expect(DEFAULT_SETTINGS.fastMode).toBe(true);
    expect(DEFAULT_SETTINGS.autoCapture).toBe(true);
  });

  it('默认间隔 3 秒', () => {
    expect(DEFAULT_SETTINGS.intervalSec).toBe(3);
  });

  it('默认开启参数建议', () => {
    expect(DEFAULT_SETTINGS.paramAdvice).toBe(true);
  });

  it('默认走官方接口地址(空字符串)', () => {
    expect(DEFAULT_SETTINGS.apiEndpoint).toBe('');
  });
});
