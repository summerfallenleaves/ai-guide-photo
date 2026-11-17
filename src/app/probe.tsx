import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatShutter,
  isProbeAvailable,
  mainBackCamera,
  probeCameras,
  type CameraCapability,
} from '@/lib/camera-probe';
import { palette, radius, type, weight } from '@/lib/theme';

export default function ProbeScreen() {
  const [list, setList] = useState<CameraCapability[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 递增用来重跑探测,避免在 effect 里同步 setState */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!isProbeAvailable()) {
          throw new Error('当前运行环境没有探测模块。请安装最新的 APK 后再打开这一页(Expo Go 里不可用)。');
        }
        return probeCameras();
      })
      .then((data) => {
        if (!cancelled) setList(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const retry = () => {
    setList(null);
    setError(null);
    setNonce((n) => n + 1);
  };

  const back = mainBackCamera(list ?? []);
  const supported = !!back?.manualSensor;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title}>相机能力探测</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <View style={styles.card}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.btn} onPress={retry}>
              <Text style={styles.btnText}>重试</Text>
            </Pressable>
          </View>
        ) : null}

        {!error && !list ? (
          <View style={styles.card}>
            <ActivityIndicator color={palette.accent} />
            <Text style={styles.dim}>正在读取相机参数…</Text>
          </View>
        ) : null}

        {back ? (
          <View style={[styles.card, { borderColor: supported ? palette.good : palette.danger }]}>
            <Text style={[styles.verdict, { color: supported ? palette.good : palette.danger }]}>
              {supported ? '✅ 支持手动 ISO / 快门' : '❌ 不支持手动 ISO / 快门'}
            </Text>
            <Text style={styles.dim}>
              {supported
                ? '可以迁移到支持手动控制的相机方案,AI 给出的参数建议能真正应用。'
                : '这台设备不提供 MANUAL_SENSOR,手动控制这条路走不通,建议维持现状(只给建议)。'}
            </Text>
          </View>
        ) : null}

        {list?.map((cam) => (
          <View key={cam.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              相机 {cam.id} · {cam.lensFacing === 1 ? '后置' : cam.lensFacing === 0 ? '前置' : '其他'}
            </Text>
            <Row label="硬件等级" value={cam.hardwareLevel ?? '—'} />
            <Row label="手动 ISO/快门" value={cam.manualSensor ? '支持' : '不支持'} />
            <Row label="手动对焦/白平衡" value={cam.manualPostProcessing ? '支持' : '不支持'} />
            <Row label="手动曝光模式" value={cam.manualExposureMode ? '支持' : '不支持'} />
            <Row label="手动对焦模式" value={cam.manualFocus ? '支持' : '不支持'} />
            <Row label="手动白平衡" value={cam.manualWhiteBalance ? '支持' : '不支持'} />
            <Row
              label="ISO 范围"
              value={cam.isoMin !== undefined ? `${cam.isoMin} ~ ${cam.isoMax}` : '—'}
            />
            <Row
              label="快门范围"
              value={`${formatShutter(cam.exposureMaxNs)} ~ ${formatShutter(cam.exposureMinNs)}`}
            />
            <Row label="光圈" value={cam.aperture ? `f/${cam.aperture.toFixed(1)}` : '—'} />
            <Row label="焦距" value={cam.focalLengthMm ? `${cam.focalLengthMm.toFixed(2)} mm` : '—'} />
            <Row
              label="传感器"
              value={
                cam.sensorWidthMm && cam.sensorHeightMm
                  ? `${cam.sensorWidthMm.toFixed(2)} × ${cam.sensorHeightMm.toFixed(2)} mm`
                  : '—'
              }
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 64 },
  backText: { color: palette.accent, fontSize: type.body.fontSize, fontWeight: weight.semibold },
  title: { color: palette.text, fontSize: type.headline.fontSize, fontWeight: weight.bold },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: palette.fillSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: 14,
    gap: 8,
  },
  cardTitle: { color: palette.text, fontSize: type.body.fontSize, fontWeight: weight.bold, marginBottom: 2 },
  verdict: { fontSize: type.headline.fontSize, fontWeight: weight.heavy },
  dim: { color: palette.textDim, fontSize: type.subhead.fontSize, lineHeight: 19 },
  errorText: { color: palette.danger, fontSize: type.callout.fontSize, lineHeight: 20 },
  btn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.fill,
  },
  btnText: { color: palette.text, fontSize: type.callout.fontSize, fontWeight: weight.semibold },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { color: palette.textFaint, fontSize: type.subhead.fontSize },
  rowValue: { color: palette.text, fontSize: type.subhead.fontSize, fontWeight: weight.semibold, fontVariant: ['tabular-nums'] },
});
