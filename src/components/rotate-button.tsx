import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, radius } from '@/lib/theme';

/**
 * 方向锁定按钮。
 *
 * - 未锁定(默认):跟随手机自动旋转
 * - 已锁定:界面固定在当前方向
 *
 * 注意它**不再强制把界面转成另一个方向**,那样会让整个屏幕(含文字)侧过来。
 */
export function RotateButton({ onPress, locked }: { onPress: () => void; locked: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={locked ? '解除方向锁定' : '锁定当前方向'}
      style={({ pressed }) => [styles.root, locked && styles.locked, pressed && styles.pressed]}>
      <Text style={[styles.glyph, locked && styles.glyphLocked]}>{locked ? '🔒' : '↻'}</Text>
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
  locked: {
    backgroundColor: 'rgba(91,200,255,0.28)',
    borderColor: palette.accent,
  },
  pressed: {
    opacity: 0.55,
  },
  glyph: {
    color: palette.text,
    fontSize: 15,
    lineHeight: 20,
  },
  glyphLocked: {
    fontSize: 13,
  },
});
