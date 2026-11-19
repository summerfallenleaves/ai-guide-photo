import { useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import { focusAt, setZoom as setZoomNative, type Camera2CapsFull } from '@/lib/native-camera2';

/** 对焦框显示时长 */
const FOCUS_RING_MS = 1200;

export type PreviewGesturesDeps = {
  /** 相机硬件能力(读最大变焦倍数) */
  capsRef: { current: Camera2CapsFull | null };
  /** 取景矩形:点按坐标要按它归一化,否则有黑边时会偏 */
  rectRef: { current: { x: number; y: number; width: number; height: number } };
  onZoomChange: (zoom: number) => void;
  onFocusRing: (point: { x: number; y: number } | null) => void;
};

/**
 * 取景层的手势:双指缩放 + 点按对焦。
 *
 * 抽出来的原因:这两个手势必须在回调里读写 ref(caps、取景矩形、上次下发的倍率),
 * 放在页面里会让 `index.tsx` 混进 React Compiler 的豁免注释。
 * 隔离到自己的模块后,豁免范围收窄到这一个文件。
 */
export function usePreviewGestures(deps: PreviewGesturesDeps) {
  const { capsRef, rectRef, onZoomChange, onFocusRing } = deps;

  const zoomRef = useRef(1);
  const pinchedFromRef = useRef(1);
  const sentRef = useRef(1);

  /* eslint-disable react-hooks/refs --
     手势回调在用户操作时执行,不是渲染期访问 ref。
     React Compiler 无法建模 Gesture API 的调用时机,这里显式豁免。 */
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onBegin(() => {
          pinchedFromRef.current = zoomRef.current;
        })
        .onUpdate((event) => {
          const max = capsRef.current?.maxZoom ?? 4;
          const next = Math.min(max, Math.max(1, pinchedFromRef.current * event.scale));
          if (Math.abs(next - zoomRef.current) <= 0.02) return;
          zoomRef.current = next;
          onZoomChange(next);
          // 只在变化超过 5% 时才下发,避免每帧都重建捕获请求
          if (Math.abs(next - sentRef.current) > 0.05) {
            sentRef.current = next;
            setZoomNative(next);
          }
        }),
    [capsRef, onZoomChange],
  );

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((event) => {
          const rect = rectRef.current;
          if (!rect.width || !rect.height) return;
          const nx = Math.min(1, Math.max(0, (event.x - rect.x) / rect.width));
          const ny = Math.min(1, Math.max(0, (event.y - rect.y) / rect.height));
          focusAt(nx, ny);
          onFocusRing({ x: event.x, y: event.y });
          setTimeout(() => onFocusRing(null), FOCUS_RING_MS);
        }),
    [rectRef, onFocusRing],
  );

  const previewGesture = useMemo(() => Gesture.Simultaneous(pinch, tap), [pinch, tap]);
  /* eslint-enable react-hooks/refs */

  return { previewGesture };
}
