import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { mirrorForFront, toAnalysisBase64 } from '@/lib/analysis-image';
import { analyze } from '@/lib/api';
import { setLastCapture, setReviewState } from '@/lib/capture-store';
import type { CameraLimits } from '@/lib/deepseek';
import type { PhotoMeta } from '@/lib/exif';
import { addHistoryEntry, loadHistory, persistPhoto, updateHistoryEntry } from '@/lib/history';
import { saveToAlbum } from '@/lib/media';
import { takePicture } from '@/lib/native-camera2';

export type CaptureFlowDeps = {
  cameraReady: boolean;
  /** 当前是不是前置摄像头 —— 前置要把照片镜像成预览的样子 */
  isFront: boolean;
  hasApiKey: boolean;
  apiEndpoint: string;
  thinking: 'disabled' | 'high';
  meta: () => PhotoMeta | null;
  limits: () => CameraLimits | undefined;
  /** 快门前的最后一条建议,点评时用来对照"用户有没有照做" */
  getLastSuggestion: () => { headline: string; action: string } | null;
  onError: (message: string) => void;
  /** 快门闪光动画的驱动值 */
  flash: Animated.Value;
};

export type CaptureFlow = {
  capturing: boolean;
  /** 拍一张:存相册 → 进复盘页 → 后台跑点评 */
  capture: () => Promise<void>;
};

/**
 * 拍照到点评的完整链路。
 *
 * 顺序是刻意的:**照片先落地并立刻进复盘页**,点评在后台跑。
 * 用户不应该为了等 AI 而盯着快门干站。
 */
export function useCaptureFlow(deps: CaptureFlowDeps): CaptureFlow {
  const [capturing, setCapturing] = useState(false);
  const busyRef = useRef(false);
  /** 每次拍照自增,用来丢弃"上一张"迟到的点评结果 */
  const reviewSeq = useRef(0);

  // 依赖放 ref:capture 的 identity 保持稳定,快门按钮不会因父组件重渲染而抖动
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  const capture = useCallback(async () => {
    const d = depsRef.current;
    if (!d.cameraReady || busyRef.current) return;

    busyRef.current = true;
    setCapturing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      Animated.timing(d.flash, { toValue: 0.85, duration: 60, useNativeDriver: true }),
      Animated.timing(d.flash, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();

    try {
      const shot = await takePicture();
      if (!shot?.path) throw new Error('拍照失败');
      const rawUri = `file://${shot.path}`;
      // 预览只显示了取景画面的一部分时,照片也要裁成同样的比例。
      // shot.rotation 告诉我们对横向存储的照片该换算哪个坐标轴。
      // 预览和拍照都是传感器原生比例,不需要裁切 —— 所见即所得由布局保证。
      // 前置还要补一次水平镜像:预览是镜像的,JPEG 不带镜像,不补就"照片和预览相反"。
      const shotUri = await mirrorForFront(rawUri, d.isFront).catch(() => rawUri);

      // 先直接写相册(Android 13+ 不需要权限),失败才申请
      const saveResult = await saveToAlbum(shotUri);
      const saved = saveResult.ok;
      if (!saved) console.warn('[capture] 保存相册失败:', saveResult.error);

      const photoMeta = d.meta();

      // 复制一份到文档目录:历史记录和复盘页都用它(cache 会被系统清理)
      const entryId = String(Date.now());
      let stableUri = shotUri;
      try {
        stableUri = await persistPhoto(shotUri, entryId);
      } catch {
        // 复制失败就退回用原路径,不影响这次拍照
      }

      // 照片先落地:立刻进复盘页
      const lastSuggestion = d.getLastSuggestion();
      setLastCapture({ uri: stableUri, saved, meta: photoMeta, lastSuggestion });
      // 没有 API Key 就不发请求 —— 宁可明说"没有点评",也别让复盘页转圈到超时
      setReviewState(
        d.hasApiKey
          ? { status: 'analyzing' }
          : { status: 'failed', error: '没有配置 API Key,这张只保存了照片。相机功能不受影响。' },
      );
      router.push({
        pathname: '/review',
        params: { uri: stableUri, saved: saved ? '1' : '0' },
      });

      const mySeq = ++reviewSeq.current;
      const photoUri = stableUri;

      await loadHistory();
      addHistoryEntry({
        id: entryId,
        uri: stableUri,
        createdAt: Date.now(),
        savedToAlbum: saved,
        meta: photoMeta,
        status: 'analyzing',
      });

      if (!d.hasApiKey) {
        updateHistoryEntry(entryId, { status: 'failed', error: '没有配置 API Key' });
        return;
      }

      void (async () => {
        try {
          // 只给模型用的一份缩略图,不影响相册和复盘页显示的原图
          const base64 = await toAnalysisBase64(photoUri, 0, 0);
          if (mySeq !== reviewSeq.current) return;
          const result = await analyze(base64, 'capture', {
            thinking: d.thinking,
            endpoint: d.apiEndpoint,
            meta: photoMeta,
            lastLiveSuggestion: lastSuggestion,
            limits: d.limits(),
          });
          if (mySeq !== reviewSeq.current) return; // 已经又拍了一张,丢弃旧结果
          setReviewState(
            result.mode === 'capture'
              ? { status: 'done', result }
              : { status: 'failed', error: '服务返回了意外类型' },
          );
          if (result.mode === 'capture') {
            updateHistoryEntry(entryId, { status: 'done', result });
          } else {
            updateHistoryEntry(entryId, { status: 'failed', error: '服务返回了意外类型' });
          }
        } catch (err) {
          if (mySeq !== reviewSeq.current) return;
          setReviewState({ status: 'failed', error: (err as Error).message });
          updateHistoryEntry(entryId, { status: 'failed', error: (err as Error).message });
        }
      })();
    } catch (err) {
      depsRef.current.onError((err as Error).message);
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }, []);

  return { capturing, capture };
}
