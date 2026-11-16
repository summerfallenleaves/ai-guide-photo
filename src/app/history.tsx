import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setLastCapture, setReviewState } from '@/lib/capture-store';
import {
  clearHistory,
  loadHistory,
  removeHistoryEntry,
  RETENTION_DAYS,
  useHistory,
  type HistoryEntry,
} from '@/lib/history';
import { palette, radius } from '@/lib/theme';

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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { color: palette.accent, fontSize: 15, fontWeight: '600', width: 48 },
  headerCenter: { alignItems: 'center', flex: 1, gap: 2 },
  title: { color: palette.text, fontSize: 16, fontWeight: '700' },
  subtitle: { color: palette.textFaint, fontSize: 11 },
  clear: { color: palette.danger, fontSize: 13, fontWeight: '600', width: 48, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 },
  emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  emptyBody: { color: palette.textDim, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 16,
    paddingBottom: 6,
  },
  sectionTitle: { color: palette.text, fontSize: 13, fontWeight: '700' },
  sectionCount: { color: palette.textFaint, fontSize: 11 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 72 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  thumb: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.06)' },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  score: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  headline: { color: palette.text, fontSize: 13.5, fontWeight: '600', flex: 1 },
  meta: { color: palette.textFaint, fontSize: 11.5 },
  deleteHit: { paddingHorizontal: 6, paddingVertical: 4 },
  delete: { color: palette.textFaint, fontSize: 18, fontWeight: '600' },
});
