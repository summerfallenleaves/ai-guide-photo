import {
  cctFromAwbGains,
  cctToChromaticity,
  gainsFromKelvin,
  invert3x3,
} from '../src/lib/white-balance';

describe('色温 → 色度坐标', () => {
  it('6500K 落在 D65 附近', () => {
    const { x, y } = cctToChromaticity(6500);
    expect(x).toBeCloseTo(0.3127, 1);
    expect(y).toBeCloseTo(0.329, 1);
  });

  it('色温越高,x 越小(越偏蓝)', () => {
    const low = cctToChromaticity(3000);
    const high = cctToChromaticity(8000);
    expect(high.x).toBeLessThan(low.x);
  });

  it('全部落在可见色域内(0~1 且和为有效值)', () => {
    for (const k of [2500, 3000, 4000, 5000, 6500, 8000]) {
      const { x, y } = cctToChromaticity(k);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      expect(x + y).toBeLessThan(1);
    }
  });
});

describe('色温 → RGB 增益', () => {
  it('暖光(低色温)要压低红色、抬高蓝色,画面才会变冷', () => {
    // 告诉相机"光源是 3000K"→ 它会把多余的暖色压掉,画面偏蓝
    const warm = gainsFromKelvin(null, 3000);
    const neutral = gainsFromKelvin(null, 6500);
    expect(warm.r).toBeLessThan(neutral.r);
    expect(warm.b).toBeGreaterThan(neutral.b);
  });

  it('增益夹在 0.35~2.8 之间,不会算出离谱值', () => {
    for (const k of [2500, 3000, 4000, 5500, 6500, 8000]) {
      const g = gainsFromKelvin(null, k);
      expect(g.r).toBeGreaterThanOrEqual(0.35);
      expect(g.r).toBeLessThanOrEqual(2.8);
      expect(g.b).toBeGreaterThanOrEqual(0.35);
      expect(g.b).toBeLessThanOrEqual(2.8);
    }
  });

  it('超出范围时按边界处理,不抛错', () => {
    expect(() => gainsFromKelvin(null, 100)).not.toThrow();
    expect(() => gainsFromKelvin(null, 99999)).not.toThrow();
  });
});

describe('AWB 增益 → 场景色温(标定用的反向推导)', () => {
  it.each([3000, 4000, 5000, 6500, 7500])('正反变换能回到 %dK 附近', (kelvin) => {
    const g = gainsFromKelvin(null, kelvin);
    const roundTrip = cctFromAwbGains(null, g.r, 1, g.b);
    expect(roundTrip).not.toBeNull();
    expect(Math.abs((roundTrip as number) - kelvin)).toBeLessThan(400);
  });

  it('非法增益返回 null,而不是 NaN', () => {
    expect(cctFromAwbGains(null, 0, 1, 1)).toBeNull();
    expect(cctFromAwbGains(null, -1, 1, 1)).toBeNull();
  });
});

describe('3x3 求逆', () => {
  it('单位矩阵求逆还是单位矩阵', () => {
    expect(invert3x3([1, 0, 0, 0, 1, 0, 0, 0, 1])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('奇异矩阵返回 null', () => {
    expect(invert3x3([1, 2, 3, 2, 4, 6, 7, 8, 9])).toBeNull();
  });

  it('与原矩阵相乘得到单位矩阵', () => {
    const m = [2, 1, 0, 1, 3, 1, 0, 1, 2];
    const inv = invert3x3(m)!;
    expect(inv).not.toBeNull();
    const mul = (a: number[], b: number[], r: number, c: number) =>
      a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        expect(mul(m, inv, r, c)).toBeCloseTo(r === c ? 1 : 0, 6);
      }
    }
  });
});
