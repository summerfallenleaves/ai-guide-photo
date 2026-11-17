import type { HistoryEntry } from './history';
import type { Dim } from './types';

/**
 * 拍照历史的本地统计。
 *
 * **完全在本地算,不调用 AI** —— 数据本来就在手里,
 * 把"单次点评"变成"这几天的趋势",不需要多花一分钱。
 */

export type DailyStat = {
  /** 当天零点的时间戳 */
  dayKey: number;
  /** 当天已点评张数的平均分;没有可算的为 null */
  average: number | null;
  count: number;
};

export type HistoryStats = {
  /** 总数(含还没点评成的) */
  total: number;
  /** 成功点评的张数 */
  analyzed: number;
  average: number | null;
  best: number | null;
  /** 结论分布 */
  verdicts: { keep: number; tweak: number; reshoot: number };
  /** 出现最多的需要改进的维度 */
  topDim: { dim: Dim; label: string; count: number } | null;
  /** 按天的平均分,从早到晚 */
  daily: DailyStat[];
};

function dayStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeHistoryStats(entries: HistoryEntry[], days = 7): HistoryStats {
  const verdicts = { keep: 0, tweak: 0, reshoot: 0 };
  const dimCounts = new Map<Dim, { label: string; count: number }>();
  const dayScores = new Map<number, number[]>();

  let analyzed = 0;
  let sum = 0;
  let best: number | null = null;

  for (const entry of entries) {
    const score = entry.status === 'done' ? entry.result?.score : undefined;

    if (typeof score === 'number' && Number.isFinite(score)) {
      analyzed += 1;
      sum += score;
      best = best === null ? score : Math.max(best, score);

      const key = dayStart(entry.createdAt);
      const bucket = dayScores.get(key);
      if (bucket) bucket.push(score);
      else dayScores.set(key, [score]);
    }

    const result = entry.status === 'done' ? entry.result : null;
    if (!result) continue;

    const verdict = result.verdict;
    if (verdict === 'keep' || verdict === 'tweak' || verdict === 'reshoot') {
      verdicts[verdict] += 1;
    }

    // 只有"需要改"的维度才算问题;keep 的维度不算通病
    if (verdict !== 'keep') {
      const prev = dimCounts.get(result.dim);
      if (prev) prev.count += 1;
      else dimCounts.set(result.dim, { label: result.dimLabel, count: 1 });
    }
  }

  let topDim: HistoryStats['topDim'] = null;
  for (const [dim, info] of dimCounts) {
    if (!topDim || info.count > topDim.count) {
      topDim = { dim, label: info.label, count: info.count };
    }
  }

  // 补齐最近 N 天(没有照片的那天也要占一格,趋势才不会跳)
  const today = dayStart(Date.now());
  const daily: DailyStat[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = today - i * 24 * 60 * 60 * 1000;
    const scores = dayScores.get(key) ?? [];
    daily.push({
      dayKey: key,
      count: scores.length,
      average: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    });
  }

  return {
    total: entries.length,
    analyzed,
    average: analyzed > 0 ? sum / analyzed : null,
    best,
    verdicts,
    topDim,
    daily,
  };
}
