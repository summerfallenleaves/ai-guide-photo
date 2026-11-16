/**
 * 白平衡相关计算。
 *
 * 两套映射写在一起,方便对照:
 * - 正向:给定色温 K → 相机该用的 RGB 增益(下发手动白平衡用)
 * - 反向:给定相机 AWB 算出的增益 → 反推它认为的场景色温(标定用)
 *
 * 核心前提:相机不是 sRGB 原色,必须用 SENSOR_COLOR_TRANSFORM1(传感器 RGB→XYZ)做转换。
 */

type Vec3 = [number, number, number];

/** 传感器 RGB → XYZ 的 3x3 矩阵(行优先 9 个数) */
export type ColorMatrix = number[];

function applyMatrix(m: ColorMatrix, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function invert3x3(m: ColorMatrix): ColorMatrix | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const k = 1 / det;
  return [
    (e * i - f * h) * k,
    (c * h - b * i) * k,
    (b * f - c * e) * k,
    (f * g - d * i) * k,
    (a * i - c * g) * k,
    (c * d - a * f) * k,
    (d * h - e * g) * k,
    (b * g - a * h) * k,
    (a * e - b * d) * k,
  ];
}

/** CCT → 普朗克轨迹色度坐标(Kim et al. 拟合) */
export function cctToChromaticity(t: number): { x: number; y: number } {
  const x =
    t <= 4000
      ? -0.2661239e9 / (t * t * t) - 0.2343589e6 / (t * t) + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / (t * t * t) + 2.1070379e6 / (t * t) + 0.2226347e3 / t + 0.24039;
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return { x, y };
}

const SRGB_FROM_XYZ: ColorMatrix = [
  3.2406, -1.5372, -0.4986,
  -0.9689, 1.8758, 0.0415,
  0.0557, -0.204, 1.057,
];

function xyzToSensorRgb(matrix: ColorMatrix | null | undefined, xyz: Vec3): Vec3 {
  const inv = matrix && matrix.length === 9 ? invert3x3(matrix) : null;
  return applyMatrix(inv ?? SRGB_FROM_XYZ, xyz);
}

/** 给定色温,算出应下发的 R/B 增益(绿色恒为 1) */
export function gainsFromKelvin(
  matrix: ColorMatrix | null | undefined,
  kelvin: number,
): { r: number; b: number } {
  const k = Math.min(8000, Math.max(2500, kelvin));
  const { x, y } = cctToChromaticity(k);
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;
  const [r, g, b] = xyzToSensorRgb(matrix, [X, Y, Z]);
  const rr = Math.max(r, 1e-4);
  const gg = Math.max(g, 1e-4);
  const bb = Math.max(b, 1e-4);
  return {
    r: Math.min(2.8, Math.max(0.35, gg / rr)),
    b: Math.min(2.8, Math.max(0.35, gg / bb)),
  };
}

/**
 * 由 AWB 增益反推场景色温。
 *
 * AWB 增益 g 会乘到传感器读数上,使画面中灰变为中性,
 * 所以场景的中性色点在传感器空间里正比于 1/g。换到 XYZ → 色度 → McCamy 公式求色温。
 */
export function cctFromAwbGains(
  matrix: ColorMatrix | null | undefined,
  gR: number,
  gG: number,
  gB: number,
): number | null {
  if (!(gR > 0 && gG > 0 && gB > 0)) return null;
  const q: Vec3 = [1 / gR, 1 / gG, 1 / gB];
  const forward = matrix && matrix.length === 9 ? matrix : SRGB_FROM_XYZ;
  const [X, Y, Z] = applyMatrix(forward, q);
  const sum = X + Y + Z;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  const x = X / sum;
  const y = Y / sum;
  if (Math.abs(0.1858 - y) < 1e-6) return null;

  const n = (x - 0.332) / (0.1858 - y);
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  if (!Number.isFinite(cct) || cct < 1000 || cct > 20000) return null;
  return cct;
}
