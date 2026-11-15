import { Accelerometer } from 'expo-sensors';
import { useEffect, useState } from 'react';

/**
 * 用加速度计算手机左右倾角(度)。
 * 不依赖任何权限,也不消耗网络,是真正的"端侧实时"能力。
 *
 * 返回 null 表示当前姿态无法判断水平(比如手机接近平放做俯拍)。
 */
export function useTilt(active: boolean): number | null {
  const [tiltDeg, setTiltDeg] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setTiltDeg(null);
      return;
    }

    let mounted = true;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener(({ x, y }) => {
      if (!mounted) return;
      // y 分量接近 0:手机近乎平放,此时"水平"没有意义
      if (Math.abs(y) < 0.18) {
        setTiltDeg(null);
        return;
      }
      setTiltDeg((Math.atan2(x, y) * 180) / Math.PI);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [active]);

  return tiltDeg;
}
