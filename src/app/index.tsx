
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlashButton } from '@/components/flash-button';
import { GridOverlay } from '@/components/grid-overlay';
import { LevelBadge } from '@/components/level-badge';
import { SuggestionCard } from '@/components/suggestion-card';
import { useTilt } from '@/hooks/use-tilt';
import { analyze } from '@/lib/api';
import { useApiKey } from '@/hooks/use-api-key';
import { useCameraPermission } from '@/hooks/use-camera-permission';
import {
  addErrorListener,
  focusAt,
  setFlashMode,
  setZoom as setZoomValue,
  formatShutterNs,
  parseShutterToNs,
  setManual,
  addParamsListener,
  addReadyListener,
  Camera2Preview,
  getCapabilities,
  grabPreview,
  takePicture,
  type Camera2CapsFull,
  type Camera2Params,
  type FlashMode,
} from '@/lib/native-camera2';
import { toAnalysisBase64 } from '@/lib/analysis-image';
import type { PhotoMeta } from '@/lib/exif';
import type { AdjustParams, LiveSuggestion } from '@/lib/types';
import { setLastCapture, setReviewState, takePendingAdjust } from '@/lib/capture-store';
import { addHistoryEntry, loadHistory, persistPhoto, updateHistoryEntry } from '@/lib/history';
import { liveAnalysisEnabled, thinkingOf, useSettings } from '@/lib/settings';
import { saveToAlbum } from '@/lib/media';
import { palette, radius, spacing, tabularNums, type, weight } from '@/lib/theme';

const MAX_CONSECUTIVE_FAILURES = 3;

export default function CameraScreen() {
  const permission = useCameraPermission();

  const settings = useSettings();
  const liveOn = liveAnalysisEnabled(settings);

  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(true);
  /**
   * App 是否在前台。退到后台时系统会禁掉相机(ERROR_CAMERA_DISABLED=3),
   * 所以必须主动卸载预览、回前台再重新打开,否则会一直失败。
   */
  const [appActive, setAppActive] = useState(true);
  const appActiveRef = useRef(true);

  /** API Key 存在设备加密存储里,保存后这里会自动更新 */
  const apiKey = useApiKey();
  const keyReady = !!apiKey;
  const [showGrid, setShowGrid] = useState(true);
  /** 当前变焦倍数(数字变焦) */
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const zoomSentRef = useRef(1);
  /** 预览区域的实际尺寸,用于把点按位置换算成 0~1 坐标 */
  const previewSizeRef = useRef({ width: 0, height: 0 });
  const pinchStartRef = useRef(1);
  /** 点按对焦的位置(屏幕坐标) */
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [flashMode, setFlashModeState] = useState<FlashMode>('off');
  /** 相机硬件能力(最大变焦、闪光灯、曝光补偿范围) */
  const [caps, setCaps] = useState<Camera2CapsFull | null>(null);
  /** 连续失败后暂停自动分析,直到用户手动重试(不改用户设置) */
  const [paused, setPaused] = useState(false);

  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  /** 原生相机实时回报的参数与静态光学信息 */
  const paramsRef = useRef<Camera2Params | null>(null);
  /** 从复盘页带回来、等相机就绪后应用的参数 */
  const pendingAdjustRef = useRef<AdjustParams | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  /** 相机实时回报的参数,用于顶栏显示 */
  const [liveParams, setLiveParams] = useState<Camera2Params | null>(null);
  /** 临时诊断:预览变换现场数据 */


  const capsRef = useRef<Camera2CapsFull | null>(null);

  const analyzeBusyRef = useRef(false);
  const captureBusyRef = useRef(false);
  const failuresRef = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      setAppActive(active);
      if (active) {
        // 回来时清掉后台期间遗留的错误:那多半是挂起/超时造成的假故障
        setError(null);
        failuresRef.current = 0;
      } else {
        setReady(false);
      }
    });
    return () => sub.remove();
  }, []);
  /** 每次拍照自增,用来丢弃"上一张"迟到的点评结果 */
  const reviewSeq = useRef(0);
  const flash = useMemo(() => new Animated.Value(0), []);

  const tilt = useTilt(focused && appActive && ready);
  /** 把 AI 建议的参数合并进当前状态并下发给相机 */
  const applyAdjust = useCallback((adj: AdjustParams) => {
    const cur = paramsRef.current;
    const caps = capsRef.current;
    const wantsExposure = adj.iso != null || !!adj.shutter;

    let iso: number | null;
    let exposureNs: number | null;
    if (wantsExposure) {
      iso = adj.iso ?? (cur?.manual ? cur.iso : null);
      exposureNs = adj.shutter
        ? parseShutterToNs(adj.shutter) ?? null
        : cur?.manual
          ? cur.exposureNs
          : null;
      if (iso == null || exposureNs == null) {
        iso = null;
        exposureNs = null;
      }
    } else if (cur?.manual) {
      iso = cur.iso;
      exposureNs = cur.exposureNs;
    } else {
      iso = null;
      exposureNs = null;
    }

    if (caps) {
      if (iso != null) iso = Math.min(caps.isoMax, Math.max(caps.isoMin, iso));
      if (exposureNs != null) {
        exposureNs = Math.min(caps.exposureMaxNs, Math.max(caps.exposureMinNs, exposureNs));
      }
    }

    const kelvin = adj.wb ?? (cur?.kelvin ? cur.kelvin : null);
    const focusDiopters = adj.focusMeters ? 1 / adj.focusMeters : (cur?.focusDiopters || null);

    setManual({ iso, exposureNs, kelvin, focusDiopters });

    const parts: string[] = [];
    if (iso) parts.push(`ISO ${iso}`);
    if (exposureNs) parts.push(formatShutterNs(exposureNs));
    if (kelvin) parts.push(`${kelvin}K`);
    setAppliedNote(parts.length ? `已应用 ${parts.join(' · ')}` : '已应用建议参数');
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const incoming = takePendingAdjust();
      if (incoming) {
        // 相机可能是刚挂载,等就绪事件再应用
        pendingAdjustRef.current = incoming;
      }
      return () => {
        // 离开页面立刻释放相机,避免和别的页面抢
        setFocused(false);
        setReady(false);
      };
    }, []),
  );

  useEffect(() => {
    const offReady = addReadyListener(() => {
      setReady(true);
      setError(null);
      const pending = pendingAdjustRef.current;
      if (pending) {
        pendingAdjustRef.current = null;
        applyAdjust(pending);
      }
      void getCapabilities().then((result) => {
        if (result) {
          capsRef.current = result;
          setCaps(result);
        }
      });
    });
    const offParams = addParamsListener((p) => {
      paramsRef.current = p;
      setLiveParams(p);
    });
    const offError = addErrorListener((msg) => {
      // 后台期间相机被系统断开是正常现象,不要留成红字
      if (appActiveRef.current) setError(msg);
    });
    return () => {
      offReady();
      offParams();
      offError();
    };
  }, [applyAdjust]);

  /** 把原生回报的参数拼成送模型的 meta */
  const currentMeta = useCallback((): PhotoMeta | null => {
    if (!settings.paramAdvice) return null;
    const p = paramsRef.current;
    const caps = capsRef.current;
    if (!p && !caps) return null;
    return {
      iso: p?.iso && p.iso > 0 ? p.iso : undefined,
      exposureTime: p?.exposureNs ? p.exposureNs / 1e9 : undefined,
      fNumber: caps?.aperture && caps.aperture > 0 ? caps.aperture : undefined,
      focalLength: caps?.focalLengthMm && caps.focalLengthMm > 0 ? caps.focalLengthMm : undefined,
    };
  }, [settings.paramAdvice]);

  useEffect(() => {
    if (!appliedNote) return;
    const timer = setTimeout(() => setAppliedNote(null), 4000);
    return () => clearTimeout(timer);
  }, [appliedNote]);

  /** 抓帧:相机刚恢复的前几百毫秒可能还没有画面,重试几次再算失败 */
  const grabWithRetry = useCallback(async (): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await grabPreview(1024, 60);
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('抓帧失败');
  }, []);

  const runLiveAnalysis = useCallback(async () => {
    // 正在拍照时不抓帧,避免打扰
    if (!ready || analyzeBusyRef.current || captureBusyRef.current) return;

    analyzeBusyRef.current = true;
    setAnalyzing(true);
    try {
      // 直接抓预览画面(就是用户看到的那一帧),比拍全尺寸再缩图快得多。
      // 刚从后台回来时纹理可能还没第一帧,重试两次再判定失败,避免假报错。
      const base64 = await grabWithRetry();

      // 取景建议一律用低思考强度:它每几秒就要刷一次,不能被推理拖住
      // 取景建议一律关闭思考:实测 thinking=low 仍会产生 300~800 个思维链 token、
      // 单次 3.5~8 秒,而 disabled 只要 1.6~1.8 秒。取景不能拿延迟换质量。
      const result = await analyze(base64, 'live', {
        thinking: 'disabled',
        endpoint: settings.apiEndpoint,
        meta: currentMeta(),
        limits: capsRef.current
          ? {
              isoMin: capsRef.current.isoMin,
              isoMax: capsRef.current.isoMax,
              exposureMinNs: capsRef.current.exposureMinNs,
              exposureMaxNs: capsRef.current.exposureMaxNs,
            }
          : undefined,
      });
      if (result.mode === 'live') {
        setSuggestion(result);
        setError(null);
        failuresRef.current = 0;
      }
    } catch (err) {
      // 退到后台时在途请求会超时/被系统挂起,这不是真的故障,不该弹红字
      if (!appActiveRef.current) return;
      failuresRef.current += 1;
      setError((err as Error).message);
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) setPaused(true);
    } finally {
      analyzeBusyRef.current = false;
      setAnalyzing(false);
    }
  }, [ready, settings.apiEndpoint, currentMeta, grabWithRetry, setError, setPaused, setAnalyzing, setSuggestion]);

  /* eslint-disable react-hooks/refs, react-hooks/preserve-manual-memoization --
     手势回调是在用户操作时执行的,不是渲染期访问 ref。
     React Compiler 无法建模 Gesture API 的调用时机,这里显式豁免。 */
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onBegin(() => {
          pinchStartRef.current = zoomRef.current;
        })
        .onUpdate((event) => {
          const max = capsRef.current?.maxZoom ?? 4;
          const next = Math.min(max, Math.max(1, pinchStartRef.current * event.scale));
          if (Math.abs(next - zoomRef.current) > 0.02) {
            zoomRef.current = next;
            setZoom(next);
            if (Math.abs(next - zoomSentRef.current) > 0.05) {
              zoomSentRef.current = next;
              setZoomValue(next);
            }
          }
        }),
    [],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .onEnd((event) => {
          const { width, height } = previewSizeRef.current;
          if (!width || !height) return;
          const nx = Math.min(1, Math.max(0, event.x / width));
          const ny = Math.min(1, Math.max(0, event.y / height));
          focusAt(nx, ny);
          setFocusPoint({ x: event.x, y: event.y });
          setTimeout(() => setFocusPoint(null), 1200);
        }),
    [],
  );

  const previewGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, tapGesture),
    [pinchGesture, tapGesture],
  );

  /* eslint-enable react-hooks/refs, react-hooks/preserve-manual-memoization */

  /** 闪光灯三态循环 */
  const cycleFlash = useCallback(() => {
    setFlashModeState((prev) => {
      const next: FlashMode = prev === 'off' ? 'auto' : prev === 'auto' ? 'torch' : 'off';
      setFlashMode(next);
      return next;
    });
  }, [setFlashModeState]);

  // 手动重试:清掉暂停状态并立刻跑一次
  const retryNow = useCallback(() => {
    setPaused(false);
    failuresRef.current = 0;
    void runLiveAnalysis();
  }, [runLiveAnalysis, setPaused]);

  useEffect(() => {
    if (!liveOn || paused || !focused || !appActive || !ready || !keyReady || !permission.granted) return;
    const warmup = setTimeout(() => void runLiveAnalysis(), 700);
    const timer = setInterval(() => void runLiveAnalysis(), settings.intervalSec * 1000);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [liveOn, paused, focused, appActive, ready, keyReady, permission.granted, runLiveAnalysis, settings.intervalSec, setPaused]);

  const handleCapture = useCallback(async () => {
    if (!ready || captureBusyRef.current) return;

    captureBusyRef.current = true;
    setCapturing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      Animated.timing(flash, { toValue: 0.85, duration: 60, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();

    try {
      const rawPath = await takePicture();
      if (!rawPath) throw new Error('拍照失败');
      const shotUri = `file://${rawPath}`;

      // 先直接写相册(Android 13+ 不需要权限),失败才申请
      const saveResult = await saveToAlbum(shotUri);
      const saved = saveResult.ok;
      if (!saved) console.warn('[capture] 保存相册失败:', saveResult.error);

      const photoMeta = currentMeta();

      // 复制一份到文档目录,历史记录和复盘页都用它(cache 会被系统清理)
      const entryId = String(Date.now());
      let stableUri = shotUri;
      try {
        stableUri = await persistPhoto(shotUri, entryId);
      } catch {
        // 复制失败就退回用原路径,不影响这次拍照
      }

      // 照片先落地:立刻进复盘页,不让用户为了等点评而干站着
      setLastCapture({ uri: stableUri, saved, meta: photoMeta });
      setReviewState({ status: 'analyzing' });
      router.push({
        pathname: '/review',
        params: { uri: stableUri, saved: saved ? '1' : '0' },
      });

      // 点评在后台继续跑,结果推给复盘页
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

      void (async () => {
          try {
            // 只给模型用的一份缩略图,不影响相册和复盘页显示的原图
            const base64 = await toAnalysisBase64(photoUri, 0, 0);
            if (mySeq !== reviewSeq.current) return;
            const result = await analyze(base64, 'capture', {
              thinking: thinkingOf(settings),
              endpoint: settings.apiEndpoint,
              meta: photoMeta,
              limits: capsRef.current
                ? {
                    isoMin: capsRef.current.isoMin,
                    isoMax: capsRef.current.isoMax,
                    exposureMinNs: capsRef.current.exposureMinNs,
                    exposureMaxNs: capsRef.current.exposureMaxNs,
                  }
                : undefined,
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
      setError((err as Error).message);
    } finally {
      captureBusyRef.current = false;
      setCapturing(false);
    }
  }, [flash, ready, settings, currentMeta, setCapturing, setError]);

  if (!permission.checked) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.gateTitle}>需要相机权限</Text>
        <Text style={styles.gateBody}>
          这个应用要看着取景画面才能给建议,所以必须先拿到相机权限。
        </Text>
        {permission.canAskAgain ? (
          <Pressable style={styles.gateButton} onPress={() => void permission.request()}>
            <Text style={styles.gateButtonText}>允许使用相机</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.gateButton} onPress={() => void Linking.openSettings()}>
            <Text style={styles.gateButtonText}>去设置里打开</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (!keyReady) {
    return (
      <View style={styles.center}>
        <Text style={styles.gateTitle}>还没有配置 API Key</Text>
        <Text style={styles.gateBody}>
          Key 只会加密保存在你这台手机上,不会上传到任何服务器,也不在安装包里。
        </Text>
        <Pressable style={styles.gateButton} onPress={() => router.push('/settings')}>
          <Text style={styles.gateButtonText}>去设置</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* 相机铺满整屏,横竖屏都只改叠加层的排版,不重建相机 */}
      {/* 只在页面可见时挂载预览:一离开就释放相机 */}
      {focused && appActive ? <Camera2Preview style={StyleSheet.absoluteFill} facing={facing} /> : null}

      {/* 三分线必须在预览之后,否则会被原生视图盖住 */}
      <GridOverlay visible={showGrid && focused && appActive} />

      {/* 取景操作层:双指缩放 + 点按对焦 */}
      <GestureDetector gesture={previewGesture}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            previewSizeRef.current = {
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            };
          }}
        />
      </GestureDetector>

      {/* 对焦框 */}
      {focusPoint ? (
        <View
          pointerEvents="none"
          style={[styles.focusRing, { left: focusPoint.x - 36, top: focusPoint.y - 36 }]}
        />
      ) : null}

      {/* 变焦倍率提示:不在 1x 时才显示 */}
      {zoom > 1.05 ? (
        <View pointerEvents="none" style={styles.zoomPill}>
          <Text style={styles.zoomText}>{zoom.toFixed(1)}x</Text>
        </View>
      ) : null}

      <SafeAreaView
        style={[StyleSheet.absoluteFill, styles.overlay]}
        edges={['top', 'bottom']}
        pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.brand}>
            <Text style={styles.brandText}>AI 拍照引导</Text>
            <Text style={styles.brandSub} numberOfLines={1}>
              {liveParams
                ? `ISO ${liveParams.iso} · ${formatShutterNs(liveParams.exposureNs)}${liveParams.manual ? ' · 手动' : ''}`
                : '正在读取相机参数…'}
            </Text>
          </View>
          <View style={styles.topRight}>
            <LevelBadge tilt={tilt} />
            {caps?.hasFlash ? <FlashButton mode={flashMode} onPress={cycleFlash} /> : null}
          </View>
        </View>

        <View style={styles.bottomBlock} pointerEvents="box-none">
          {appliedNote ? (
            <View style={styles.appliedPill}>
              <Text style={styles.appliedText}>{appliedNote}</Text>
            </View>
          ) : null}
          <SuggestionCard
            suggestion={suggestion}
            analyzing={analyzing}
            error={error}
            liveOn={liveOn}
            paused={paused}
            onOpenSettings={() => router.push('/settings')}
            onRefresh={retryNow}
          />

          <View style={styles.controls} pointerEvents="box-none">
            <Pressable style={styles.sideButton} onPress={() => setShowGrid((v) => !v)} hitSlop={10}>
              <Text style={[styles.sideButtonText, showGrid && { color: palette.accent }]}>网格</Text>
            </Pressable>

            <Pressable
              style={[styles.shutter, capturing && { opacity: 0.6 }]}
              onPress={() => void handleCapture()}
              disabled={capturing || !ready}>
              <View style={styles.shutterInner} />
            </Pressable>

            <Pressable
              style={styles.sideButton}
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              hitSlop={10}>
              <Text style={styles.sideButtonText}>翻转</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>直连 DeepSeek · 请求由本机发起</Text>
        </View>
      </SafeAreaView>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.huge,
    gap: spacing.xl,
    backgroundColor: palette.bg,
  },
  gateTitle: {
    color: palette.text,
    fontSize: type.metric.fontSize,
    fontWeight: weight.bold,
  },
  gateBody: {
    color: palette.textDim,
    fontSize: type.body.fontSize,
    lineHeight: 22,
    textAlign: 'center',
  },
  gateButton: {
    marginTop: spacing.md,
    paddingHorizontal: 22,
    paddingVertical: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  gateButtonText: {
    color: palette.onAccent,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
  },
  overlay: {
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  landscapePanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  panelTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlsCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  shutterCompact: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    borderColor: palette.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInnerCompact: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.text,
  },
  brand: {
    gap: spacing.xxs,
  },
  brandText: {
    color: palette.text,
    fontSize: type.headline.fontSize,
    fontWeight: weight.bold,
    letterSpacing: 0.4,
  },
  brandSub: {
    color: palette.textFaint,
    fontSize: type.overline.fontSize,
  },
  bottomBlock: {
    gap: spacing.xl,
    paddingBottom: spacing.md,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
  },
  sideButton: {
    width: 64,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  sideButtonText: {
    color: palette.textDim,
    fontSize: type.callout.fontSize,
    fontWeight: weight.semibold,
    // 直接浮在取景画面上,加个阴影保证亮背景下也看得清
    // 文字投影属于一次性光学调整,没有第二个使用点,故不入主题
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: palette.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.text,
  },
  focusRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: palette.accent,
  },
  zoomPill: {
    position: 'absolute',
    bottom: '22%',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: palette.scrim,
  },
  zoomText: {
    ...type.callout,
    color: palette.accent,
    ...tabularNums,
  },
  appliedPill: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.goodStrong,
  },
  appliedText: { color: palette.onGood, fontSize: type.subhead.fontSize, fontWeight: weight.bold },
  hint: {
    textAlign: 'center',
    color: palette.fillStrong,
    fontSize: type.overline.fontSize,
    marginBottom: spacing.xxs,
  },
  flash: {
    backgroundColor: palette.text,
  },
});
