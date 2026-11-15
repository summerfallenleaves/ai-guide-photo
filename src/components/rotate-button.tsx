import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, radius } from '@/lib/theme';

/** 强制切换横竖屏。放在取景页角落,不受系统"自动旋转"开关影响。 */
export function RotateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel="切换横竖屏"
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}>
      <Text style={styles.glyph}>↻</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  pressed: {
    opacity: 0.55,
  },
  glyph: {
    color: palette.text,
    fontSize: 17,
    lineHeight: 20,
  },
});
