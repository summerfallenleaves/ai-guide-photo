import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radius } from '@/lib/theme';
import type { LiveSuggestion } from '@/lib/types';

type Props = {
  suggestion: LiveSuggestion | null;
  analyzing: boolean;
  error: string | null;
  autoOn: boolean;
  onToggleAuto: () => void;
  onRefresh: () => void;
  /** 横屏空间紧张时用:去掉理由行、压缩字号与留白 */
  compact?: boolean;
};

export function SuggestionCard({
  suggestion,
  analyzing,
  error,
  autoOn,
  onToggleAuto,
  onRefresh,
  compact = false,
}: Props) {
  if (error) {
    return (
      <View style={[styles.card, compact && styles.cardCompact, styles.errorCard]}>
        <Text style={styles.errorTitle}>暂时给不出建议</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable onPress={onRefresh} style={styles.retry}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={[styles.card, compact && styles.cardCompact]}>
        <Text style={styles.placeholderTitle}>{analyzing ? '正在看画面…' : '把镜头对准想拍的东西'}</Text>
        <Text style={styles.placeholderBody}>
          {compact ? '每 3 秒看一次画面。' : '我会每 3 秒看一眼取景画面,给你一条最值得改的建议。'}
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
        <Pressable onPress={onToggleAuto} style={styles.footerBtn} hitSlop={8}>
          <Text style={[styles.footerBtnText, autoOn && { color: palette.accent }]}>
            {autoOn ? '自动分析 开' : '自动分析 关'}
          </Text>
        </Pressable>
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  errorCard: {
    borderColor: 'rgba(248,113,113,0.45)',
  },
  cardCompact: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  headlineCompact: {
    fontSize: 16,
  },
  actionCompact: {
    fontSize: 13.5,
    lineHeight: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dimTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(91,200,255,0.16)',
  },
  dimText: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveTag: {
    color: palette.textFaint,
    fontSize: 11,
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.text,
  },
  source: {
    color: palette.textFaint,
    fontSize: 10,
    fontWeight: '700',
  },
  headline: {
    color: palette.text,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  action: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
  },
  reason: {
    color: palette.textDim,
    fontSize: 12.5,
    lineHeight: 19,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  footerBtn: {
    paddingVertical: 2,
  },
  footerBtnText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
  placeholderTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  placeholderBody: {
    color: palette.textDim,
    fontSize: 12.5,
    lineHeight: 19,
  },
  errorTitle: {
    color: palette.danger,
    fontSize: 15,
    fontWeight: '700',
  },
  errorBody: {
    color: palette.textDim,
    fontSize: 12.5,
    lineHeight: 19,
  },
  retry: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(248,113,113,0.16)',
  },
  retryText: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
