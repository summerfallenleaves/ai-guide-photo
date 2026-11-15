import type { CameraCapturedPicture } from 'expo-camera';
import { useCallback, useRef } from 'react';

/**
 * 串行化 takePictureAsync。
 *
 * 为什么需要:`expo-camera` 同一时刻只允许一次拍摄调用。实时分析每 3 秒要抓一帧,
 * 如果用户这时按快门,两次调用会撞车。用一条 Promise 链让它们排队——
 * 快门最多等一次快照(约 200ms),而不是等整个网络往返(1~2 秒)。
 *
 * 关键点:**锁只包住 takePictureAsync 本身,不包住后面的网络请求。**
 */
export function useCameraLock() {
  const tail = useRef<Promise<void>>(Promise.resolve());

  return useCallback(async (fn: () => Promise<CameraCapturedPicture>): Promise<CameraCapturedPicture> => {
    const prev = tail.current;
    let release!: () => void;
    tail.current = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }, []);
}
