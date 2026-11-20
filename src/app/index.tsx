
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { GestureDetector } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
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
import { takePendingAdjust } from '@/data/capture-store';
import { useHistory } from '@/data/history';
import { useVoiceGuide } from '@/hooks/use-voice-guide';
import { useApiKey } from '@/hooks/use-api-key';
import { useCameraPermission } from '@/hooks/use-camera-permission';
import { useCameraSession } from '@/hooks/use-camera-session';
import { Camera2Preview } from '@/infra/camera/native-camera2';
import { liveAnalysisEnabled, thinkingOf, useSettings } from '@/data/settings';
import { palette, radius, spacing, tabularNums, type, weight } from '@/theme';


export default function CameraScreen() {
  const permission = useCameraPermission();

  const settings = useSettings();
  const liveOn = liveAnalysisEnabled(settings);

  const [facing, setFacing] = useState<'back' | 'front'>('back');
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
  /** 当前变焦倍数(数字变焦) */
  const [zoom, setZoom] = useState(1);
  /** 点按对焦的位置(屏幕坐标) */
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();

  /** 专业面板是否展开 */
  const [proOpen, setProOpen] = useState(false);
  const [proSelection, setProSelection] = useState<ProSelection>(AUTO_SELECTION);
  
  const captureBusyRef = useRef(false);

  const flash = useMemo(() => new Animated.Value(0), []);

  /** 相机错误单独存:它和 AI 错误共用一个提示位置,但来源不同 */
  const [cameraError, setCameraError] = useState<string | null>(null);
  const reportCameraError = useCallback(
    (message: string) => setCameraError(message || null),
    [setCameraError],
  );

  /** 相机会话:JS 与原生之间的唯一通道(订阅事件、缓存能力、下发参数) */
  const session = useCameraSession({
    paramAdvice: settings.paramAdvice,
    isAppActive: () => appActiveRef.current,
    onError: reportCameraError,
    onReady: () => reportCameraError(''),
    onShutterKey: () => {},
  });

  // ⚠️ 只解构稳定的函数:session 是每次渲染新建的对象,
  // 把它放进 effect 依赖会让焦点 effect 每帧重跑,cleanup 里把 ready/focused 重置掉,
  // 表现为"快门按不了、不出建议、音量键失灵"。
  const { queueAdjust, markNotReady } = session;
  const tilt = useTilt(focused && appActive && session.ready);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const incoming = takePendingAdjust();
      if (incoming) {
        // 相机可能是刚挂载,排队等就绪事件再应用
        queueAdjust(incoming);
      }
      return () => {
        // 离开页面立刻释放相机,避免和别的页面抢
        setFocused(false);
        markNotReady();
      };
    }, [queueAdjust, markNotReady]),
  );

  /**
   * 取景区域:相机画面按 contain 显示后,屏幕上被画面占据的那块矩形。
   * 网格线和点按对焦都要以这块为准,否则会和照片对不上。
   */
  /**
   * 取景区域。
   *
   * 传感器是 4:3、屏幕是 9:20。硬把 4:3 铺满屏幕就必须裁两侧,照片也得跟着裁 ——
   * 那样 12.5MP 会掉到 4.2MP。所以这里**不裁**:预览按 4:3 完整显示,
   * 照片就是完整的一帧;上下空出来的位置全部用来放 UI。
   */
  const HEADER_H = 96;
  const BOTTOM_MIN = 210;
  const previewRect = useMemo(() => {
    const aspect = 3 / 4; // 宽 / 高(4:3 竖屏)
    const maxH = Math.max(120, screenH - HEADER_H - BOTTOM_MIN);
    const width = Math.min(screenW, maxH * aspect);
    const height = width / aspect;
    const y = HEADER_H + Math.max(0, (maxH - height) / 2);
    return { x: (screenW - width) / 2, y, width, height, aspect };
  }, [screenW, screenH]);
  const previewRectRef = useRef(previewRect);
  useEffect(() => {
    // 在 effect 里同步,避免渲染期写 ref
    previewRectRef.current = previewRect;
  }, [previewRect]);

  /**
   * 语音正在播报的标志。
   * 由页面持有、两个 hook 共用:分析循环据此跳过这一轮,语音 hook 负责置位。
   * 用共享 ref 而不是互相 import,避免两个 hook 循环依赖。
   */
  const voiceSpeakingRef = useRef(false);

  const live = useLiveAnalysis({
    liveOn,
    cameraReady: session.ready,
    hasApiKey: keyReady,
    hasPermission: permission.granted,
    focused,
    appActive,
    intervalSec: settings.intervalSec,
    voiceGuide: settings.voiceGuide,
    apiEndpoint: settings.apiEndpoint,
    grab: session.grab,
    meta: session.meta,
    limits: () =>
      session.caps
        ? {
            isoMin: session.caps.isoMin,
            isoMax: session.caps.isoMax,
            exposureMinNs: session.caps.exposureMinNs,
            exposureMaxNs: session.caps.exposureMaxNs,
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

  /** 相机错误优先显示;没有就用 AI 的错误 */
  const errorText = cameraError ?? live.error;

  /**
   * 当前画面是否可以拍了。
   * **纯提示**:出错、暂停、没有建议时都是 false,但快门永远可用。
   */
  const readyToShoot =
    liveOn &&
    !live.paused &&
    !errorText &&
    live.suggestion?.mode === 'live' &&
    live.suggestion.readyToShoot === true;


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
        markNotReady();
      }
    });
    return () => sub.remove();
  }, [clearError, resetFailures, markNotReady]);

  const { previewGesture } = usePreviewGestures({
    getCaps: () => session.caps,
    rectRef: previewRectRef,
    onZoomChange: setZoom,
    onFocusRing: setFocusPoint,
  });

  /** 专业面板的每一档立即生效(选择本身是界面状态,session 只管下发) */
  const applySessionSelection = session.applyProSelection;
  const applyProSelection = useCallback(
    (selection: ProSelection) => {
      setProSelection(selection);
      applySessionSelection(selection);
    },
    [setProSelection, applySessionSelection],
  );

  // 变成"可以拍了"时轻震一次,提示用户现在按快门
  const wasReadyRef = useRef(false);
  useEffect(() => {
    if (readyToShoot && !wasReadyRef.current) {
      void Haptics.selectionAsync();
    }
    wasReadyRef.current = readyToShoot;
  }, [readyToShoot]);

  // 手动重试:清掉暂停状态并立刻跑一次。用 ref 拿到最新实现,避免每次渲染都换函数
  const stopVoice = voice.stop;
  const retryNow = useCallback(() => {
    // 用户主动换一条:打断当前播报
    stopVoice();
    retryLive();
  }, [stopVoice, retryLive]);

  /** 历史里最近的一张照片,用作左下角入口的缩略图 */
  const history = useHistory();
  const latestPhoto = history[0]?.uri ?? null;

  const { capturing, capture } = useCaptureFlow({
    cameraReady: session.ready,
    isFront: facing === 'front',
    hasApiKey: keyReady,
    apiEndpoint: settings.apiEndpoint,
    thinking: thinkingOf(settings),
    meta: session.meta,
    limits: () =>
      session.caps
        ? {
            isoMin: session.caps.isoMin,
            isoMax: session.caps.isoMax,
            exposureMinNs: session.caps.exposureMinNs,
            exposureMaxNs: session.caps.exposureMaxNs,
          }
        : undefined,
    getLastSuggestion: () => lastSuggestionRef.current,
    onError: reportError,
    flash,
  });

  const shutter = useShutterTimer(() => void capture());

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
        <Camera2Preview
          style={[
            styles.previewBox,
            {
              left: previewRect.x,
              top: previewRect.y,
              width: previewRect.width,
              height: previewRect.height,
            },
          ]}
          facing={facing}
        />
      ) : null}

      {/* 九宫格:画在取景矩形内,和照片比例一致 */}
      {focused && appActive && settings.gridEnabled ? (
        <View
          pointerEvents="none"
          style={[
            styles.gridBox,
            {
              left: previewRect.x,
              top: previewRect.y,
              width: previewRect.width,
              height: previewRect.height,
            },
          ]}>
          <GridOverlay visible />
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

          <Pressable style={styles.topChip} onPress={() => setProOpen((v) => !v)} hitSlop={8}>
            <Text style={[styles.topChipText, proOpen && styles.topChipTextOn]}>专业</Text>
          </Pressable>
          <View style={styles.topRight}>
            <Pressable style={styles.topChip} onPress={shutter.cycle} hitSlop={8}>
              <Text style={[styles.topChipText, shutter.seconds > 0 && styles.topChipTextOn]}>
                {shutter.seconds === 0 ? '定时' : `${shutter.seconds}s`}
              </Text>
            </Pressable>
            {session.caps?.hasFlash ? (
              <FlashButton mode={session.flashMode} onPress={session.cycleFlash} />
            ) : null}
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
          {session.appliedNote ? (
            <View style={styles.appliedPill}>
              <Text style={styles.appliedText}>{session.appliedNote}</Text>
            </View>
          ) : null}
          {/* 专业面板是半透明的,压在卡片上方会把两层文字叠在一起,所以展开时先收起卡片 */}
          {keyReady && !proOpen ? (
            <SuggestionCard
              suggestion={live.suggestion}
              analyzing={live.analyzing}
              error={errorText}
              liveOn={liveOn}
              paused={live.paused}
              onOpenSettings={() => router.push('/settings')}
              onRefresh={retryNow}
            />
          ) : null}

          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.leftControls}>
              <Pressable
                style={[styles.historyButton, latestPhoto ? null : styles.historyButtonEmpty]}
                onPress={() => router.push('/history')}
                hitSlop={10}>
                {latestPhoto ? (
                  <Image source={{ uri: latestPhoto }} style={styles.historyThumb} resizeMode="cover" />
                ) : null}
              </Pressable>
            </View>

            <Pressable
              style={[
                styles.shutter,
                readyToShoot && styles.shutterReady,
                capturing && { opacity: 0.6 },
              ]}
              onPress={shutter.press}
              disabled={capturing || !session.ready}>
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
            caps={session.caps}
            liveParams={session.liveParams}
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
  gridBox: {
    position: 'absolute',
    overflow: 'hidden',
  },
  historyButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: palette.fill,
  },
  historyButtonEmpty: {
    // 没有历史时是个纯白圆,不放文字
    backgroundColor: palette.text,
  },
  historyThumb: {
    width: 48,
    height: 48,
  },
  previewBox: {
    position: 'absolute',
    backgroundColor: palette.bg,
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
