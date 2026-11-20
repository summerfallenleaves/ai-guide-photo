/**
 * 点评结果的解析与一致性兜底。
 *
 * 这组测试保护的是"点评是否诚实"的产品约束:
 * verdict 与 score 必须自洽、keep 不许硬凑改进项、keep 不许再给参数。
 */

jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));

type DeepSeekModule = typeof import('@/infra/ai/client');

function load(): DeepSeekModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/domain/guidance/scoring') as DeepSeekModule;
}

function capture(payload: Record<string, unknown>) {
  const mod = load();
  const parsed = (mod as unknown as {
    __normalize: (p: Record<string, unknown>, isCapture: boolean) => unknown;
  }).__normalize;
  return parsed(payload, true) as {
    score: number;
    verdict: string;
    strengths: string[];
    improvements: string[];
    params: unknown;
  };
}

describe('verdict 与分数必须自洽', () => {
  it('分数 ≥85 但模型给了 tweak → 保留 tweak(声明优先,除非明显矛盾)', () => {
    expect(capture({ score: 88, verdict: 'tweak' }).verdict).toBe('tweak');
  });

  it('说 keep 但分数只有 60 → 纠正为 tweak', () => {
    expect(capture({ score: 60, verdict: 'keep' }).verdict).toBe('tweak');
  });

  it('说 reshoot 但分数 80 → 纠正为 tweak', () => {
    expect(capture({ score: 80, verdict: 'reshoot' }).verdict).toBe('tweak');
  });

  it('没给 verdict 时按分数推断', () => {
    expect(capture({ score: 92 }).verdict).toBe('keep');
    expect(capture({ score: 70 }).verdict).toBe('tweak');
    expect(capture({ score: 40 }).verdict).toBe('reshoot');
  });

  it('分数缺失时默认 60 → tweak', () => {
    expect(capture({}).verdict).toBe('tweak');
  });
});

describe('keep 不许硬凑', () => {
  it('keep 时改进项最多保留 1 条', () => {
    const r = capture({
      score: 92,
      verdict: 'keep',
      improvements: ['a', 'b', 'c'],
    });
    expect(r.improvements).toHaveLength(1);
  });

  it('keep 时丢弃模型给的参数(避免"很好但也改 ISO")', () => {
    const r = capture({
      score: 92,
      verdict: 'keep',
      params: { iso: 200, shutter: '1/250' },
    });
    expect(r.params).toBeNull();
  });

  it('tweak 时最多 2 条,reshoot 最多 3 条', () => {
    const tweak = capture({ score: 70, verdict: 'tweak', improvements: ['a', 'b', 'c'] });
    expect(tweak.improvements).toHaveLength(2);
    const reshoot = capture({ score: 40, verdict: 'reshoot', improvements: ['a', 'b', 'c', 'd'] });
    expect(reshoot.improvements).toHaveLength(3);
  });
});

describe('strengths', () => {
  it('最多保留 2 条,并过滤空白', () => {
    const r = capture({ score: 80, strengths: ['光很好', '  ', '构图稳', '第三条'] });
    expect(r.strengths).toEqual(['光很好', '构图稳']);
  });

  it('缺失时是空数组,不会崩', () => {
    expect(capture({ score: 80 }).strengths).toEqual([]);
  });
});
