import { Accelerometer } from 'expo-sensors';
import { useEffect, useState } from 'react';

/**
 * 用加速度计算手机绕镜头轴的倾角(度),用来判断"地平线是否水平"。
 *
 * 关键:横竖屏都能用。
 * - 竖握时,画面的水平线对应设备的 y 轴,倾角看 x 分量 → atan2(x, |y|)
 * - 横握时,画面的水平线对应设备的 x 轴,倾角看 y 分量 → atan2(y, |x|)
 *
 * 用 |x| / |y| 谁大来自动判断当前是横还是竖,不需要外部告诉它屏幕方向,
 * 也能兼容"横着拿但往左倒"和"往右倒"两种姿态。
 *
 * 返回 null 表示无法判断(手机近乎平放做俯拍)。
 */
export function useTilt(active: boolean): number | null {
  const [rawTilt, setRawTilt] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;

    let mounted = true;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener(({ x, y }) => {
      if (!mounted) return;

      const absX = Math.abs(x);
      const absY = Math.abs(y);

      // 两个水平轴都很小 → 手机接近平放,水平仪没有意义
      if (Math.hypot(x, y) < 0.18) {
        setRawTilt(null);
        return;
      }

      const deg =
        absX >= absY
          ? (Math.atan2(y, absX) * 180) / Math.PI // 横握
          : (Math.atan2(x, absY) * 180) / Math.PI; // 竖握
      setRawTilt(deg);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [active]);

  // 不监听时直接返回 null,避免在 effect 里同步 setState
  return active ? rawTilt : null;
}
