import { composeAnalysisPrompt } from '@/domain/guidance/prompt';

const base = { scene: 'portrait' as const };

describe('composeAnalysisPrompt · 取景', () => {
  const text = composeAnalysisPrompt({
    ...base,
    mode: 'live',
    previousAdvice: {
      advice: { headline: '抬高', action: '把手机抬高约 20 厘米', dim: 'composition', scene: 'portrait' },
      repeat: 1,
    },
    sessionAdvice: '本次取景共 3 轮建议……',
    lastLiveSuggestion: { headline: '抬高', action: '抬高手机' },
    limits: { isoMin: 100, isoMax: 800, exposureMinNs: 1000, exposureMaxNs: 1e9 },
  });

  it('带场景标准与优先级', () => {
    expect(text).toContain('【当前场景:人像】');
    expect(text).toContain('判断优先级');
  });

  it('带上一轮建议(连续性)', () => {
    expect(text).toContain('把手机抬高约 20 厘米');
    expect(text).toContain('场景:人像');
  });

  it('不混入点评要素:会话摘要与硬件范围', () => {
    expect(text).not.toContain('本次取景共 3 轮建议');
    expect(text).not.toContain('当前相机的可调范围');
  });
});

describe('composeAnalysisPrompt · 点评', () => {
  const text = composeAnalysisPrompt({
    ...base,
    mode: 'capture',
    sessionAdvice: '本次取景共 3 轮建议,用户按此取景后拍摄:\n1. [构图] 抬高手机',
    lastLiveSuggestion: { headline: '抬高', action: '抬高手机' },
    limits: { isoMin: 100, isoMax: 800, exposureMinNs: 1000, exposureMaxNs: 1e9 },
  });

  it('带会话摘要和快门前的建议', () => {
    expect(text).toContain('本次取景共 3 轮建议');
    expect(text).toContain('抬高手机');
  });

  it('带场景分数锚点,不带取景示例', () => {
    expect(text).toContain('【本张照片按「人像」的标准点评】');
    expect(text).toContain('高分:');
    expect(text).not.toContain('→ 建议:');
  });

  it('带硬件范围', () => {
    expect(text).toContain('当前相机的可调范围:ISO 100~800');
  });

  it('不混入取景的连续性提示', () => {
    expect(text).not.toContain('上一轮你已经建议过');
  });
});

describe('composeAnalysisPrompt · 场景影响', () => {
  it('不同场景拼出不同的点评标准', () => {
    const portrait = composeAnalysisPrompt({ mode: 'capture', scene: 'portrait' });
    const landscape = composeAnalysisPrompt({ mode: 'capture', scene: 'landscape' });
    expect(portrait).toContain('眼神有光');
    expect(landscape).toContain('地平线平');
    expect(portrait).not.toBe(landscape);
  });

  it('没有场景时退回「其他」标准,不会报错', () => {
    const text = composeAnalysisPrompt({ mode: 'live' });
    expect(text).toContain('【当前场景:其他】');
  });
});
