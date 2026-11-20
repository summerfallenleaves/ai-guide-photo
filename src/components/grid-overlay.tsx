import { StyleSheet, View } from 'react-native';

import { palette } from '@/theme';

/**
 * 九宫格构图辅助线。
 *
 * 画在取景矩形之内(不是整屏),所以和最终照片的比例一致。
 *
 * 每条线都画两层:**暗色打底 + 亮线压在上面**。
 * 只画亮线时,白墙 / 天空这类亮背景上会完全看不见;只画暗线时,夜景里又看不见。
 * 双层是这个场景的通行做法。
 */
export function GridOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <View pointerEvents="none" style={styles.root}>
      {/* 外框:没有它时最外 8 格的边界是屏幕边缘,看起来只有中间一个"井" */}
      <View style={styles.frame} />
      <Line vertical at="33.333%" />
      <Line vertical at="66.666%" />
      <Line at="33.333%" />
      <Line at="66.666%" />
    </View>
  );
}

function Line({ at, vertical }: { at: `${number}%`; vertical?: boolean }) {
  return (
    <View style={[vertical ? styles.vHalo : styles.hHalo, vertical ? { left: at } : { top: at }]}>
      <View style={vertical ? styles.vLine : styles.hLine} />
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
  frame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.gridLine,
  },
  vHalo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    alignItems: 'center',
    backgroundColor: palette.gridHalo,
  },
  hHalo: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    justifyContent: 'center',
    backgroundColor: palette.gridHalo,
  },
  vLine: { width: StyleSheet.hairlineWidth, flex: 1, backgroundColor: palette.gridLine },
  hLine: { height: StyleSheet.hairlineWidth, flex: 1, backgroundColor: palette.gridLine },
});
