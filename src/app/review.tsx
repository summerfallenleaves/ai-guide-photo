import { router, useLocalSearchParams } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLastCapture, getReviewState, setPendingAdjust, subscribeReviewState } from '@/lib/capture-store';
import { formatMeta } from '@/lib/exif';
import { formatShutterNs, parseShutterToNs } from '@/lib/native-camera2';
import { saveToAlbum } from '@/lib/media';
import { palette, radius } from '@/lib/theme';

export default function ReviewScreen() {
  const params = useLocalSearchParams<{ uri?: string; saved?: string }>();
  const captured = getLastCapture();

  // 优先用内存里那份,路由参数只作兜底
  const photoUri = captured?.uri ?? (params.uri ? String(params.uri) : '');
  const savedParam = params.saved ? String(params.saved) : '0';

  // 点评是异步补上的,订阅它
  const reviewState = useSyncExternalStore(subscribeReviewState, getReviewState);
  const review = reviewState.status === 'done' ? reviewState.result : null;
  const analyzing = reviewState.status === 'analyzing';
  const reviewError = reviewState.status === 'failed' ? reviewState.error : null;

  const [savedState, setSavedState] = useState(captured ? captured.saved : savedParam === '1');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState(false);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const panelWidth = Math.min(Math.max(width * 0.36, 260), 340);

  const handleSave = async () => {
    if (!photoUri || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveToAlbum(photoUri);
    if (result.ok) setSavedState(true);
    else setSaveError(result.error ?? '未知错误');
    setSaving(false);
  };

  const score = review?.score ?? null;
  const scoreColor =
    score === null ? palette.textDim : score >= 80 ? palette.good : score >= 60 ? palette.warn : palette.danger;

  const photo = photoUri && !imgError ? (
    <Image
      source={{ uri: photoUri }}
      style={styles.photo}
      resizeMode="contain"
      onError={() => setImgError(true)}
    />
  ) : (
    <View style={[styles.photo, styles.photoFallback]}>
      <Text style={styles.fallbackText}>{photoUri ? '照片加载失败' : '没拿到照片地址'}</Text>
      <Text style={styles.fallbackUri} numberOfLines={3}>
        {photoUri || '(uri 为空)'}
      </Text>
    </View>
  );

  const info = (
    <>
      <View style={styles.scoreRow}>
        <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
          {analyzing ? (
            <ActivityIndicator color={palette.accent} />
          ) : (
            <>
              <Text style={[styles.scoreNumber, { color: scoreColor }]}>{score ?? '—'}</Text>
              <Text style={styles.scoreUnit}>分</Text>
            </>
          )}
        </View>
        <View style={styles.scoreMeta}>
          <Text style={styles.headline}>
            {analyzing
              ? 'AI 正在点评…'
              : (review?.headline ?? (reviewError ? '这次没拿到点评' : '这张照片已保存'))}
          </Text>
          <View style={styles.metaPills}>
            {review?.dimLabel ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{review.dimLabel}</Text>
              </View>
            ) : null}
            {review ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{review.source === 'deepseek' ? 'AI 点评' : '本地点评'}</Text>
              </View>
            ) : null}
            {savedState ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>已存相册</Text>
              </View>
            ) : null}
          </View>

          {formatMeta(captured?.meta) ? (
            <Text style={styles.metaLine}>{formatMeta(captured?.meta)}</Text>
          ) : null}

          {saveError ? <Text style={styles.saveErrorText}>保存失败:{saveError}</Text> : null}

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

      {analyzing ? (
        <View style={styles.improvements}>
          <Text style={styles.sectionTitle}>正在分析</Text>
          <Text style={styles.emptyHint}>看构图、光线、主体和背景,大概要一两秒。照片已经存好了,你可以先看。</Text>
        </View>
      ) : review ? (
        review.improvements.length > 0 ? (
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
          <View style={styles.goodBox}>
            <Text style={styles.goodTitle}>这张没什么要改的</Text>
            <Text style={styles.goodBody}>构图、光线都没问题,可以直接用。</Text>
          </View>
        )
      ) : (
        <Text style={styles.emptyHint}>
          {reviewError
            ? `点评失败:${reviewError}`
            : '这次没拿到点评,可能是网络或模型的问题。照片已经拍下来了。'}
        </Text>
      )}

      {review?.params ? (
        <View style={styles.paramCard}>
          <Text style={styles.sectionTitle}>建议参数</Text>
          <Text style={styles.paramValues}>{describeParams(review.params)}</Text>
          <Pressable
            style={styles.applyBtn}
            onPress={() => {
              if (!review?.params) return;
              setPendingAdjust(review.params);
              router.back();
            }}>
            <Text style={styles.applyBtnText}>应用参数并重拍</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable style={styles.secondaryButton} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>再拍一张</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryText}>完成</Text>
        </Pressable>
      </View>
    </>
  );

  // 横屏:左照片 + 右信息栏。照片用 contain 完整显示,两侧留白,信息栏不压画面。
  if (isLandscape) {
    return (
      <View style={[styles.root, styles.rootRow]}>
        <View style={styles.photoPane}>{photo}</View>
        <SafeAreaView
          style={[styles.panel, { width: panelWidth }]}
          edges={['top', 'bottom', 'right']}>
          <ScrollView contentContainerStyle={styles.panelContent} showsVerticalScrollIndicator={false}>
            {info}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.photoWrap}>
        {photo}
        <View style={styles.photoFade} pointerEvents="none" />
      </View>

      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {info}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function describeParams(p: { iso?: number; shutter?: string; wb?: number; focusMeters?: number }): string {
  const parts: string[] = [];
  if (p.iso) parts.push(`ISO ${p.iso}`);
  const ns = p.shutter ? parseShutterToNs(p.shutter) : undefined;
  if (ns) parts.push(formatShutterNs(ns));
  else if (p.shutter) parts.push(p.shutter);
  if (p.wb) parts.push(`${p.wb}K`);
  if (p.focusMeters) parts.push(`对焦 ${p.focusMeters}m`);
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0C',
  },
  rootRow: {
    flexDirection: 'row',
  },
  photoWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#000',
  },
  photoPane: {
    flex: 1,
    minWidth: 0,
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
    fontWeight: '600',
  },
  fallbackUri: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 10,
    marginTop: 6,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  metaLine: {
    color: palette.textFaint,
    fontSize: 11.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  saveErrorText: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: '600',
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
    // 关键:信息区最多占 58%,超出就内部滚动,永远不会把照片挤没
    maxHeight: '58%',
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    gap: 18,
  },
  panel: {
    backgroundColor: '#111114',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
  panelContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 20,
    gap: 16,
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
  goodBox: {
    gap: 4,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(74,222,128,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(74,222,128,0.35)',
  },
  goodTitle: { color: palette.good, fontSize: 15, fontWeight: '700' },
  goodBody: { color: palette.textDim, fontSize: 12.5, lineHeight: 19 },
  paramCard: {
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: 'rgba(91,200,255,0.10)',
  },
  paramValues: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  applyBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  applyBtnText: { color: '#00131F', fontSize: 13.5, fontWeight: '700' },
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
