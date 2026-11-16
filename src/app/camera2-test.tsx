import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addParamsListener,
  Camera2Preview,
  formatShutterNs,
  getCapabilities,
  isNativeCameraAvailable,
  setManual,
  takePicture,
  type Camera2Caps,
  type Camera2Params,
} from '@/lib/native-camera2';
import { palette, radius } from '@/lib/theme';

const EXPOSURE_PRESETS: { label: string; iso: number; ns: number }[] = [
  { label: 'ISO100 · 1/1000', iso: 100, ns: 1_000_000 },
  { label: 'ISO200 · 1/250', iso: 200, ns: 4_000_000 },
  { label: 'ISO400 · 1/60', iso: 400, ns: 16_666_667 },
  { label: 'ISO800 · 1/15', iso: 800, ns: 66_666_667 },
];

const FOCUS_PRESETS: { label: string; diopters: number }[] = [
  { label: '∞ 远景', diopters: 0 },
  { label: '3m', diopters: 1 / 3 },
  { label: '1m', diopters: 1 },
  { label: '0.5m', diopters: 2 },
];

const WB_PRESETS = [3000, 4000, 5500, 6500];

/** 阶段 1 验收页:手动 ISO / 快门 / 对焦 / 白平衡 */
export default function Camera2TestScreen() {
  const available = isNativeCameraAvailable();

  const [caps, setCaps] = useState<Camera2Caps | null>(null);
  const [params, setParams] = useState<Camera2Params | null>(null);
  const [activeExposure, setActiveExposure] = useState<string>('auto');
  const [activeFocus, setActiveFocus] = useState<string>('auto');
  const [activeWb, setActiveWb] = useState<number | 'auto'>('auto');

  const [shot, setShot] = useState<string | null>(null);
  const [status, setStatus] = useState('等待预览…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    const off = addParamsListener(setParams);
    const timer = setTimeout(() => {
      void getCapabilities().then(setCaps);
    }, 1200);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [available]);

  const applyExposure = (preset: (typeof EXPOSURE_PRESETS)[number] | null) => {
    if (!preset) {
      setActiveExposure('auto');
      setManual({ iso: null, exposureNs: null });
      return;
    }
    setActiveExposure(preset.label);
    setManual({ iso: preset.iso, exposureNs: preset.ns });
  };

  const applyFocus = (preset: (typeof FOCUS_PRESETS)[number] | null) => {
    if (!preset) {
      setActiveFocus('auto');
      setManual({ focusDiopters: null });
      return;
    }
    setActiveFocus(preset.label);
    setManual({ focusDiopters: preset.diopters });
  };

  const applyWb = (k: number | 'auto') => {
    setActiveWb(k);
    setManual({ kelvin: k === 'auto' ? null : k });
  };

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('正在拍照…');
    try {
      const path = await takePicture();
      setShot(`file://${path}`);
      setStatus(`拍照成功:${path.split('/').pop()}`);
    } catch (err) {
      setStatus(`拍照失败:${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      {available ? <Camera2Preview style={StyleSheet.absoluteFill} facing="back" /> : null}

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.title}>手动参数验证</Text>
          <View style={{ width: 48 }} />
        </View>

        <View style={styles.bottom}>
          <View style={styles.card}>
            <View style={styles.readout}>
              <Cell label="ISO" value={params?.iso ? String(params.iso) : '—'} />
              <Cell label="快门" value={formatShutterNs(params?.exposureNs ?? 0)} />
              <Cell
                label="对焦"
                value={params && params.focusDiopters > 0 ? `${(1 / params.focusDiopters).toFixed(1)}m` : '∞'}
              />
              <Cell label="模式" value={params?.manual ? '手动' : '自动'} />
            </View>
            {caps ? (
              <Text style={styles.caps}>
                可调范围:ISO {caps.isoMin}~{caps.isoMax} · 快门 {formatShutterNs(caps.exposureMaxNs)}~
                {formatShutterNs(caps.exposureMinNs)}
              </Text>
            ) : null}
          </View>

          <ChipRow
            title="曝光"
            items={[{ key: 'auto', label: '自动' }, ...EXPOSURE_PRESETS.map((p) => ({ key: p.label, label: p.label }))]}
            active={activeExposure}
            onPick={(key) => applyExposure(key === 'auto' ? null : EXPOSURE_PRESETS.find((p) => p.label === key) ?? null)}
          />

          <ChipRow
            title="对焦"
            items={[{ key: 'auto', label: '自动' }, ...FOCUS_PRESETS.map((p) => ({ key: p.label, label: p.label }))]}
            active={activeFocus}
            onPick={(key) => applyFocus(key === 'auto' ? null : FOCUS_PRESETS.find((p) => p.label === key) ?? null)}
          />

          <ChipRow
            title="白平衡"
            items={[{ key: 'auto', label: '自动' }, ...WB_PRESETS.map((k) => ({ key: String(k), label: `${k}K` }))]}
            active={String(activeWb)}
            onPick={(key) => applyWb(key === 'auto' ? 'auto' : Number(key))}
          />

          {shot ? <Image source={{ uri: shot }} style={styles.thumb} resizeMode="contain" /> : null}
          <Text style={styles.status}>{status}</Text>

          <Pressable
            onPress={() => void shoot()}
            disabled={busy || !available}
            style={[styles.shutter, (busy || !available) && { opacity: 0.5 }]}>
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

function ChipRow({
  title,
  items,
  active,
  onPick,
}: {
  title: string;
  items: { key: string; label: string }[];
  active: string;
  onPick: (key: string) => void;
}) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.chipTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {items.map((item) => {
          const on = item.key === active;
          return (
            <Pressable
              key={item.key}
              onPress={() => onPick(item.key)}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  back: { color: palette.accent, fontSize: 15, fontWeight: '600', width: 48 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottom: { gap: 8, paddingBottom: 6 },
  card: {
    backgroundColor: 'rgba(20,20,24,0.88)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: 10,
    gap: 6,
  },
  readout: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: { alignItems: 'center', flex: 1 },
  cellLabel: { color: palette.textFaint, fontSize: 10 },
  cellValue: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  caps: { color: palette.textDim, fontSize: 10.5 },
  chipBlock: { gap: 4 },
  chipTitle: { color: palette.textDim, fontSize: 11, fontWeight: '600', paddingLeft: 2 },
  chipRow: { gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  chipOn: { backgroundColor: palette.accent },
  chipText: { color: '#fff', fontSize: 11.5, fontWeight: '600' },
  chipTextOn: { color: '#00131F' },
  thumb: { height: 90, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.06)' },
  status: { color: '#fff', fontSize: 11.5 },
  shutter: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff' },
});
