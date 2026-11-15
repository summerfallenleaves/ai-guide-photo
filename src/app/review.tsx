import { Image } from 'expo-image';
import { Asset, usePermissions as useMediaPermissions } from 'expo-media-library';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, radius } from '@/lib/theme';
import type { CaptureResult } from '@/lib/types';

export default function ReviewScreen() {
  const { uri, saved, payload } = useLocalSearchParams<{ uri?: string; saved?: string; payload?: string }>();

  const [mediaPermission, requestMediaPermission] = useMediaPermissions({
    writeOnly: true,
    granularPermissions: ['photo'],
  });
  const [savedState, setSavedState] = useState(saved === '1');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!uri || saving) return;
    setSaving(true);
    try {
      try {
        await Asset.create(uri);
      } catch {
        const res = mediaPermission?.granted ? { granted: true } : await requestMediaPermission();
        if (!res.granted) throw new Error('需要相册写入权限,请在系统设置里打开');
        await Asset.create(uri);
      }
      setSavedState(true);
    } catch (err) {
      Alert.alert('保存失败', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const review = useMemo<CaptureResult | null>(() => {
    if (!payload) return null;
    try {
      return JSON.parse(payload) as CaptureResult;
    } catch {
      return null;
    }
  }, [payload]);

  const score = review?.score ?? null;
  const scoreColor = score === null ? palette.textDim : score >= 80 ? palette.good : score >= 60 ? palette.warn : palette.danger;

  return (
    <View style={styles.root}>
      <View style={styles.photoWrap}>
        {uri ? (
          <Image source={{ uri }} style={styles.photo} contentFit="cover" transition={180} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <Text style={styles.fallbackText}>照片加载失败</Text>
          </View>
        )}
        <View style={styles.photoFade} pointerEvents="none" />
      </View>

      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <View style={styles.scoreRow}>
            <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
              <Text style={[styles.scoreNumber, { color: scoreColor }]}>{score ?? '—'}</Text>
              <Text style={styles.scoreUnit}>分</Text>
            </View>
            <View style={styles.scoreMeta}>
              <Text style={styles.headline}>{review?.headline ?? '这张照片已保存'}</Text>
              <View style={styles.metaPills}>
                {review?.dimLabel ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{review.dimLabel}</Text>
                  </View>
                ) : null}
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{review?.source === 'deepseek' ? 'AI 点评' : '本地点评'}</Text>
                </View>
                {savedState ? (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>已存相册</Text>
                  </View>
                ) : null}
              </View>

              {savedState ? null : (
                <Pressable onPress={() => void handleSave()} style={styles.saveLink} hitSlop={8}>
                  {saving ? (
                    <ActivityIndicator size="small" color={palette.warn} />
                  ) : (
                    <Text style={styles.saveLinkText}>⚠ 还没存进相册,点这里保存</Text>
                  )}
                </Pressable>
              )}
            </View>
          </View>

          {review?.improvements?.length ? (
            <View style={styles.improvements}>
              <Text style={styles.sectionTitle}>下次这样拍</Text>
              {review.improvements.map((item, index) => (
                <View key={index} style={styles.improvementRow}>
                  <View style={styles.indexBadge}>
                    <Text style={styles.indexText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.improvementText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyHint}>这次没拿到点评,可能是网络或模型的问题。照片已经拍下来了。</Text>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
              <Text style={styles.secondaryText}>再拍一张</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={() => router.back()}>
              <Text style={styles.primaryText}>完成</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  photoWrap: {
    flex: 1,
    backgroundColor: '#000',
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  photoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: palette.textFaint,
    fontSize: 13,
  },
  photoFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
    backgroundColor: 'rgba(10,10,12,0.55)',
  },
  sheet: {
    backgroundColor: '#0A0A0C',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    marginTop: -radius.lg,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    gap: 18,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scoreRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNumber: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 30,
  },
  scoreUnit: {
    color: palette.textFaint,
    fontSize: 10,
    marginTop: -2,
  },
  scoreMeta: {
    flex: 1,
    gap: 8,
  },
  headline: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 25,
  },
  metaPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  pillText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  saveLink: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  saveLinkText: {
    color: palette.warn,
    fontSize: 12.5,
    fontWeight: '600',
  },
  improvements: {
    gap: 10,
  },
  sectionTitle: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  improvementRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderRadius: radius.md,
    padding: 12,
  },
  indexBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(91,200,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  improvementText: {
    flex: 1,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 14,
    lineHeight: 21,
  },
  emptyHint: {
    color: palette.textDim,
    fontSize: 13,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  secondaryText: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: palette.accent,
    alignItems: 'center',
  },
  primaryText: {
    color: '#00131F',
    fontSize: 15,
    fontWeight: '700',
  },
});
