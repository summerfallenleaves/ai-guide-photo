import { StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing, type, weight, tabularNums } from '@/lib/theme';

const LEVEL_THRESHOLD = 1.5;

/** 实时水平仪:纯端侧(加速度计),不联网、不耗电、零延迟 */
export function LevelBadge({ tilt }: { tilt: number | null }) {
  const unknown = tilt === null;
  const level = !unknown && Math.abs(tilt) < LEVEL_THRESHOLD;
  const color = unknown ? palette.textFaint : level ? palette.good : palette.warn;

  return (
    <View style={[styles.root, { borderColor: level ? palette.goodBorder : palette.border }]}>
      <View style={styles.tiltTrack}>
        <View
          style={[
            styles.tiltBar,
            {
              backgroundColor: color,
              transform: [{ rotate: `${clamp(unknown ? 0 : tilt, -18, 18)}deg` }],
            },
          ]}
        />
      </View>
      <Text style={[styles.label, { color }]}>
        {unknown ? '水平 —' : level ? '水平 ✓' : `${tilt > 0 ? '↘' : '↙'} ${Math.abs(tilt).toFixed(1)}°`}
      </Text>
    </View>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: palette.scrim,
  },
  tiltTrack: {
    width: spacing.xxl + spacing.xxs,
    height: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiltBar: {
    width: spacing.xl + spacing.xxs,
    height: spacing.xxs,
    borderRadius: 1,
  },
  label: {
    fontSize: type.caption.fontSize,
    fontWeight: weight.semibold,
    ...tabularNums,
  },
});
