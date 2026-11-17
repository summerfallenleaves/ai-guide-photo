import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, radius, type } from '@/lib/theme';
import type { FlashMode } from '@/lib/native-camera2';

const LABELS: Record<FlashMode, string> = { off: '关', auto: '自动', torch: '常亮' };

/** 闪光灯三态循环:关 → 自动 → 常亮 */
export function FlashButton({ mode, onPress }: { mode: FlashMode; onPress: () => void }) {
  const on = mode !== 'off';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`闪光灯:${LABELS[mode]}`}
      style={({ pressed }) => [styles.root, on && styles.active, pressed && styles.pressed]}>
      <Text style={[styles.glyph, on && styles.glyphActive]}>⚡</Text>
      <Text style={[styles.label, on && styles.glyphActive]}>{LABELS[mode]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.scrim,
  },
  active: {
    backgroundColor: palette.accentSoft,
    borderColor: palette.accent,
  },
  pressed: { opacity: 0.6 },
  glyph: { ...type.caption, color: palette.text },
  glyphActive: { color: palette.accent },
  label: { ...type.caption, color: palette.textDim },
});
