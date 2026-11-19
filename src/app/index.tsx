
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { GestureDetector } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlashButton } from '@/components/flash-button';
import { GridOverlay } from '@/components/grid-overlay';
import { AUTO_SELECTION, ProCameraPanel, type ProSelection } from '@/components/pro-camera-panel';
import { LevelBadge } from '@/components/level-badge';
import { SuggestionCard } from '@/components/suggestion-card';
import { useCaptureFlow } from '@/hooks/use-capture-flow';
import { useLiveAnalysis } from '@/hooks/use-live-analysis';
import { useShutterTimer } from '@/hooks/use-shutter-timer';
import { usePreviewGestures } from '@/hooks/use-preview-gestures';
import { useTilt } from '@/hooks/use-tilt';
import { takePendingAdjust } from '@/lib/capture-store';
import { useVoiceGuide } from '@/hooks/use-voice-guide';
import { useApiKey } from '@/hooks/use-api-key';
import { useCameraPermission } from '@/hooks/use-camera-permission';
import {
  addErrorListener,
  setExposureCompensation,
  setFlashMode,
  formatShutterNs,
  parseShutterToNs,
  setManual,
  addParamsListener,
  addReadyListener,
  addVolumeKeyListener,
  Camera2Preview,
  getCapabilities,
  grabPreview,
  type Camera2CapsFull,
  type Camera2Params,
  type FlashMode,
} from '@/lib/native-camera2';
import type { PhotoMeta } from '@/lib/exif';
import type { AdjustParams } from '@/lib/types';
import { liveAnalysisEnabled, thinkingOf, useSettings } from '@/lib/settings';
import { palette, radius, spacing, tabularNums, type, weight } from '@/lib/theme';

/** 预览填充比例,实测调出来的默认值 */
const DEFAULT_PREVIEW_FILL = 0.25;

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
  /** 点按对焦的位置(屏幕坐标) */
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [flashMode, setFlashModeState] = useState<FlashMode>('off');
  const { width: screenW, height: screenH } = useWindowDimensions();
  /** 相机硬件能力(最大变焦、闪光灯、曝光补偿范围) */
  const [caps, setCaps] = useState<Camera2CapsFull | null>(null);

  /**
   * 取景区域:相机画面按 contain 显示后,屏幕上被画面占据的那块矩形。
   * 网格线和点按对焦都要以这块为准,否则会和照片对不上。
   */
  const previewAspect = caps?.previewAspect && caps.previewAspect > 0 ? caps.previewAspect : 3 / 4;
  /** 临时:预览填充比例,0=完整显示留黑边,1=铺满裁切 */
  // 预览填充比例:0 = 完整显示(黑边),1 = 铺满(裁切)。
  // 0.25 是真机上手调出来的值 —— 画面足够满,又不会裁掉太多。
  const [fillRatio] = useState(DEFAULT_PREVIEW_FILL);
  const previewRect = useMemo(() => {
    // 可见区域的比例:0 → 缓冲原比例(完整),1 → 屏幕比例(铺满)
    const screenAspect = screenW / screenH;
    const visibleAspect = previewAspect + (screenAspect - previewAspect) * fillRatio;
    let w = screenW;
    let h = screenW / visibleAspect;
    if (h > screenH) {
      h = screenH;
      w = screenH * visibleAspect;
    }
    return { x: (screenW - w) / 2, y: (screenH - h) / 2, width: w, height: h, aspect: visibleAspect };
  }, [previewAspect, fillRatio, screenW, screenH]);
  const previewRectRef = useRef(previewRect);
  useEffect(() => {
    // 在 effect 里同步,避免渲染期写 ref
    previewRectRef.current = previewRect;
  }, [previewRect]);
  /** 专业面板是否展开 */
  const [proOpen, setProOpen] = useState(false);
  const [proSelection, setProSelection] = useState<ProSelection>(AUTO_SELECTION);
  
  /** 原生相机实时回报的参数与静态光学信息 */
  const paramsRef = useRef<Camera2Params | null>(null);
  /** 从复盘页带回来、等相机就绪后应用的参数 */
  const pendingAdjustRef = useRef<AdjustParams | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  /** 相机实时回报的参数,用于顶栏显示 */
  const [liveParams, setLiveParams] = useState<Camera2Params | null>(null);
  /** 临时诊断:预览变换现场数据 */


  const capsRef = useRef<Camera2CapsFull | null>(null);

  const captureBusyRef = useRef(false);

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

  /**
   * 语音正在播报的标志。
   * 由页面持有、两个 hook 共用:分析循环据此跳过这一轮,语音 hook 负责置位。
   * 用共享 ref 而不是互相 import,避免两个 hook 循环依赖。
   */
  const voiceSpeakingRef = useRef(false);

  const live = useLiveAnalysis({
    liveOn,
    cameraReady: ready,
    hasApiKey: keyReady,
    hasPermission: permission.granted,
    focused,
    appActive,
    intervalSec: settings.intervalSec,
    voiceGuide: settings.voiceGuide,
    apiEndpoint: settings.apiEndpoint,
    grab: grabWithRetry,
    meta: currentMeta,
    limits: () =>
      capsRef.current
        ? {
            isoMin: capsRef.current.isoMin,
            isoMax: capsRef.current.isoMax,
            exposureMinNs: capsRef.current.exposureMinNs,
            exposureMaxNs: capsRef.current.exposureMaxNs,
          }
        : undefined,
    // 播报中、拍照中都不抓帧:前者会打断语音,后者会和快门抢相机
    isBlocked: () => voiceSpeakingRef.current || captureBusyRef.current,
    isAppActive: () => appActiveRef.current,
  });

  const { retry: retryLive, clearError, reportError, resetFailures } = live;

  const voice = useVoiceGuide({
    enabled: settings.voiceGuide,
    focused,
    appActive,
    suggestion: live.suggestion,
    onFollowUp: () => void live.run(),
    getLastRunAt: live.getLastRunAt,
    speakingFlag: voiceSpeakingRef,
  });

  // 快门前的建议要带给点评,用 ref 保存以免闭包过期
  const lastSuggestionRef = useRef<{ headline: string; action: string } | null>(null);
  useEffect(() => {
    const current = live.suggestion;
    lastSuggestionRef.current =
      current && current.mode === 'live'
        ? { headline: current.headline, action: current.action }
        : null;
  }, [live.suggestion]);

  /**
   * 当前画面是否可以拍了。
   * **纯提示**:出错、暂停、没有建议时都是 false,但快门永远可用。
   */
  const readyToShoot =
    liveOn &&
    !live.paused &&
    !live.error &&
    live.suggestion?.mode === 'live' &&
    live.suggestion.readyToShoot === true;

  useEffect(() => {
    const offReady = addReadyListener(() => {
      setReady(true);
      clearError();
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
      if (appActiveRef.current) reportError(msg);
    });
    return () => {
      offReady();
      offParams();
      offError();
    };
  }, [applyAdjust, clearError, reportError]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      setAppActive(active);
      if (active) {
        // 回来时清掉后台期间遗留的错误:那多半是挂起/超时造成的假故障
        clearError();
        resetFailures();
      } else {
        setReady(false);
      }
    });
    return () => sub.remove();
  }, [clearError, resetFailures]);

  const { previewGesture } = usePreviewGestures({
    capsRef,
    rectRef: previewRectRef,
    onZoomChange: setZoom,
    onFocusRing: setFocusPoint,
  });

  /** 专业面板的每一档立即生效 */
  const applyProSelection = useCallback((sel: ProSelection) => {
    setProSelection(sel);
    setExposureCompensation(sel.ev ?? 0);

    // 手动曝光要求 ISO 与快门同时有值;只选了一个就用当前实测值补齐
    let iso = sel.iso;
    let shutterNs = sel.shutterNs;
    if (iso != null && shutterNs == null) {
      shutterNs = Math.round(paramsRef.current?.exposureNs ?? 0) || null;
    }
    if (shutterNs != null && iso == null) {
      iso = paramsRef.current?.iso ?? null;
    }

    setManual({
      iso,
      exposureNs: shutterNs,
      focusDiopters: sel.focusDiopters,
      kelvin: sel.kelvin,
    });
  }, [setProSelection]);

  // 变成"可以拍了"时轻震一次,提示用户现在按快门
  const wasReadyRef = useRef(false);
  useEffect(() => {
    if (readyToShoot && !wasReadyRef.current) {
      void Haptics.selectionAsync();
    }
    wasReadyRef.current = readyToShoot;
  }, [readyToShoot]);

  /** 闪光灯三态循环 */
  const cycleFlash = useCallback(() => {
    setFlashModeState((prev) => {
      const next: FlashMode = prev === 'off' ? 'auto' : prev === 'auto' ? 'torch' : 'off';
      setFlashMode(next);
      return next;
    });
  }, [setFlashModeState]);

  // 手动重试:清掉暂停状态并立刻跑一次。用 ref 拿到最新实现,避免每次渲染都换函数
  const stopVoice = voice.stop;
  const retryNow = useCallback(() => {
    // 用户主动换一条:打断当前播报
    stopVoice();
    retryLive();
  }, [stopVoice, retryLive]);

  const { capturing, capture } = useCaptureFlow({
    cameraReady: ready,
    hasApiKey: keyReady,
    apiEndpoint: settings.apiEndpoint,
    thinking: thinkingOf(settings),
    visibleAspect: () => previewRectRef.current.aspect,
    meta: currentMeta,
    limits: () =>
      capsRef.current
        ? {
            isoMin: capsRef.current.isoMin,
            isoMax: capsRef.current.isoMax,
            exposureMinNs: capsRef.current.exposureMinNs,
            exposureMaxNs: capsRef.current.exposureMaxNs,
          }
        : undefined,
    getLastSuggestion: () => lastSuggestionRef.current,
    onError: reportError,
    flash,
  });

  const shutter = useShutterTimer(() => void capture());

  // 音量键当快门:订阅随 onShutterPress 更新,避免闭包过期
  useEffect(() => addVolumeKeyListener(() => shutter.press()), [shutter]);




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

  return (
    <View style={styles.root}>
      {/* 相机铺满整屏,横竖屏都只改叠加层的排版,不重建相机 */}
      {/* 只在页面可见时挂载预览:一离开就释放相机 */}
      {focused && appActive ? (
        <Camera2Preview style={StyleSheet.absoluteFill} facing={facing} previewFill={fillRatio} />
      ) : null}

      {/* 三分线对齐到取景区域(不是整屏),这样和照片的三分线一致 */}
      {focused && appActive ? (
        <View
          pointerEvents="none"
          style={[styles.previewRect, { left: previewRect.x, top: previewRect.y, width: previewRect.width, height: previewRect.height }]}>
          <GridOverlay visible={showGrid} />
        </View>
      ) : null}

      {/* 取景操作层:双指缩放 + 点按对焦 */}
      <GestureDetector gesture={previewGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* 对焦框 */}
      {focusPoint ? (
        <View
          pointerEvents="none"
          style={[styles.focusRing, { left: focusPoint.x - 36, top: focusPoint.y - 36 }]}
        />
      ) : null}

      {/* 定时器倒计时 */}
      {shutter.countdown !== null ? (
        <Pressable style={styles.countdownLayer} onPress={shutter.cancel}>
          <Text style={styles.countdownText}>{shutter.countdown}</Text>
          <Text style={styles.countdownHint}>点任意处取消</Text>
        </Pressable>
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
            <Pressable style={styles.topChip} onPress={() => setShowGrid((v) => !v)} hitSlop={8}>
              <Text style={[styles.topChipText, showGrid && styles.topChipTextOn]}>网格</Text>
            </Pressable>
            {caps?.hasFlash ? <FlashButton mode={flashMode} onPress={cycleFlash} /> : null}
            <LevelBadge tilt={tilt} />
            <Pressable style={styles.topChip} onPress={() => router.push('/settings')} hitSlop={8}>
              <Text style={styles.topChipText}>设置</Text>
            </Pressable>
          </View>
        </View>

        {!keyReady ? (
          <View style={styles.noKeyBanner} pointerEvents="box-none">
            <Text style={styles.noKeyText}>没有 API Key · 相机可用,AI 建议和点评不可用</Text>
            <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
              <Text style={styles.noKeyAction}>去设置</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.bottomBlock} pointerEvents="box-none">
          {appliedNote ? (
            <View style={styles.appliedPill}>
              <Text style={styles.appliedText}>{appliedNote}</Text>
            </View>
          ) : null}
          {/* 专业面板是半透明的,压在卡片上方会把两层文字叠在一起,所以展开时先收起卡片 */}
          {keyReady && !proOpen ? (
            <SuggestionCard
              suggestion={live.suggestion}
              analyzing={live.analyzing}
              error={live.error}
              liveOn={liveOn}
              paused={live.paused}
              onOpenSettings={() => router.push('/settings')}
              onRefresh={retryNow}
            />
          ) : null}

          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.leftControls}>
              <Pressable style={styles.sideButton} onPress={() => setProOpen((v) => !v)} hitSlop={10}>
                <Text style={[styles.sideButtonText, proOpen && { color: palette.accent }]}>专业</Text>
              </Pressable>
              <Pressable style={styles.sideButton} onPress={shutter.cycle} hitSlop={10}>
                <Text style={[styles.sideButtonText, shutter.seconds > 0 && { color: palette.accent }]}>
                  {shutter.seconds === 0 ? '定时' : `${shutter.seconds}s`}
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[
                styles.shutter,
                readyToShoot && styles.shutterReady,
                capturing && { opacity: 0.6 },
              ]}
              onPress={shutter.press}
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

          <ProCameraPanel
            visible={proOpen}
            caps={caps}
            liveParams={liveParams}
            selection={proSelection}
            onChange={applyProSelection}
            onClose={() => setProOpen(false)}
          />
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
  shutterReady: {
    borderColor: palette.good,
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
  countdownLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    gap: spacing.md,
  },
  countdownText: {
    ...type.display,
    fontSize: 72,
    color: palette.text,
  },
  countdownHint: { ...type.caption, color: palette.textDim },
  topChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.scrim,
  },
  topChipText: { ...type.caption, color: palette.textDim },
  topChipTextOn: { color: palette.accent, fontWeight: weight.bold },
  previewRect: {
    position: 'absolute',
    overflow: 'hidden',
  },
  noKeyBanner: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    top: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: palette.scrim,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  noKeyText: { ...type.caption, color: palette.textSoft, flex: 1 },
  noKeyAction: { ...type.caption, color: palette.accent, fontWeight: weight.bold },
  leftControls: { alignItems: 'flex-start', gap: spacing.md },
  appliedPill: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.goodStrong,
  },
  appliedText: { color: palette.onGood, fontSize: type.subhead.fontSize, fontWeight: weight.bold },
  flash: {
    backgroundColor: palette.text,
  },
});
