import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing, type, weight } from '@/lib/theme';
import type { LiveSuggestion } from '@/lib/types';

type Props = {
  suggestion: LiveSuggestion | null;
  analyzing: boolean;
  error: string | null;
  /** 取景自动分析是否生效(快速模式 + 自动分析都开启) */
  liveOn: boolean;
  /** 连续失败后暂停了自动分析 */
  paused: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  /** 横屏空间紧张时用:去掉理由行、压缩字号与留白 */
  compact?: boolean;
};

export function SuggestionCard({
  suggestion,
  analyzing,
  error,
  liveOn,
  paused,
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
          <Pressable onPress={onOpenSettings} style={styles.footerBtn} hitSlop={8}>
            <Text style={styles.footerBtnText}>设置</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={[styles.card, compact && styles.cardCompact]}>
        <Text style={styles.placeholderTitle}>
          {!liveOn ? '自动分析已关闭' : paused ? '自动分析暂停了' : analyzing ? '正在看画面…' : '把镜头对准想拍的东西'}
        </Text>
        <Text style={styles.placeholderBody}>
          {!liveOn
            ? '取景时不再给建议,按快门后照常点评。想恢复就在设置里打开「自动分析」。'
            : paused
              ? '连续几次没连上代理,已经暂停。点「换一条」重试。'
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
        </View>
      </View>

      <Text style={[styles.headline, compact && styles.headlineCompact]}>{suggestion.headline}</Text>
      <Text style={[styles.action, compact && styles.actionCompact]}>{suggestion.action}</Text>
      {!compact && suggestion.reason ? <Text style={styles.reason}>{suggestion.reason}</Text> : null}

      <View style={styles.footer}>
        <Pressable onPress={onRefresh} style={styles.footerBtn} hitSlop={8}>
          <Text style={styles.footerBtnText}>换一条 ↻</Text>
        </Pressable>
      </View>
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  footerBtn: {
    paddingVertical: spacing.xxs,
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
