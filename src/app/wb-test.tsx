import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addParamsListener,
  Camera2Preview,
  getCapabilities,
  isNativeCameraAvailable,
  type Camera2CapsFull,
  type Camera2Params,
} from '@/lib/native-camera2';
import { palette, radius } from '@/lib/theme';
import { cctFromAwbGains, gainsFromKelvin } from '@/lib/white-balance';

type Sample = {
  cct: number;
  awbR: number;
  awbB: number;
  formulaR: number;
  formulaB: number;
};

/**
 * 白平衡标定页。
 *
 * 思路:不自带标准图,而是**拿相机自己的自动白平衡当参考**
 * ——AWB 算出的增益是"相机认为的正确值",我们反推它对应的场景色温,
 * 再看我们的色温→增益公式在同一色温下给出的值差多少。
 */
export default function WhiteBalanceTestScreen() {
  const available = isNativeCameraAvailable();
  const [focused, setFocused] = useState(true);
  const [params, setParams] = useState<Camera2Params | null>(null);
  const [caps, setCaps] = useState<Camera2CapsFull | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    if (!available) return;
    const off = addParamsListener(setParams);
    const timer = setTimeout(() => {
      void getCapabilities().then(setCaps);
    }, 1200);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [available]);

  const matrix = caps?.colorTransform;
  const awbR = params?.awbR ?? 0;
  const awbG = params?.awbG ?? 0;
  const awbB = params?.awbB ?? 0;
  const cct = cctFromAwbGains(matrix, awbR, awbG, awbB);
  const formula = cct ? gainsFromKelvin(matrix, cct) : null;

  const errR = formula && awbR > 0 ? (formula.r - awbR) / awbR : null;
  const errB = formula && awbB > 0 ? (formula.b - awbB) / awbB : null;

  const takeSample = () => {
    if (!cct || !formula) return;
    setSamples((prev) => [
      ...prev.slice(-7),
      { cct: Math.round(cct), awbR, awbB, formulaR: formula.r, formulaB: formula.b },
    ]);
  };

  return (
    <View style={styles.root}>
      {available && focused ? (
        <Camera2Preview style={StyleSheet.absoluteFill} facing="back" />
      ) : null}

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.back}>‹ 返回</Text>
          </Pressable>
          <Text style={styles.title}>白平衡标定</Text>
          <Pressable onPress={takeSample} hitSlop={12}>
            <Text style={styles.back}>采样</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.bottom} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>相机 AWB 的答案</Text>
            <Row label="AWB 增益" value={`R ${awbR.toFixed(3)}  G ${awbG.toFixed(3)}  B ${awbB.toFixed(3)}`} />
            <Row label="反推场景色温" value={cct ? `${Math.round(cct)}K` : '—'} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>我们的公式(同一色温下)</Text>
            <Row label="公式增益" value={formula ? `R ${formula.r.toFixed(3)}  B ${formula.b.toFixed(3)}` : '—'} />
            <Row
              label="偏差 R / B"
              value={
                errR !== null && errB !== null
                  ? `${(errR * 100).toFixed(1)}%  /  ${(errB * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <Text style={styles.hint}>
              偏差接近 0 说明公式和相机一致;R 偏大表示我们把暖色补过头了,B 偏大表示把冷色补过头了。
            </Text>
          </View>

          {samples.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>采样({samples.length})</Text>
              {samples.map((s, i) => (
                <Text key={i} style={styles.sample}>
                  {s.cct}K · AWB R{s.awbR.toFixed(2)} B{s.awbB.toFixed(2)} · 公式 R{s.formulaR.toFixed(2)} B
                  {s.formulaB.toFixed(2)}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>对着不同光线各点一次右上角「采样」,再把这些数字发我。</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  back: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  bottom: { gap: 10, paddingBottom: 10 },
  card: {
    backgroundColor: 'rgba(20,20,24,0.9)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    padding: 12,
    gap: 6,
  },
  cardTitle: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  rowLabel: { color: palette.textFaint, fontSize: 12 },
  rowValue: { color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  hint: { color: palette.textDim, fontSize: 11.5, lineHeight: 17 },
  sample: { color: '#fff', fontSize: 11.5, fontVariant: ['tabular-nums'] },
});
