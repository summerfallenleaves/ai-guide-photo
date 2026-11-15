import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  INTERVAL_MAX,
  INTERVAL_MIN,
  liveAnalysisEnabled,
  updateSettings,
  useSettings,
} from '@/lib/settings';
import { palette, radius } from '@/lib/theme';

export default function SettingsScreen() {
  const settings = useSettings();
  const liveOn = liveAnalysisEnabled(settings);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.title}>设置</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>当前生效</Text>
          <Text style={styles.summaryLine}>
            {liveOn ? `自动分析:每 ${settings.intervalSec} 秒` : '自动分析:关闭'}
          </Text>
        </View>

        <SwitchRow
          title="快速模式"
          description="开启时不使用思考(1.6~1.8 秒出结果);关闭时用高强度思考,点评更细致,但要等 3~6 秒。"
          value={settings.fastMode}
          onValueChange={(v) => updateSettings({ fastMode: v })}
        />

        <SwitchRow
          title="自动分析"
          description="取景时定时抓帧给建议,不用按快门也能看到提示。"
          note={settings.fastMode ? null : '需要先打开快速模式'}
          disabled={!settings.fastMode}
          value={settings.autoAnalyze}
          onValueChange={(v) => updateSettings({ autoAnalyze: v })}
        />

        <View style={[styles.card, !liveOn && styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>自动分析间隔</Text>
            <Text style={styles.cardValue}>{settings.intervalSec} 秒</Text>
          </View>
          <Text style={styles.cardDesc}>间隔太短会明显耗电发热,建议 3~5 秒。</Text>

          <View style={styles.stepperRow}>
            <StepperButton
              label="−"
              disabled={!liveOn || settings.intervalSec <= INTERVAL_MIN}
              onPress={() => updateSettings({ intervalSec: settings.intervalSec - 1 })}
            />
            <View style={styles.track}>
              {Array.from({ length: INTERVAL_MAX - INTERVAL_MIN + 1 }, (_, i) => {
                const value = INTERVAL_MIN + i;
                const active = value <= settings.intervalSec;
                return (
                  <Pressable
                    key={value}
                    disabled={!liveOn}
                    onPress={() => updateSettings({ intervalSec: value })}
                    style={[styles.tick, active && styles.tickActive, !liveOn && styles.tickDisabled]}
                  />
                );
              })}
            </View>
            <StepperButton
              label="+"
              disabled={!liveOn || settings.intervalSec >= INTERVAL_MAX}
              onPress={() => updateSettings({ intervalSec: settings.intervalSec + 1 })}
            />
          </View>

          {liveOn ? null : (
            <Text style={styles.note}>需要「快速模式」和「自动分析」都打开才生效</Text>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function SwitchRow({
  title,
  description,
  note,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  description: string;
  note?: string | null;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: 'rgba(255,255,255,0.16)', true: 'rgba(91,200,255,0.55)' }}
          thumbColor={value ? '#FFFFFF' : 'rgba(255,255,255,0.75)'}
        />
      </View>
      <Text style={styles.cardDesc}>{description}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function StepperButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.stepper, disabled && styles.stepperDisabled, pressed && { opacity: 0.6 }]}>
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 64,
  },
  backText: {
    color: palette.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  title: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cardValue: {
    color: palette.accent,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardDesc: {
    color: palette.textDim,
    fontSize: 12.5,
    lineHeight: 19,
  },
  note: {
    color: palette.warn,
    fontSize: 12,
    fontWeight: '600',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  stepper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stepperDisabled: {
    opacity: 0.35,
  },
  stepperText: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 24,
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  tick: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  tickActive: {
    backgroundColor: palette.accent,
  },
  tickDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  summary: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(91,200,255,0.08)',
    gap: 4,
  },
  summaryTitle: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  summaryLine: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    lineHeight: 20,
  },
});
