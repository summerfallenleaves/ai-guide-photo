import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Camera2CapsFull, Camera2Params } from '@/infra/camera/native-camera2';
import { formatShutterNs } from '@/infra/camera/native-camera2';
import { palette, radius, spacing, tabularNums, type, weight } from '@/theme';

/** 每一轴的选择:null 表示自动 */
export type ProSelection = {
  ev: number | null;
  iso: number | null;
  shutterNs: number | null;
  focusDiopters: number | null;
  kelvin: number | null;
};

export const AUTO_SELECTION: ProSelection = {
  ev: null,
  iso: null,
  shutterNs: null,
  focusDiopters: null,
  kelvin: null,
};

const SHUTTER_PRESETS: { label: string; ns: number }[] = [
  { label: '1/1000', ns: 1_000_000 },
  { label: '1/250', ns: 4_000_000 },
  { label: '1/60', ns: 16_666_667 },
  { label: '1/15', ns: 66_666_667 },
  { label: '1/4', ns: 250_000_000 },
  { label: '1s', ns: 1_000_000_000 },
];

const FOCUS_PRESETS: { label: string; diopters: number }[] = [
  { label: '∞', diopters: 0 },
  { label: '3m', diopters: 1 / 3 },
  { label: '1m', diopters: 1 },
  { label: '0.5m', diopters: 2 },
];

const WB_PRESETS = [3000, 4000, 5500, 6500];
const ISO_PRESETS = [100, 200, 400, 800];

type Props = {
  visible: boolean;
  caps: Camera2CapsFull | null;
  liveParams: Camera2Params | null;
  selection: ProSelection;
  onChange: (next: ProSelection) => void;
  onClose: () => void;
};

/**
 * 专业参数面板。
 *
 * **半透明**是刻意的:调参数时要能同时看到画面变化,不能把取景挡住。
 * 每一轴都是「自动 / 若干档位」,点一下立即生效。
 */
export function ProCameraPanel({ visible, caps, liveParams, selection, onChange, onClose }: Props) {
  if (!visible) return null;

  const isoCandidates = caps
    ? ISO_PRESETS.filter((v) => v >= caps.isoMin && v <= caps.isoMax)
    : ISO_PRESETS;
  const evCandidates = caps
    ? buildEvSteps(caps.evMin ?? -2, caps.evMax ?? 2)
    : [-2, -1, 0, 1, 2];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>专业参数</Text>
          <View style={styles.headerRight}>
            <Text style={styles.readout}>
              {liveParams ? `ISO ${liveParams.iso} · ${formatShutterNs(liveParams.exposureNs)}` : '—'}
            </Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeHit}>
              <Text style={styles.close}>收起</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal={false} showsVerticalScrollIndicator={false} style={styles.scroll}>
          <Row
            label="曝光补偿"
            isAuto={selection.ev === null}
            onAuto={() => onChange({ ...selection, ev: null })}
            options={evCandidates.map((v) => ({
              key: String(v),
              label: v === 0 ? '0' : v > 0 ? `+${v}` : String(v),
              active: selection.ev === v,
              onPress: () => onChange({ ...selection, ev: v }),
            }))}
          />

          <Row
            label="ISO"
            isAuto={selection.iso === null}
            onAuto={() => onChange({ ...selection, iso: null })}
            options={isoCandidates.map((v) => ({
              key: String(v),
              label: String(v),
              active: selection.iso === v,
              onPress: () => onChange({ ...selection, iso: v }),
            }))}
          />

          <Row
            label="快门"
            isAuto={selection.shutterNs === null}
            onAuto={() => onChange({ ...selection, shutterNs: null })}
            options={SHUTTER_PRESETS.map((p) => ({
              key: String(p.ns),
              label: p.label,
              active: selection.shutterNs === p.ns,
              onPress: () => onChange({ ...selection, shutterNs: p.ns }),
            }))}
          />

          <Row
            label="对焦"
            isAuto={selection.focusDiopters === null}
            onAuto={() => onChange({ ...selection, focusDiopters: null })}
            options={FOCUS_PRESETS.map((p) => ({
              key: String(p.diopters),
              label: p.label,
              active: selection.focusDiopters === p.diopters,
              onPress: () => onChange({ ...selection, focusDiopters: p.diopters }),
            }))}
          />

          <Row
            label="白平衡"
            isAuto={selection.kelvin === null}
            onAuto={() => onChange({ ...selection, kelvin: null })}
            options={WB_PRESETS.map((k) => ({
              key: String(k),
              label: `${k}K`,
              active: selection.kelvin === k,
              onPress: () => onChange({ ...selection, kelvin: k }),
            }))}
          />

          <Text style={styles.hint}>
            ISO 和快门要同时手动才生效(只给一个会自动回到自动曝光)。
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

function buildEvSteps(min: number, max: number): number[] {
  const steps: number[] = [];
  const lo = Math.max(-3, Math.round(min));
  const hi = Math.min(3, Math.round(max));
  for (let v = lo; v <= hi; v += 1) steps.push(v);
  return steps.length > 0 ? steps : [0];
}

function Row({
  label,
  isAuto,
  onAuto,
  options,
}: {
  label: string;
  isAuto: boolean;
  onAuto: () => void;
  options: { key: string; label: string; active: boolean; onPress: () => void }[];
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="自动" active={isAuto} onPress={onAuto} />
        {options.map((option) => (
          <Chip key={option.key} label={option.label} active={option.active} onPress={option.onPress} />
        ))}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  panel: {
    backgroundColor: 'rgba(20,20,24,0.78)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: spacing.xl,
    gap: spacing.lg,
    maxHeight: 320,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  title: { ...type.headline },
  readout: { ...type.caption, ...tabularNums, color: palette.textDim },
  closeHit: { paddingVertical: spacing.xxs },
  close: { ...type.callout, color: palette.accent },
  scroll: { maxHeight: 260 },
  row: { gap: spacing.sm, marginBottom: spacing.lg },
  rowLabel: { ...type.caption, color: palette.textFaint, fontWeight: weight.bold },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: palette.fill,
  },
  chipActive: { backgroundColor: palette.accent },
  chipText: { ...type.caption, color: palette.text },
  chipTextActive: { color: palette.onAccent, fontWeight: weight.bold },
  hint: { ...type.caption, color: palette.textFaint, lineHeight: 16 },
});
