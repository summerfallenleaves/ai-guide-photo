import { computeHistoryStats } from '@/domain/guidance/history-stats';
import type { HistoryEntry } from '@/data/history';

jest.mock('expo-file-system', () => ({}));

const DAY = 24 * 60 * 60 * 1000;

function entry(
  createdAt: number,
  opts: { score?: number; dim?: string; label?: string; verdict?: string; status?: string } = {},
): HistoryEntry {
  const status = opts.status ?? 'done';
  const base = {
    id: String(createdAt),
    uri: `file:///tmp/${createdAt}.jpg`,
    createdAt,
    savedToAlbum: true,
    status,
  } as HistoryEntry;
  if (status !== 'done') return base;
  return {
    ...base,
    result: {
      mode: 'capture',
      score: opts.score ?? 70,
      verdict: (opts.verdict ?? 'tweak') as never,
      strengths: [],
      headline: 'h',
      dim: (opts.dim ?? 'light') as never,
      dimLabel: opts.label ?? '光线',
      improvements: [],
      params: null,
      confidence: 0.7,
      source: 'deepseek',
    },
  } as HistoryEntry;
}

describe('computeHistoryStats', () => {
  it('空历史不会崩,平均分为 null', () => {
    const s = computeHistoryStats([]);
    expect(s.total).toBe(0);
    expect(s.average).toBeNull();
    expect(s.best).toBeNull();
    expect(s.daily).toHaveLength(7);
    expect(s.daily.every((d) => d.average === null)).toBe(true);
  });

  it('平均分只算已点评的,没点评的不拉低分数', () => {
    const now = Date.now();
    const s = computeHistoryStats([
      entry(now, { score: 80 }),
      entry(now - 1000, { score: 90 }),
      entry(now - 2000, { status: 'failed' }),
      entry(now - 3000, { status: 'analyzing' }),
    ]);
    expect(s.total).toBe(4);
    expect(s.analyzed).toBe(2);
    expect(s.average).toBe(85);
    expect(s.best).toBe(90);
  });

  it('统计 verdict 分布', () => {
    const now = Date.now();
    const s = computeHistoryStats([
      entry(now, { verdict: 'keep' }),
      entry(now - 1, { verdict: 'tweak' }),
      entry(now - 2, { verdict: 'tweak' }),
      entry(now - 3, { verdict: 'reshoot' }),
    ]);
    expect(s.verdicts).toEqual({ keep: 1, tweak: 2, reshoot: 1 });
  });

  it('通病维度只统计需要改的(keep 不算)', () => {
    const now = Date.now();
    const s = computeHistoryStats([
      entry(now, { dim: 'light', label: '光线', verdict: 'tweak' }),
      entry(now - 1, { dim: 'light', label: '光线', verdict: 'reshoot' }),
      entry(now - 2, { dim: 'composition', label: '构图', verdict: 'keep' }),
      entry(now - 3, { dim: 'background', label: '背景', verdict: 'tweak' }),
    ]);
    expect(s.topDim).toEqual({ dim: 'light', label: '光线', count: 2 });
  });

  it('按天聚合,没有照片的那天占位为空', () => {
    const now = Date.now();
    const s = computeHistoryStats([
      entry(now, { score: 80 }),
      entry(now, { score: 90 }),
      entry(now - DAY, { score: 60 }),
    ]);
    expect(s.daily).toHaveLength(7);
    const last = s.daily[6];
    expect(last.average).toBe(85);
    expect(last.count).toBe(2);
    expect(s.daily[5].average).toBe(60);
    expect(s.daily[0].average).toBeNull();
  });
});
