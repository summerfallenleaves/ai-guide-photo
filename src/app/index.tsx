
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridOverlay } from '@/components/grid-overlay';
import { LevelBadge } from '@/components/level-badge';
import { RotateButton } from '@/components/rotate-button';
import { SuggestionCard } from '@/components/suggestion-card';
import { useTilt } from '@/hooks/use-tilt';
import { useOrientation } from '@/hooks/use-orientation';
import { analyze } from '@/lib/api';
import { useApiKey } from '@/hooks/use-api-key';
import { useCameraPermission } from '@/hooks/use-camera-permission';
import {
  addErrorListener,
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
} from '@/lib/native-camera2';
import { toAnalysisBase64 } from '@/lib/analysis-image';
import type { PhotoMeta } from '@/lib/exif';
import type { AdjustParams, LiveSuggestion } from '@/lib/types';
import { setLastCapture, setReviewState, takePendingAdjust } from '@/lib/capture-store';
import { liveAnalysisEnabled, thinkingOf, useSettings } from '@/lib/settings';
import { saveToAlbum } from '@/lib/media';
import { palette, radius } from '@/lib/theme';

const MAX_CONSECUTIVE_FAILURES = 3;

export default function CameraScreen() {
  const permission = useCameraPermission();

  const settings = useSettings();
  const liveOn = liveAnalysisEnabled(settings);

  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(true);
  /** API Key 存在设备加密存储里,保存后这里会自动更新 */
  const apiKey = useApiKey();
  const keyReady = !!apiKey;
  const [showGrid, setShowGrid] = useState(true);
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
  const capsRef = useRef<Camera2CapsFull | null>(null);

  const analyzeBusyRef = useRef(false);
  const captureBusyRef = useRef(false);
  const failuresRef = useRef(0);
  /** 每次拍照自增,用来丢弃"上一张"迟到的点评结果 */
  const reviewSeq = useRef(0);
  const flash = useMemo(() => new Animated.Value(0), []);

  const tilt = useTilt(focused && ready);
  const { isLandscape, toggle: toggleOrientation } = useOrientation();
  const { width: screenWidth } = useWindowDimensions();
  // 横屏右侧浮动列的宽度
  const panelWidth = Math.min(Math.max(screenWidth * 0.34, 230), 320);

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
      const pending = pendingAdjustRef.current;
      if (pending) {
        pendingAdjustRef.current = null;
        applyAdjust(pending);
      }
      void getCapabilities().then((caps) => {
        if (caps) capsRef.current = caps;
      });
    });
    const offParams = addParamsListener((p) => {
      paramsRef.current = p;
      setLiveParams(p);
    });
    const offError = addErrorListener((msg) => setError(msg));
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

  const runLiveAnalysis = useCallback(async () => {
    // 正在拍照时不抓帧,避免打扰
    if (!ready || analyzeBusyRef.current || captureBusyRef.current) return;

    analyzeBusyRef.current = true;
    setAnalyzing(true);
    try {
      // 直接抓预览画面(就是用户看到的那一帧),比拍全尺寸再缩图快得多
      const base64 = await grabPreview(1024, 60);

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
      failuresRef.current += 1;
      setError((err as Error).message);
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) setPaused(true);
    } finally {
      analyzeBusyRef.current = false;
      setAnalyzing(false);
    }
  }, [ready, settings.apiEndpoint, currentMeta]);

  // 手动重试:清掉暂停状态并立刻跑一次
  const retryNow = useCallback(() => {
    setPaused(false);
    failuresRef.current = 0;
    void runLiveAnalysis();
  }, [runLiveAnalysis]);

  useEffect(() => {
    if (!liveOn || paused || !focused || !ready || !keyReady || !permission.granted) return;
    const warmup = setTimeout(() => void runLiveAnalysis(), 700);
    const timer = setInterval(() => void runLiveAnalysis(), settings.intervalSec * 1000);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [liveOn, paused, focused, ready, keyReady, permission.granted, runLiveAnalysis, settings.intervalSec]);

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

      // 照片先落地:立刻进复盘页,不让用户为了等点评而干站着
      setLastCapture({ uri: shotUri, saved, meta: photoMeta });
      setReviewState({ status: 'analyzing' });
      router.push({
        pathname: '/review',
        params: { uri: shotUri, saved: saved ? '1' : '0' },
      });

      // 点评在后台继续跑,结果推给复盘页
      const mySeq = ++reviewSeq.current;
      const photoUri = shotUri;

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
        } catch (err) {
          if (mySeq !== reviewSeq.current) return;
          setReviewState({ status: 'failed', error: (err as Error).message });
        }
      })();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      captureBusyRef.current = false;
      setCapturing(false);
    }
  }, [flash, ready, settings, currentMeta]);

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
      {focused ? <Camera2Preview style={StyleSheet.absoluteFill} facing={facing} /> : null}
      <GridOverlay visible={showGrid} />

      {isLandscape ? (
        /* 横屏:右侧浮动一列,背景透明,元素各自带半透明底,和竖屏卡片是同一套视觉语言 */
        <SafeAreaView
          style={[styles.landscapePanel, { width: panelWidth }]}
          edges={['top', 'bottom', 'right']}
          pointerEvents="box-none">
          <View style={styles.panelTopRow} pointerEvents="box-none">
            <LevelBadge tilt={tilt} />
            <RotateButton onPress={() => void toggleOrientation()} />
          </View>

          <SuggestionCard
            compact
            suggestion={suggestion}
            analyzing={analyzing}
            error={error}
            liveOn={liveOn}
            paused={paused}
            onOpenSettings={() => router.push('/settings')}
            onRefresh={retryNow}
          />

          <View style={styles.controlsCompact} pointerEvents="box-none">
            <Pressable style={styles.sideButton} onPress={() => setShowGrid((v) => !v)} hitSlop={10}>
              <Text style={[styles.sideButtonText, showGrid && { color: palette.accent }]}>网格</Text>
            </Pressable>

            <Pressable
              style={[styles.shutterCompact, capturing && { opacity: 0.6 }]}
              onPress={() => void handleCapture()}
              disabled={capturing || !ready}>
              <View style={styles.shutterInnerCompact} />
            </Pressable>

            <Pressable
              style={styles.sideButton}
              onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
              hitSlop={10}>
              <Text style={styles.sideButtonText}>翻转</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      ) : (
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
              <RotateButton onPress={() => void toggleOrientation()} />
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
      )}

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
    paddingHorizontal: 32,
    gap: 12,
    backgroundColor: palette.bg,
  },
  gateTitle: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '700',
  },
  gateBody: {
    color: palette.textDim,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  gateButton: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  gateButtonText: {
    color: '#00131F',
    fontSize: 15,
    fontWeight: '700',
  },
  overlay: {
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  landscapePanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'space-between',
    gap: 10,
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
    paddingHorizontal: 4,
  },
  shutterCompact: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInnerCompact: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
  },
  brand: {
    gap: 2,
  },
  brandText: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  brandSub: {
    color: palette.textFaint,
    fontSize: 10.5,
  },
  bottomBlock: {
    gap: 14,
    paddingBottom: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  sideButton: {
    width: 64,
    alignItems: 'center',
    paddingVertical: 8,
  },
  sideButtonText: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: '600',
    // 直接浮在取景画面上,加个阴影保证亮背景下也看得清
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
  },
  appliedPill: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(74,222,128,0.9)',
  },
  appliedText: { color: '#04240F', fontSize: 12.5, fontWeight: '700' },
  hint: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.28)',
    fontSize: 10,
    marginBottom: 2,
  },
  flash: {
    backgroundColor: '#FFFFFF',
  },
});
