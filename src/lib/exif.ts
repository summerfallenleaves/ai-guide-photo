/**
 * 从相机回来的 EXIF 里提取"能用来做拍摄建议"的光学参数。
 *
 * 两个平台的键名不一样(Android 用标准 EXIF 标签,iOS 用 Apple 的缩写),
 * 而且不同厂商给不给这些字段也不确定,所以全部做容错取值。
 */
export type PhotoMeta = {
  /** 等效焦距(mm) */
  focalLength35?: number;
  /** 实际焦距(mm) */
  focalLength?: number;
  /** 光圈 */
  fNumber?: number;
  /** 感光度 */
  iso?: number;
  /** 快门速度(秒) */
  exposureTime?: number;
  /** 是否触发闪光 */
  flashFired?: boolean;
  /** 镜头型号 */
  lensModel?: string;
  /** 设备型号 */
  device?: string;
};

function pick(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    // 可能是 "1/60" 这样的分数
    const frac = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (frac) {
      const n = Number(frac[1]) / Number(frac[2]);
      return Number.isFinite(n) ? n : undefined;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (Array.isArray(v) && v.length > 0) return toNumber(v[0]);
  return undefined;
}

function toText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function extractPhotoMeta(exif: unknown): PhotoMeta | null {
  if (!exif || typeof exif !== 'object') return null;
  const raw = exif as Record<string, unknown>;

  const meta: PhotoMeta = {
    focalLength35: toNumber(pick(raw, ['FocalLengthIn35mmFilm', 'FocalLenIn35mmFilm'])),
    focalLength: toNumber(pick(raw, ['FocalLength'])),
    fNumber: toNumber(pick(raw, ['FNumber', 'ApertureValue'])),
    iso: toNumber(pick(raw, ['ISOSpeedRatings', 'PhotographicSensitivity', 'ISO'])),
    exposureTime: toNumber(pick(raw, ['ExposureTime'])),
    lensModel: toText(pick(raw, ['LensModel', 'LensMake'])),
    device: toText(pick(raw, ['Model'])),
  };

  const flash = toNumber(pick(raw, ['Flash']));
  if (flash !== undefined) meta.flashFired = (flash & 1) === 1;

  // 一个有用的字段都没有就当没拿到
  const hasAny = Object.values(meta).some((v) => v !== undefined);
  return hasAny ? meta : null;
}

export function formatExposure(t: number): string {
  if (t <= 0) return '未知';
  if (t >= 1) return `${Number(t.toFixed(1))}s`;
  return `1/${Math.round(1 / t)}s`;
}

export function formatFocalLength(meta: PhotoMeta): string | undefined {
  if (meta.focalLength35) return `${Math.round(meta.focalLength35)}mm`;
  if (meta.focalLength) return `${meta.focalLength.toFixed(1)}mm`;
  return undefined;
}

/** 给 UI 用的紧凑一行,例如 `26mm · f/1.8 · ISO 400 · 1/60s` */
export function formatMeta(meta: PhotoMeta | null | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];
  const focal = formatFocalLength(meta);
  if (focal) parts.push(focal);
  if (meta.fNumber) parts.push(`f/${Number(meta.fNumber.toFixed(1))}`);
  if (meta.iso) parts.push(`ISO ${Math.round(meta.iso)}`);
  if (meta.exposureTime) parts.push(formatExposure(meta.exposureTime));
  return parts.join(' · ');
}

/** 给 prompt 用的多行描述 */
export function describeMeta(meta: PhotoMeta | null | undefined): string {
  if (!meta) return '';
  const lines: string[] = [];
  const focal = formatFocalLength(meta);
  if (focal) {
    const detail =
      meta.focalLength35 && meta.focalLength
        ? `${focal}(实际 ${meta.focalLength.toFixed(1)}mm)`
        : focal;
    lines.push(`- 焦距:${detail}`);
  }
  if (meta.fNumber) lines.push(`- 光圈:f/${Number(meta.fNumber.toFixed(1))}`);
  if (meta.iso) lines.push(`- 感光度:ISO ${Math.round(meta.iso)}`);
  if (meta.exposureTime) lines.push(`- 快门:${formatExposure(meta.exposureTime)}`);
  if (meta.flashFired !== undefined) lines.push(`- 闪光灯:${meta.flashFired ? '已触发' : '未触发'}`);
  if (meta.lensModel) lines.push(`- 镜头:${meta.lensModel}`);
  return lines.join('\n');
}
