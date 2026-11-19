import { computeCropBox } from '@/lib/analysis-image';

/**
 * 裁切框公式。曾经把"已摆正的尺寸"又按横向存储反算了一次比例,
 * 导致竖着拍的照片被裁成一条横带(上下全丢)。这组测试锁死方向语义:
 * 传进来的宽高就是屏幕上看到的方向。
 */
describe('computeCropBox', () => {
  it('比例一致时不裁', () => {
    expect(computeCropBox(1080, 2400, 0.45)).toBeNull();
  });

  it('差得很小时也不裁(避免重编码)', () => {
    expect(computeCropBox(1080, 2400, 0.4505)).toBeNull();
  });

  it('竖图要更窄:砍上下,宽度保留', () => {
    // 1080×2400 → 目标 0.5625,应是 1080×1920,上下各去 240
    const box = computeCropBox(1080, 2400, 0.5625);
    expect(box).toEqual({ originX: 0, originY: 240, width: 1080, height: 1920 });
  });

  it('横图要更窄:砍左右,高度保留', () => {
    // 4000×3000 → 目标 0.5625,应是 1687×3000
    const box = computeCropBox(4000, 3000, 0.5625);
    expect(box).toEqual({ originX: 1156, originY: 0, width: 1688, height: 3000 });
  });

  it('竖图裁成方形:砍上下', () => {
    const box = computeCropBox(1080, 2400, 1);
    expect(box).toEqual({ originX: 0, originY: 660, width: 1080, height: 1080 });
  });

  it('非法比例返回 null', () => {
    expect(computeCropBox(1080, 2400, 0)).toBeNull();
    expect(computeCropBox(1080, 2400, Number.NaN)).toBeNull();
    expect(computeCropBox(0, 2400, 0.5)).toBeNull();
  });

  it('真实回归:竖拍 0.45 不能被裁成横向 2.222', () => {
    const box = computeCropBox(1216, 2688, 0.4524);
    // 比例已一致,不该裁
    expect(box).toBeNull();
  });
});
