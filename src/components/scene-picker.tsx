import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SCENES, SCENE_ORDER } from '@/domain/guidance/scenes';
import type { SceneId } from '@/domain/shared/types';
import { palette, radius, spacing, type, weight } from '@/theme';

type Props = {
  value: SceneId;
  onChange: (next: SceneId) => void;
  /** 会话中只显示当前场景(点击才展开) */
  compact?: boolean;
};

/**
 * 场景选择:5 个 chip 单选。
 *
 * 为什么是手选而不是自动判:场景判断错了会让整段建议用错标准,
 * 而用户点一下的成本远低于一次误判。
 */
export function ScenePicker({ value, onChange, compact = false }: Props) {
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {SCENE_ORDER.map((id) => {
        const active = id === value;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            hitSlop={6}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.label, active && styles.labelActive]}>{SCENES[id].label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowCompact: { gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.fill,
  },
  chipActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  label: { color: palette.textDim, fontSize: type.caption.fontSize, fontWeight: weight.medium },
  labelActive: { color: palette.onAccent, fontWeight: weight.bold },
});
