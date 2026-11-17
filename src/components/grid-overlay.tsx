import { StyleSheet, View } from 'react-native';

import { palette, spacing } from '@/lib/theme';

/** 三分法构图辅助线 + 中心准星 */
export function GridOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={[styles.vLine, { left: '33.333%' }]} />
      <View style={[styles.vLine, { left: '66.666%' }]} />
      <View style={[styles.hLine, { top: '33.333%' }]} />
      <View style={[styles.hLine, { top: '66.666%' }]} />
      <View style={styles.centerDot} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: palette.fillStrong,
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: palette.fillStrong,
  },
  centerDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: spacing.xs,
    height: spacing.xs,
    marginLeft: -spacing.xxs,
    marginTop: -spacing.xxs,
    borderRadius: spacing.xxs,
    backgroundColor: palette.fillStrong,
  },
});
