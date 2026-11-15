import * as ScreenOrientation from 'expo-screen-orientation';
import { useCallback } from 'react';
import { useWindowDimensions } from 'react-native';

export type OrientationMode = 'portrait' | 'landscape';

/**
 * 横竖屏控制。
 *
 * 策略是 A+B:
 * - A:`app.json` 里 orientation 设为 `default`,没按过按钮时跟随系统自动旋转;
 * - B:按钮强制切换。用 `LANDSCAPE`(而不是 LEFT/RIGHT)让系统按你实际握持方向
 *   决定倒向哪边,避免文字上下颠倒。
 *
 * 判断当前方向用窗口宽高比,比读屏幕方向事件的竞态更少。
 */
export function useOrientation() {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const toggle = useCallback(async () => {
    const next: OrientationMode = isLandscape ? 'portrait' : 'landscape';
    try {
      await ScreenOrientation.lockAsync(
        next === 'landscape'
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    } catch (err) {
      console.warn('[orientation] 切换失败:', err);
    }
  }, [isLandscape]);

  return { isLandscape, toggle };
}
