import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing, type, weight } from '@/theme';
import type { LiveSuggestion } from '@/domain/shared/types';

type Props = {
  suggestion: LiveSuggestion | null;
  analyzing: boolean;
  error: string | null;
  /** 取景会话是否正在进行(由「开始 AI 取景」按钮控制) */
  sessionActive: boolean;
  /** 开始会话 */
  onStart: () => void;
  /** 结束会话 */
  onStop: () => void;
  /** 连续失败后暂停了自动分析 */
  paused: boolean;
  /** 最近一次自动调参的说明,例如「已自动调 ISO 400 · 1/125s」 */
  appliedNote?: string | null;
  onRefresh: () => void;
  onOpenSettings: () => void;
  /** 横屏空间紧张时用:去掉理由行、压缩字号与留白 */
  compact?: boolean;
};

export function SuggestionCard({
  suggestion,
  analyzing,
  error,
  sessionActive,
  onStart,
  onStop,
  paused,
  appliedNote = null,
  onRefresh,
  onOpenSettings,
  compact = false,
}: Props) {
  if (error) {
    return (
      <View style={[styles.card, compact && styles.cardCompact, styles.errorCard]}>
        <Text style={styles.errorTitle}>暂时给不出建议</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <View style={styles.errorActions}>
          <Pressable onPress={onRefresh} style={styles.retry}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
          <Pressable onPress={onOpenSettings} hitSlop={8} style={styles.errorSettingHit}>
            <Text style={styles.errorSettingText}>设置</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // 关闭自动分析后这张卡没有存在意义(它只服务于定时抓帧),直接不渲染
  if (!sessionActive) {
    // 会话没开时,这个位置就是入口 —— 空态即按钮
    return (
      <View style={[styles.card, compact && styles.cardCompact]}>
        <Pressable onPress={onStart} style={styles.startButton} hitSlop={6}>
          <Text style={styles.startText}>开始 AI 取景</Text>
        </Pressable>
        <Text style={styles.placeholderBody}>
          {compact
            ? '连续给建议,画面可以拍时自动按快门。'
            : '每几秒看一眼画面,连续给建议;画面可以拍的时候会自动按下快门。'}
        </Text>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={[styles.card, compact && styles.cardCompact]}>
        <Text style={styles.placeholderTitle}>
          {paused ? '已经暂停' : analyzing ? '正在看画面…' : '把镜头对准想拍的东西'}
        </Text>
        <Text style={styles.placeholderBody}>
          {paused
            ? '连续几次没拿到建议,已经暂停。点右上角 ↻ 重试。'
            : compact
              ? '每几秒看一次画面。'
              : '我会定时看一眼取景画面,给你一条最值得改的建议。'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.headerRow}>
        <View style={styles.dimTag}>
          <Text style={styles.dimText}>{suggestion.dimLabel}</Text>
        </View>
        <View style={styles.headerRight}>
          {analyzing ? <Text style={styles.liveTag}>更新中…</Text> : null}
          <ConfidenceDots value={suggestion.confidence} />
          <Text style={styles.source}>{suggestion.source === 'deepseek' ? 'AI' : '本地'}</Text>
          <Pressable onPress={onRefresh} hitSlop={10} style={styles.refreshHit}>
            <Text style={styles.refreshGlyph}>↻</Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.headline, compact && styles.headlineCompact]}>{suggestion.headline}</Text>
      <Text style={[styles.action, compact && styles.actionCompact]}>{suggestion.action}</Text>
      {!compact && suggestion.reason ? <Text style={styles.reason}>{suggestion.reason}</Text> : null}
      {appliedNote ? <Text style={styles.appliedNote}>{appliedNote}</Text> : null}

      <Pressable onPress={onStop} style={styles.stopButton} hitSlop={6}>
        <Text style={styles.stopText}>结束取景</Text>
      </Pressable>
    </View>
  );
}

function ConfidenceDots({ value }: { value: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, value)) * 3);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, { opacity: i < filled ? 1 : 0.22 }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  appliedNote: {
    color: palette.accent,
    fontSize: type.caption.fontSize,
    fontWeight: weight.medium,
    marginTop: spacing.xxs,
  },
  startButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  startText: { color: palette.onAccent, fontSize: type.body.fontSize, fontWeight: weight.bold },
  stopButton: { alignSelf: 'flex-end', marginTop: spacing.sm, paddingVertical: spacing.xs },
  stopText: { color: palette.textFaint, fontSize: type.caption.fontSize, fontWeight: weight.medium },
  card: {
    backgroundColor: palette.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl + spacing.xxs,
    gap: spacing.sm,
  },
  errorCard: {
    borderColor: palette.dangerSoft,
  },
  cardCompact: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  headlineCompact: {
    fontSize: type.headline.fontSize,
  },
  actionCompact: {
    fontSize: type.callout.fontSize,
    lineHeight: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xxs,
  },
  dimTag: {
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.accentSoft,
  },
  dimText: {
    color: palette.accent,
    fontSize: type.caption.fontSize,
    fontWeight: weight.bold,
    letterSpacing: 0.4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  liveTag: {
    color: palette.textFaint,
    fontSize: type.caption.fontSize,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: spacing.xxs,
    backgroundColor: palette.text,
  },
  source: {
    color: palette.textFaint,
    fontSize: type.overline.fontSize,
    fontWeight: weight.bold,
  },
  headline: {
    color: palette.text,
    fontSize: type.title.fontSize,
    fontWeight: weight.bold,
    letterSpacing: 0.2,
  },
  action: {
    color: palette.text,
    fontSize: type.body.fontSize,
    lineHeight: 23,
    fontWeight: weight.medium,
  },
  reason: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    lineHeight: 19,
  },
  errorSettingHit: { paddingVertical: spacing.xxs },
  errorSettingText: { ...type.caption, color: palette.textDim },
  refreshHit: {
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  refreshGlyph: {
    ...type.callout,
    color: palette.accent,
  },
  footerBtnText: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    fontWeight: weight.semibold,
  },
  placeholderTitle: {
    color: palette.text,
    fontSize: type.body.fontSize,
    fontWeight: weight.semibold,
  },
  placeholderBody: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    lineHeight: 19,
  },
  errorTitle: {
    color: palette.danger,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
  },
  errorBody: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    lineHeight: 19,
  },
  errorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl + spacing.xxs,
    marginTop: spacing.xs,
  },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xl + spacing.xxs,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.dangerSoft,
  },
  retryText: {
    color: palette.danger,
    fontSize: type.callout.fontSize,
    fontWeight: weight.bold,
  },
});
