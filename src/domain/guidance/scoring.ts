/**
 * 模型返回内容的清洗与兜底。
 *
 * 纯函数,导出供测试直接验证 —— 模型偶尔会漏字段、给非法枚举、
 * 或者"说很好又挑三拣四",这些规则都在这里收拾。
 */
import type { AdjustParams, AnalyzeOutcome, CaptureVerdict, Dim } from '@/domain/shared/types';

/** 维度的中文标签,复盘摘要和卡片都用它 */
export const DIM_LABELS: Record<Dim, string> = {
  composition: '构图',
  light: '光线',
  pose: '人物',
  background: '背景',
  settings: '参数',
};

/** 纯函数,导出供测试直接验证解析规则 */
export function __normalize(p: Record<string, unknown>, isCapture: boolean): AnalyzeOutcome {
  const dimValue = typeof p.dim === 'string' ? p.dim : '';
  const dim: Dim = (Object.keys(DIM_LABELS) as Dim[]).includes(dimValue as Dim)
    ? (dimValue as Dim)
    : 'composition';

  if (isCapture) {
    const rawScore = Number(p.score);
    const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 60;
    const verdict = normalizeVerdict(p.verdict, score);
    const strengths = Array.isArray(p.strengths)
      ? p.strengths.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 2).map((x) => clip(x, 40))
      : [];
    const allImprovements = Array.isArray(p.improvements)
      ? p.improvements.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 3).map((x) => clip(x, 40))
      : [];
    // 条数跟着 verdict 走:keep 最多 1 条,防止模型"说好又挑刺"
    const maxImprovements = verdict === 'keep' ? 1 : verdict === 'tweak' ? 2 : 3;
    const improvements = allImprovements.slice(0, maxImprovements);

    return {
      mode: 'capture',
      score,
      verdict,
      strengths,
      headline: clip(p.headline, 20) || (verdict === 'keep' ? '这张可以了' : '还行,可以更好'),
      dim,
      dimLabel: DIM_LABELS[dim],
      improvements,
      // keep 就不给参数,避免"很好但也建议改 ISO"这种自相矛盾
      params: verdict === 'keep' ? null : normalizeParams(p.params),
      confidence: clamp01(p.confidence, 0.6),
      source: 'deepseek',
    };
  }

  const headline = clip(p.headline, 14) || '调整一下试试';
  return {
    mode: 'live',
    dim,
    dimLabel: DIM_LABELS[dim],
    headline,
    action: clip(p.action, 40) || '换一个角度再取景',
    reason: clip(p.reason, 30),
    // 模型没给布尔值时,退回看标题是不是"可以拍了"
    readyToShoot: p.readyToShoot === true || headline.includes('可以拍了'),
    confidence: clamp01(p.confidence, 0.6),
    source: 'deepseek',
  };
}

/** verdict 兜底:模型漏给或给了非法值时,按分数推断,保证前后自洽 */
function normalizeVerdict(raw: unknown, score: number): CaptureVerdict {
  if (raw === 'keep' || raw === 'tweak' || raw === 'reshoot') {
    // 和分数明显矛盾时以分数为准
    if (raw === 'keep' && score < 80) return 'tweak';
    if (raw === 'reshoot' && score >= 75) return 'tweak';
    return raw;
  }
  if (score >= 85) return 'keep';
  if (score >= 60) return 'tweak';
  return 'reshoot';
}

/** 解析并清洗模型给的可执行参数;全空就返回 null */
function normalizeParams(raw: unknown): AdjustParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: AdjustParams = {};
  const iso = Number(o.iso);
  if (Number.isFinite(iso) && iso > 0) out.iso = Math.round(iso);
  if (typeof o.shutter === 'string' && o.shutter.trim()) out.shutter = o.shutter.trim();
  else if (Number.isFinite(Number(o.shutter)) && Number(o.shutter) > 0) out.shutter = String(o.shutter);
  const wb = Number(o.wb);
  if (Number.isFinite(wb) && wb >= 2000 && wb <= 10000) out.wb = Math.round(wb);
  const focus = Number(o.focusMeters);
  if (Number.isFinite(focus) && focus > 0) out.focusMeters = focus;
  return Object.keys(out).length > 0 ? out : null;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

