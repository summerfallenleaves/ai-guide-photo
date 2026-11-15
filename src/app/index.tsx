import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GridOverlay } from '@/components/grid-overlay';
import { LevelBadge } from '@/components/level-badge';
import { SuggestionCard } from '@/components/suggestion-card';
import { useTilt } from '@/hooks/use-tilt';
import { analyze, API_BASE_URL } from '@/lib/api';
import { setLastCapture } from '@/lib/capture-store';
import { palette, radius } from '@/lib/theme';
import type { CaptureResult, LiveSuggestion } from '@/lib/types';

const LIVE_INTERVAL_MS = 3000;
const MAX_CONSECUTIVE_FAILURES = 3;

export default function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = useMediaPermissions({
    writeOnly: true,
    granularPermissions: ['photo'],
  });

  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [autoOn, setAutoOn] = useState(true);

  const [suggestion, setSuggestion] = useState<LiveSuggestion | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const busyRef = useRef(false);
  const failuresRef = useRef(0);
  const flash = useMemo(() => new Animated.Value(0), []);

  const tilt = useTilt(focused && ready);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const runLiveAnalysis = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || busyRef.current || !ready) return;

    busyRef.current = true;
    setAnalyzing(true);
    try {
      const shot = await cam.takePictureAsync({
        quality: 0.3,
        base64: true,
        shutterSound: false,
      });
      if (!shot?.base64) throw new Error('抓帧失败');

      const result = await analyze(shot.base64, 'live');
      if (result.mode === 'live') {
        setSuggestion(result);
        setError(null);
        failuresRef.current = 0;
      }
    } catch (err) {
      failuresRef.current += 1;
      setError((err as Error).message);
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) setAutoOn(false);
    } finally {
      busyRef.current = false;
      setAnalyzing(false);
    }
  }, [ready]);

  useEffect(() => {
    if (!autoOn || !focused || !ready || !permission?.granted) return;
    const warmup = setTimeout(() => void runLiveAnalysis(), 700);
    const timer = setInterval(() => void runLiveAnalysis(), LIVE_INTERVAL_MS);
    return () => {
      clearTimeout(warmup);
      clearInterval(timer);
    };
  }, [autoOn, focused, ready, permission?.granted, runLiveAnalysis]);

  const ensureMediaPermission = useCallback(async () => {
    if (mediaPermission?.granted) return true;
    const res = await requestMediaPermission();
    return res.granted;
  }, [mediaPermission?.granted, requestMediaPermission]);

  const handleCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || busyRef.current || !ready) return;

    busyRef.current = true;
    setCapturing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    Animated.sequence([
      Animated.timing(flash, { toValue: 0.85, duration: 60, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();

    try {
      const shot = await cam.takePictureAsync({ quality: 0.7, base64: true });
      if (!shot?.uri) throw new Error('拍照失败');

      // Android 13+ 写相册其实不需要运行时权限,先直接写;
      // 失败了再申请权限重试(兼容旧系统 / iOS)
      let saved = false;
      try {
        await Asset.create(shot.uri);
        saved = true;
      } catch (firstErr) {
        try {
          if (await ensureMediaPermission()) {
            await Asset.create(shot.uri);
            saved = true;
          }
        } catch (err) {
          console.warn('[capture] 保存相册失败:', firstErr, err);
        }
      }

      let review: CaptureResult | null = null;
      if (shot.base64) {
        try {
          const result = await analyze(shot.base64, 'capture');
          if (result.mode === 'capture') review = result;
        } catch (err) {
          setError((err as Error).message);
        }
      }

      setLastCapture({
        uri: shot.uri,
        saved,
        payload: review ? JSON.stringify(review) : '',
      });

      router.push({
        pathname: '/review',
        params: {
          uri: shot.uri,
          saved: saved ? '1' : '0',
          payload: review ? JSON.stringify(review) : '',
        },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busyRef.current = false;
      setCapturing(false);
    }
  }, [flash, ready, ensureMediaPermission]);

  if (!permission) {
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
          <Pressable style={styles.gateButton} onPress={() => void requestPermission()}>
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
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        animateShutter={false}
        onCameraReady={() => setReady(true)}
        onMountError={(e) => setError(`相机启动失败:${e.message}`)}
      />

      <GridOverlay visible={showGrid} />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.brand}>
            <Text style={styles.brandText}>AI 拍照引导</Text>
            <Text style={styles.brandSub}>长按快门可连续拍摄</Text>
          </View>
          <LevelBadge tilt={tilt} />
        </View>

        <View style={styles.bottomBlock} pointerEvents="box-none">
          <SuggestionCard
            suggestion={suggestion}
            analyzing={analyzing}
            error={error}
            autoOn={autoOn}
            onToggleAuto={() => setAutoOn((v) => !v)}
            onRefresh={() => void runLiveAnalysis()}
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

          <Text style={styles.hint}>{API_BASE_URL}</Text>
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
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
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
