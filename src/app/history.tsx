import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setLastCapture, setReviewState } from '@/lib/capture-store';
import { clearHistory, loadHistory, removeHistoryEntry, useHistory, type HistoryEntry } from '@/lib/history';
import { palette, radius } from '@/lib/theme';

/** 拍照历史:回看之前拍过的照片和当时的点评 */
export default function HistoryScreen() {
  const entries = useHistory();

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
        <Text style={styles.title}>拍照历史</Text>
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
          <Text style={styles.emptyBody}>拍下的每张照片和当时的点评,会自动留在这里(最多 20 条)。</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => <Row entry={item} onPress={() => openEntry(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

function Row({ entry, onPress }: { entry: HistoryEntry; onPress: () => void }) {
  const date = new Date(entry.createdAt);
  const stamp = `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const score = entry.status === 'done' ? entry.result?.score : undefined;
  const scoreColor =
    score === undefined ? palette.textFaint : score >= 80 ? palette.good : score >= 60 ? palette.warn : palette.danger;

  const headline =
    entry.status === 'done'
      ? entry.result?.headline ?? '点评完成'
      : entry.status === 'failed'
        ? '点评失败'
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
          {stamp}
          {entry.savedToAlbum ? ' · 已存相册' : ' · 未存相册'}
        </Text>
      </View>
      <Pressable
        onPress={() => removeHistoryEntry(entry.id)}
        hitSlop={10}
        style={styles.deleteHit}>
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
  title: { color: palette.text, fontSize: 16, fontWeight: '700' },
  clear: { color: palette.danger, fontSize: 13, fontWeight: '600', width: 48, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 },
  emptyTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  emptyBody: { color: palette.textDim, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  thumb: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.06)' },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  score: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  headline: { color: palette.text, fontSize: 13.5, fontWeight: '600', flex: 1 },
  meta: { color: palette.textFaint, fontSize: 11.5 },
  deleteHit: { paddingHorizontal: 6, paddingVertical: 4 },
  delete: { color: palette.textFaint, fontSize: 18, fontWeight: '600' },
});
