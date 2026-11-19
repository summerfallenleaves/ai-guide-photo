import { useCallback, useEffect, useState } from 'react';

export type ShutterTimer = {
  /** 定时器档位:0 = 关闭,3 / 10 秒 */
  seconds: number;
  /** 正在倒计时时的剩余秒数,null 表示没在倒计时 */
  countdown: number | null;
  /** 切换档位:关 → 3s → 10s → 关 */
  cycle: () => void;
  /** 快门入口:定时器开着就先倒计时,否则直接拍 */
  press: () => void;
  /** 取消倒计时 */
  cancel: () => void;
};

const STEPS = [0, 3, 10] as const;

/**
 * 定时快门。
 *
 * 倒计时用 setTimeout 递归而不是 setInterval:每秒重设一次能让
 * "点任意处取消"立刻生效,也不会有多个计时器叠在一起。
 */
export function useShutterTimer(onFire: () => void): ShutterTimer {
  const [seconds, setSeconds] = useState<number>(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  const cycle = useCallback(() => {
    setSeconds((prev) => {
      const index = STEPS.indexOf(prev as (typeof STEPS)[number]);
      return STEPS[(index + 1) % STEPS.length];
    });
  }, []);

  const cancel = useCallback(() => setCountdown(null), []);

  const press = useCallback(() => {
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (seconds > 0) {
      setCountdown(seconds);
      return;
    }
    onFire();
  }, [countdown, seconds, onFire]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      // 放到下一个任务里执行,避免在 effect 里同步 setState
      const done = setTimeout(() => {
        setCountdown(null);
        onFire();
      }, 0);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onFire]);

  return { seconds, countdown, cycle, press, cancel };
}
