
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlashButton } from '@/components/flash-button';
import { GridOverlay } from '@/components/grid-overlay';
import { AUTO_SELECTION, ProCameraPanel, type ProSelection } from '@/components/pro-camera-panel';
import { LevelBadge } from '@/components/level-badge';
import { SuggestionCard } from '@/components/suggestion-card';
import { useTilt } from '@/hooks/use-tilt';
import { analyze } from '@/lib/api';
import { useApiKey } from '@/hooks/use-api-key';
import { useCameraPermission } from '@/hooks/use-camera-permission';
import {
  addErrorListener,
  focusAt,
  setExposureCompensation,
  setFlashMode,
  setZoom as setZoomValue,
  formatShutterNs,
  parseShutterToNs,
  setManual,
  addParamsListener,
  addReadyListener,
  addVolumeKeyListener,
  Camera2Preview,
  getCapabilities,
  grabPreview,
  takePicture,
  type Camera2CapsFull,
  type Camera2Params,
  type FlashMode,
} from '@/lib/native-camera2';
import { cropToAspect, toAnalysisBase64 } from '@/lib/analysis-image';
import type { PhotoMeta } from '@/lib/exif';
import type { AdjustParams, LiveSuggestion } from '@/lib/types';
import { setLastCapture, setReviewState, takePendingAdjust } from '@/lib/capture-store';
import { addHistoryEntry, loadHistory, persistPhoto, updateHistoryEntry } from '@/lib/history';
import { liveAnalysisEnabled, thinkingOf, useSettings } from '@/lib/settings';
import { saveToAlbum } from '@/lib/media';
import { palette, radius, spacing, tabularNums, type, weight } from '@/lib/theme';

const MAX_CONSECUTIVE_FAILURES = 3;
/** 预览填充比例,实测调出来的默认值 */
const DEFAULT_PREVIEW_FILL = 0.25;
/** 语音模式下两次分析的最小间隔:防止 TTS 秒回/失败导致连续轰炸接口 */
const VOICE_MIN_ANALYZE_GAP_MS = 1500;
/** 语音模式下定时器的兜底周期(真正的节奏由播报驱动) */
const VOICE_FALLBACK_TICK_MS = 10000;

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
  /** 定时器:0 = 关闭,3 / 10 秒 */
  const [timerSec, setTimerSec] = useState(0);
  /** 正在倒计时时显示剩余秒数 */
  const [countdown, setCountdown] = useState<number | null>(null);
  /** 专业面板是否展开 */
  const [proOpen, setProOpen] = useState(false);
  const [proSelection, setProSelection] = useState<ProSelection>(AUTO_SELECTION);
  /** 连续失败后暂停自动分析,直到用户手动重试(不改用户设置) */
  const [paused, setPaused] = useState(false);

  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 快门前的建议要带给点评,用 ref 保存以免闭包过期
  const lastSuggestionRef = useRef<{ headline: string; action: string } | null>(null);
  useEffect(() => {
    lastSuggestionRef.current =
      suggestion && suggestion.mode === 'live'
        ? { headline: suggestion.headline, action: suggestion.action }
        : null;
  }, [suggestion]);

  /**
   * 当前画面是否可以拍了。
   * **纯提示**:出错、暂停、没有建议时都是 false,但快门永远可用。
   */
  const readyToShoot =
    liveOn && !paused && !error && suggestion?.mode === 'live' && suggestion.readyToShoot === true;

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

  /**
   * 正在语音播报。
   * 播报期间**冻结取景建议**:不发新请求、不换文字。
   * 否则 3 秒一轮的建议会在语音说到一半时把内容顶掉,
   * 用户听到的和看到的还不一样。
   */
  const speakingRef = useRef(false);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnalyzeAtRef = useRef(0);
  const followUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopSpeaking = useCallback(() => {
    speakingRef.current = false;
    if (followUpRef.current) {
      clearTimeout(followUpRef.current);
      followUpRef.current = null;
    }
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    void Speech.stop();
  }, []);

  const runLiveAnalysis = useCallback(async () => {
    // 正在拍照时不抓帧,避免打扰
    if (!ready || analyzeBusyRef.current || captureBusyRef.current) return;
    // 正在念上一条:等它念完,不要中途换内容
    if (speakingRef.current) return;
    lastAnalyzeAtRef.current = Date.now();

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
          const rect = previewRectRef.current;
          if (!rect.width || !rect.height) return;
          const nx = Math.min(1, Math.max(0, (event.x - rect.x) / rect.width));
          const ny = Math.min(1, Math.max(0, (event.y - rect.y) / rect.height));
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

  /** 定时器三态循环:关 → 3s → 10s → 关 */
  const cycleTimer = useCallback(() => {
    setTimerSec((prev) => (prev === 0 ? 3 : prev === 3 ? 10 : 0));
  }, [setTimerSec]);

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

  // 语音播报:默认关闭,开启后每次新建议读一遍(可拍时读"可以拍了")
  const lastSpokenRef = useRef<string>('');
  useEffect(() => {
    if (!settings.voiceGuide || !focused || !appActive) return;
    if (!suggestion || suggestion.mode !== 'live') return;

    const text = suggestion.readyToShoot ? suggestion.headline : suggestion.action;
    if (!text || text === lastSpokenRef.current) return;
    lastSpokenRef.current = text;

    speakingRef.current = true;

    // 兜底:某些 TTS 引擎不会回调 onDone,标记会一直卡住导致再也不分析
    const estimated = Math.min(15000, text.length * 220 + 2500);
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    speakingTimerRef.current = setTimeout(() => {
      speakingRef.current = false;
      speakingTimerRef.current = null;
      if (focused && appActive) void runLiveAnalysis();
    }, estimated);

    const finish = () => {
      speakingRef.current = false;
      if (speakingTimerRef.current) {
        clearTimeout(speakingTimerRef.current);
        speakingTimerRef.current = null;
      }
      // 说完立刻补一次分析,不用干等到下一个间隔;
      // 但要和上一次分析隔开,避免 TTS 秒回时陷入连续请求
      const wait = Math.max(0, VOICE_MIN_ANALYZE_GAP_MS - (Date.now() - lastAnalyzeAtRef.current));
      if (followUpRef.current) clearTimeout(followUpRef.current);
      followUpRef.current = setTimeout(() => {
        followUpRef.current = null;
        if (focused && appActive) void runLiveAnalysis();
      }, wait);
    };

    void Speech.stop().then(() => {
      Speech.speak(text, {
        language: 'zh-CN',
        rate: 1.0,
        onDone: finish,
        onStopped: finish,
        onError: finish,
      });
    });
  }, [settings.voiceGuide, focused, appActive, suggestion, runLiveAnalysis]);

  // 离开页面/退到后台就闭嘴
  useEffect(() => {
    if (focused && appActive) return;
    stopSpeaking();
  }, [focused, appActive, stopSpeaking]);

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
    // 用户主动换一条:打断当前播报
    stopSpeaking();
    lastSpokenRef.current = '';
    setPaused(false);
    failuresRef.current = 0;
    void runLiveAnalysis();
  }, [runLiveAnalysis, setPaused, stopSpeaking]);

  useEffect(() => {
    if (!liveOn || paused || !focused || !appActive || !ready || !keyReady || !permission.granted) return;
    const warmup = setTimeout(() => void runLiveAnalysis(), 700);
    const tickMs = settings.voiceGuide ? VOICE_FALLBACK_TICK_MS : settings.intervalSec * 1000;
    const timer = setInterval(() => void runLiveAnalysis(), tickMs);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [liveOn, paused, focused, appActive, ready, keyReady, permission.granted, runLiveAnalysis, settings.intervalSec, settings.voiceGuide, setPaused]);

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
      const shot = await takePicture();
      if (!shot?.path) throw new Error('拍照失败');
      const rawUri = `file://${shot.path}`;
      // 预览只显示了取景画面的一部分时,照片也要按同样的比例裁切;
      // shot.rotation 告诉我们对横向存储的照片该换算哪个坐标轴
      const shotUri = await cropToAspect(rawUri, previewRectRef.current.aspect, shot.rotation).catch(
        () => rawUri,
      );

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
      const lastSuggestion = lastSuggestionRef.current;
      setLastCapture({ uri: stableUri, saved, meta: photoMeta, lastSuggestion });
      // 没有 API Key 就不发请求 —— 宁可明说"没有点评",也不要在复盘页转圈到超时
      setReviewState(
        keyReady
          ? { status: 'analyzing' }
          : { status: 'failed', error: '没有配置 API Key,这张只保存了照片。相机功能不受影响。' },
      );
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

      if (!keyReady) {
        updateHistoryEntry(entryId, { status: 'failed', error: '没有配置 API Key' });
        return;
      }

      void (async () => {
          try {
            // 只给模型用的一份缩略图,不影响相册和复盘页显示的原图
            const base64 = await toAnalysisBase64(photoUri, 0, 0);
            if (mySeq !== reviewSeq.current) return;
            const result = await analyze(base64, 'capture', {
              thinking: thinkingOf(settings),
              endpoint: settings.apiEndpoint,
              meta: photoMeta,
              lastLiveSuggestion: lastSuggestion,
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
  }, [flash, ready, settings, currentMeta, keyReady, setCapturing, setError]);

  /** 倒计时进行中:每秒减一,到 0 自动拍 */
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      // 放到下一个任务里执行,避免在 effect 里同步 setState
      const done = setTimeout(() => {
        setCountdown(null);
        void handleCapture();
      }, 0);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => setCountdown((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, handleCapture]);

  /** 快门入口:有定时就先倒计时 */
  const onShutterPress = useCallback(() => {
    if (countdown !== null) {
      setCountdown(null);
      return;
    }
    if (timerSec > 0) {
      setCountdown(timerSec);
      return;
    }
    void handleCapture();
  }, [countdown, timerSec, setCountdown, handleCapture]);

  // 音量键当快门:订阅随 onShutterPress 更新,避免闭包过期
  useEffect(() => addVolumeKeyListener(() => onShutterPress()), [onShutterPress]);




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

      {/* 定时器倒计时 */}
      {countdown !== null ? (
        <Pressable style={styles.countdownLayer} onPress={() => setCountdown(null)}>
          <Text style={styles.countdownText}>{countdown}</Text>
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
              suggestion={suggestion}
              analyzing={analyzing}
              error={error}
              liveOn={liveOn}
              paused={paused}
              onOpenSettings={() => router.push('/settings')}
              onRefresh={retryNow}
            />
          ) : null}

          <View style={styles.controls} pointerEvents="box-none">
            <View style={styles.leftControls}>
              <Pressable style={styles.sideButton} onPress={() => setProOpen((v) => !v)} hitSlop={10}>
                <Text style={[styles.sideButtonText, proOpen && { color: palette.accent }]}>专业</Text>
              </Pressable>
              <Pressable style={styles.sideButton} onPress={cycleTimer} hitSlop={10}>
                <Text style={[styles.sideButtonText, timerSec > 0 && { color: palette.accent }]}>
                  {timerSec === 0 ? '定时' : `${timerSec}s`}
                </Text>
              </Pressable>
            </View>

            <Pressable
              style={[
                styles.shutter,
                readyToShoot && styles.shutterReady,
                capturing && { opacity: 0.6 },
              ]}
              onPress={onShutterPress}
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
