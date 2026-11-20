import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setLastCapture, setReviewState } from '@/data/capture-store';
import {
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  RETENTION_DAYS,
  useHistory,
  type HistoryEntry,
} from '@/data/history';
import { computeHistoryStats } from '@/domain/guidance/history-stats';
import { palette, radius, spacing, tabularNums, type, weight } from '@/theme';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 同一天归为一组:用当天零点作为 key,避开时区/夏令时误差 */
function dayKey(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(key: number): string {
  const today = dayKey(Date.now());
  if (key === today) return '今天';
  if (key === today - DAY_MS) return '昨天';
  const d = new Date(key);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${week}`;
}

type Section = { title: string; data: HistoryEntry[] };

function buildSections(entries: HistoryEntry[]): Section[] {
  const map = new Map<number, HistoryEntry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.createdAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, data]) => ({ title: dayLabel(key), data }));
}

/** 拍照历史:按天分组,只保留最近 7 天 */
export default function HistoryScreen() {
  const entries = useHistory();
  const sections = useMemo(() => buildSections(entries), [entries]);
  const stats = useMemo(() => computeHistoryStats(entries), [entries]);

  useEffect(() => {
    void loadHistory();
  }, []);

  const openEntry = (entry: HistoryEntry) => {
    setLastCapture({ uri: entry.uri, saved: entry.savedToAlbum, meta: entry.meta });
    if (entry.status === 'done' && entry.result) {
      setReviewState({ status: 'done', result: entry.result });
    } else if (entry.status === 'failed') {
      setReviewState({ status: 'failed', error: entry.error ?? '当时点评失败了' });
    } else {
      setReviewState({ status: 'failed', error: '这条记录还没点评完' });
    }
    router.push({ pathname: '/review', params: { uri: entry.uri } });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ 返回</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>拍照历史</Text>
          <Text style={styles.subtitle}>
            {entries.length > 0 ? `${entries.length} 张 · 保留最近 ${RETENTION_DAYS} 天` : `保留最近 ${RETENTION_DAYS} 天`}
          </Text>
        </View>
        {entries.length > 0 ? (
          <Pressable onPress={clearHistory} hitSlop={12}>
            <Text style={styles.clear}>清空</Text>
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>还没有记录</Text>
          <Text style={styles.emptyBody}>
            拍下的照片和当时的点评会自动留在这里,按天分组,只保留最近 {RETENTION_DAYS} 天。
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<StatsCard stats={stats} />}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length} 张</Text>
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => <Row entry={item} onPress={() => openEntry(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ entry, onPress }: { entry: HistoryEntry; onPress: () => void }) {
  const date = new Date(entry.createdAt);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const score = entry.status === 'done' ? entry.result?.score : undefined;
  const scoreColor =
    score === undefined
      ? palette.textFaint
      : score >= 80
        ? palette.good
        : score >= 60
          ? palette.warn
          : palette.danger;

  const headline =
    entry.status === 'done'
      ? entry.result?.headline ?? '点评完成'
      : entry.status === 'failed'
        ? entry.error ?? '点评失败'
        : '点评中…';

  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Image source={{ uri: entry.uri }} style={styles.thumb} resizeMode="cover" />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.score, { color: scoreColor }]}>{score ?? '—'}</Text>
          <Text style={styles.headline} numberOfLines={1}>
            {headline}
          </Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {clock}
          {entry.savedToAlbum ? ' · 已存相册' : ' · 未存相册'}
        </Text>
      </View>
      <Pressable onPress={() => removeHistoryEntry(entry.id)} hitSlop={10} style={styles.deleteHit}>
        <Text style={styles.delete}>×</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  back: { color: palette.accent, fontSize: type.body.fontSize, fontWeight: weight.semibold, width: 48 },
  headerCenter: { alignItems: 'center', flex: 1, gap: spacing.xxs },
  title: { color: palette.text, fontSize: type.headline.fontSize, fontWeight: weight.bold },
  subtitle: { color: palette.textFaint, fontSize: type.caption.fontSize },
  clear: { color: palette.danger, fontSize: type.callout.fontSize, fontWeight: weight.semibold, width: 48, textAlign: 'right' },
  statsCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: palette.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    gap: spacing.md,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statCell: { alignItems: 'center', gap: 2 },
  statValue: { ...type.metric, color: palette.text, ...tabularNums },
  statLabel: { ...type.caption, color: palette.textFaint },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    height: 46,
    marginTop: spacing.sm,
  },
  barCol: { flex: 1, alignItems: 'stretch', justifyContent: 'flex-end' },
  bar: { borderRadius: radius.sm / 2, minHeight: 3 },
  barsCaption: { ...type.overline, color: palette.textFaint },
  statsLine: { ...type.callout, color: palette.textSoft },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: spacing.md },
  emptyTitle: { color: palette.text, fontSize: type.body.fontSize, fontWeight: weight.bold },
  emptyBody: { color: palette.textDim, fontSize: type.subhead.fontSize, lineHeight: 19, textAlign: 'center' },
  list: { paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxxl },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  sectionTitle: { color: palette.text, fontSize: type.callout.fontSize, fontWeight: weight.bold },
  sectionCount: { color: palette.textFaint, fontSize: type.caption.fontSize },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.hairline, marginLeft: 72 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl, paddingVertical: spacing.lg },
  thumb: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: palette.fillSubtle },
  rowBody: { flex: 1, gap: spacing.xxs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  score: { fontSize: type.headline.fontSize, fontWeight: weight.heavy, fontVariant: ['tabular-nums'] },
  headline: { color: palette.text, fontSize: type.callout.fontSize, fontWeight: weight.semibold, flex: 1 },
  meta: { color: palette.textFaint, fontSize: type.caption.fontSize },
  deleteHit: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  delete: { color: palette.textFaint, fontSize: type.title.fontSize, fontWeight: weight.semibold },
});

/**
 * 这几天的趋势。
 *
 * 全部本地计算,不调用 AI —— 数据本来就在手里,
 * 把"单张点评"变成"最近在往哪个方向进步"。
 */
function StatsCard({ stats }: { stats: ReturnType<typeof computeHistoryStats> }) {
  if (stats.analyzed === 0) return null;
  const maxAvg = Math.max(100, ...stats.daily.map((d) => d.average ?? 0));
  const verdictLine = [
    stats.verdicts.keep > 0 ? `可以直接用 ${stats.verdicts.keep}` : null,
    stats.verdicts.tweak > 0 ? `微调 ${stats.verdicts.tweak}` : null,
    stats.verdicts.reshoot > 0 ? `建议重拍 ${stats.verdicts.reshoot}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.statsCard}>
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{Math.round(stats.average ?? 0)}</Text>
          <Text style={styles.statLabel}>平均分</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{stats.analyzed}</Text>
          <Text style={styles.statLabel}>已点评</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statValue}>{stats.best ?? '—'}</Text>
          <Text style={styles.statLabel}>最高分</Text>
        </View>
      </View>

      {/* 最近 7 天的平均分柱状条 */}
      <View style={styles.bars}>
        {stats.daily.map((day) => {
          const height = day.average === null ? 3 : Math.max(3, (day.average / maxAvg) * 44);
          return (
            <View key={day.dayKey} style={styles.barCol}>
              <View
                style={[
                  styles.bar,
                  {
                    height,
                    opacity: day.average === null ? 0.18 : 0.85,
                    backgroundColor:
                      day.average === null
                        ? palette.fill
                        : day.average >= 80
                          ? palette.good
                          : day.average >= 60
                            ? palette.warn
                            : palette.danger,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <Text style={styles.barsCaption}>最近 7 天平均分</Text>

      {verdictLine ? <Text style={styles.statsLine}>{verdictLine}</Text> : null}
      {stats.topDim ? (
        <Text style={styles.statsLine}>
          最常需要改:{stats.topDim.label} · {stats.topDim.count} 次
        </Text>
      ) : null}
    </View>
  );
}
