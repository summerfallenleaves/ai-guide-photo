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
import { palette, radius, spacing, type, weight } from '@/lib/theme';

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
    backgroundColor: palette.bgElevated,
  },
  rootRow: {
    flexDirection: 'row',
  },
  photoWrap: {
    flex: 1,
    minHeight: 0,
    backgroundColor: palette.bg,
  },
  photoPane: {
    flex: 1,
    minWidth: 0,
    backgroundColor: palette.bg,
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
    fontSize: type.callout.fontSize,
    fontWeight: weight.semibold,
  },
  fallbackUri: {
    color: palette.fillStrong,
    fontSize: type.overline.fontSize,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xxxl,
    textAlign: 'center',
  },
  metaLine: {
    color: palette.textFaint,
    fontSize: type.caption.fontSize,
    fontWeight: weight.semibold,
    fontVariant: ['tabular-nums'],
  },
  saveErrorText: {
    color: palette.danger,
    fontSize: type.subhead.fontSize,
    fontWeight: weight.semibold,
  },
  photoFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
    backgroundColor: palette.scrimStrong,
  },
  sheet: {
    backgroundColor: palette.bgElevated,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    marginTop: -radius.lg,
    // 关键:信息区最多占 58%,超出就内部滚动,永远不会把照片挤没
    maxHeight: '58%',
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: spacing.xl,
    gap: spacing.xxl,
  },
  panel: {
    backgroundColor: palette.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: palette.border,
  },
  panelContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: 20,
    gap: spacing.xxl,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxl,
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
    fontSize: type.display.fontSize,
    fontWeight: weight.heavy,
    lineHeight: 30,
  },
  scoreUnit: {
    color: palette.textFaint,
    fontSize: type.overline.fontSize,
    marginTop: -2,
  },
  scoreMeta: {
    flex: 1,
    gap: spacing.md,
  },
  headline: {
    color: palette.text,
    fontSize: type.title.fontSize,
    fontWeight: weight.bold,
    lineHeight: 25,
  },
  metaPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: palette.hairline,
  },
  pillText: {
    color: palette.textDim,
    fontSize: type.caption.fontSize,
    fontWeight: weight.semibold,
  },
  saveLink: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xxs,
  },
  saveLinkText: {
    color: palette.warn,
    fontSize: type.subhead.fontSize,
    fontWeight: weight.semibold,
  },
  improvements: {
    gap: spacing.lg,
  },
  sectionTitle: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    fontWeight: weight.bold,
    letterSpacing: 0.6,
  },
  improvementRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'flex-start',
    backgroundColor: palette.fillSubtle,
    borderRadius: radius.md,
    padding: spacing.xl,
  },
  indexBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    color: palette.accent,
    fontSize: type.caption.fontSize,
    fontWeight: weight.heavy,
  },
  improvementText: {
    flex: 1,
    color: palette.textSoft,
    fontSize: type.body.fontSize,
    lineHeight: 21,
  },
  emptyHint: {
    color: palette.textDim,
    fontSize: type.callout.fontSize,
    lineHeight: 20,
  },
  goodBox: {
    gap: spacing.xs,
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.goodSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.goodBorder,
  },
  goodTitle: { color: palette.good, fontSize: type.body.fontSize, fontWeight: weight.bold },
  goodBody: { color: palette.textDim, fontSize: type.subhead.fontSize, lineHeight: 19 },
  paramCard: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
  },
  paramValues: {
    color: palette.text,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  applyBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  applyBtnText: { color: palette.onAccent, fontSize: type.callout.fontSize, fontWeight: weight.bold },
  actions: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.hairline,
    alignItems: 'center',
  },
  secondaryText: {
    color: palette.text,
    fontSize: type.body.fontSize,
    fontWeight: weight.semibold,
  },
  primaryButton: {
    flex: 1,
    paddingVertical: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.accent,
    alignItems: 'center',
  },
  primaryText: {
    color: palette.onAccent,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
  },
});
