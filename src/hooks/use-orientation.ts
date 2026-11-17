import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

export type OrientationMode = 'portrait' | 'landscape';

/**
 * 横竖屏控制。
 *
 * **不再强制切换方向**。以前点按钮会调 `lockAsync(LANDSCAPE)`,那会让系统把整个
 * 屏幕转 90°(连文字一起侧过来),用户会误以为是预览在转。
 *
 * 现在的行为:
 * - 默认跟随手机自动旋转(`app.json` 的 orientation 是 default)
 * - 点按钮 = 锁定在当前方向;再点 = 解除锁定,恢复跟随
 */
export function useOrientation() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const [locked, setLocked] = useState(false);

  const toggle = useCallback(async () => {
    try {
      if (locked) {
        await ScreenOrientation.unlockAsync();
        setLocked(false);
        return;
      }
      // 锁定到"当前实际方向",而不是强制切到另一个方向
      const current = await ScreenOrientation.getOrientationAsync();
      const target =
        current === ScreenOrientation.Orientation.PORTRAIT_UP
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : current === ScreenOrientation.Orientation.LANDSCAPE_LEFT
            ? ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
            : ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT;
      await ScreenOrientation.lockAsync(target);
      setLocked(true);
    } catch (err) {
      console.warn('[orientation] 锁定切换失败:', err);
    }
  }, [locked]);

  // 锁定时如果系统又把方向改了,以实际状态为准
  useEffect(() => {
    let alive = true;
    void ScreenOrientation.getOrientationLockAsync()
      .then((lock) => {
        if (alive) setLocked(lock !== ScreenOrientation.OrientationLock.DEFAULT);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return { isLandscape, locked, toggle };
}
