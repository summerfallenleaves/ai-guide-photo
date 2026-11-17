import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEFAULT_ENDPOINT, verifyApiKey } from '@/lib/deepseek';
import { useApiKey } from '@/hooks/use-api-key';
import { getCachedApiKey, maskKey, saveApiKey } from '@/lib/secure-key';
import {
  INTERVAL_MAX,
  INTERVAL_MIN,
  liveAnalysisEnabled,
  updateSettings,
  useSettings,
} from '@/lib/settings';
import { palette, radius, spacing, type, weight } from '@/lib/theme';

export default function SettingsScreen() {
  const settings = useSettings();
  const liveOn = liveAnalysisEnabled(settings);

  const savedKey = useApiKey();
  const [keyInput, setKeyInput] = useState('');
  const [editing, setEditing] = useState(!getCachedApiKey());
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 接口地址只在本页编辑,初始化一次即可
  const [endpointInput, setEndpointInput] = useState(settings.apiEndpoint);

  const handleSaveKey = async () => {
    if (!keyInput.trim() || savingKey) return;
    setSavingKey(true);
    setTestResult(null);
    try {
      await saveApiKey(keyInput);
      setKeyInput('');
      setEditing(false);
    } catch (err) {
      setTestResult({ ok: false, message: `保存失败:${(err as Error).message}` });
    } finally {
      setSavingKey(false);
    }
  };

  const handleTest = async () => {
    const key = getCachedApiKey();
    if (!key || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      await verifyApiKey(key, settings.apiEndpoint);
      setTestResult({ ok: true, message: '连接正常,Key 可用' });
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

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
          <Text style={styles.versionText}>版本 {Constants.expoConfig?.version ?? '—'}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>DeepSeek API Key</Text>
            {savedKey && !editing ? (
              <Pressable onPress={() => setEditing(true)} hitSlop={8}>
                <Text style={styles.linkText}>更换</Text>
              </Pressable>
            ) : null}
          </View>

          {savedKey && !editing ? (
            <>
              <Text style={styles.keyValue}>{maskKey(savedKey)}</Text>
              <Text style={styles.cardDesc}>
                只加密保存在这台手机上(系统密钥库),不在安装包里,也不会上传到任何服务器。
              </Text>
              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryBtn} onPress={() => void handleTest()} disabled={testing}>
                  {testing ? (
                    <ActivityIndicator size="small" color={palette.accent} />
                  ) : (
                    <Text style={styles.secondaryBtnText}>测试连接</Text>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={keyInput}
                onChangeText={setKeyInput}
                placeholder="sk-..."
                placeholderTextColor="palette.fillStrong"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Text style={styles.cardDesc}>
                在 platform.deepseek.com 创建。保存后只显示首尾各 4 位。
              </Text>
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.primaryBtn, !keyInput.trim() && styles.btnDisabled]}
                  onPress={() => void handleSaveKey()}
                  disabled={!keyInput.trim() || savingKey}>
                  <Text style={styles.primaryBtnText}>{savingKey ? '保存中…' : '保存 Key'}</Text>
                </Pressable>
                {savedKey ? (
                  <Pressable style={styles.secondaryBtn} onPress={() => setEditing(false)}>
                    <Text style={styles.secondaryBtnText}>取消</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}

          {testResult ? (
            <Text style={[styles.testResult, { color: testResult.ok ? palette.good : palette.danger }]}>
              {testResult.ok ? '✓ ' : '✕ '}
              {testResult.message}
            </Text>
          ) : null}
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

        <SwitchRow
          title="参数建议"
          description="读取相机记录的光学参数(焦距、光圈、ISO、快门),让建议能涉及拍摄参数而不是只看画面。"
          value={settings.paramAdvice}
          onValueChange={(v) => updateSettings({ paramAdvice: v })}
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

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>接口地址</Text>
            <Text style={styles.cardValueSmall}>高级</Text>
          </View>
          <TextInput
            style={styles.input}
            value={endpointInput}
            onChangeText={setEndpointInput}
            onEndEditing={() => updateSettings({ apiEndpoint: endpointInput })}
            placeholder={DEFAULT_ENDPOINT}
            placeholderTextColor="palette.fillStrong"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.cardDesc}>留空用官方地址。以后如果把请求转接到自己的服务器,填在这里。</Text>

          <Pressable onPress={() => router.push('/probe')} style={styles.probeRow} hitSlop={8}>
            <Text style={styles.linkText}>相机能力探测 ›</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/wb-test')} hitSlop={8}>
            <Text style={styles.linkText}>白平衡标定 ›</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/history')} hitSlop={8}>
            <Text style={styles.linkText}>拍照历史 ›</Text>
          </Pressable>
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
          trackColor={{ false: 'palette.border', true: palette.accentBorder }}
          thumbColor={value ? palette.text : 'palette.textSoft'}
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
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
  },
  backButton: {
    width: 64,
  },
  backText: {
    color: palette.accent,
    fontSize: type.body.fontSize,
    fontWeight: weight.semibold,
  },
  title: {
    color: palette.text,
    fontSize: type.headline.fontSize,
    fontWeight: weight.bold,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.huge,
    gap: spacing.xl,
  },
  card: {
    backgroundColor: palette.fillSubtle,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
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
    fontSize: type.headline.fontSize,
    fontWeight: weight.semibold,
  },
  cardValue: {
    color: palette.accent,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
  },
  cardValueSmall: {
    color: palette.textFaint,
    fontSize: type.caption.fontSize,
    fontWeight: weight.bold,
  },
  cardDesc: {
    color: palette.textDim,
    fontSize: type.subhead.fontSize,
    lineHeight: 19,
  },
  note: {
    color: palette.warn,
    fontSize: type.subhead.fontSize,
    fontWeight: weight.semibold,
  },
  keyValue: {
    color: palette.text,
    fontSize: type.headline.fontSize,
    fontWeight: weight.bold,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  input: {
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'palette.scrimStrong',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'palette.border',
    color: palette.text,
    fontSize: type.body.fontSize,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.xxs,
  },
  primaryBtn: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  primaryBtnText: {
    color: palette.onAccent,
    fontSize: type.body.fontSize,
    fontWeight: weight.bold,
  },
  secondaryBtn: {
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: palette.fill,
    minWidth: 92,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: palette.text,
    fontSize: type.body.fontSize,
    fontWeight: weight.semibold,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  probeRow: {
    marginTop: spacing.xs,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.hairline,
  },
  versionText: {
    color: palette.textFaint,
    fontSize: type.caption.fontSize,
    marginTop: spacing.xxs,
  },
  linkText: {
    color: palette.accent,
    fontSize: type.callout.fontSize,
    fontWeight: weight.semibold,
  },
  testResult: {
    fontSize: type.subhead.fontSize,
    lineHeight: 19,
    fontWeight: weight.semibold,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xs,
  },
  stepper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.fill,
  },
  stepperDisabled: {
    opacity: 0.35,
  },
  stepperText: {
    color: palette.text,
    fontSize: type.title.fontSize,
    fontWeight: weight.semibold,
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
    backgroundColor: palette.border,
  },
  tickActive: {
    backgroundColor: palette.accent,
  },
  tickDisabled: {
    backgroundColor: palette.hairline,
  },
  summary: {
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: palette.accentSoft,
    gap: spacing.xs,
  },
  summaryTitle: {
    color: palette.accent,
    fontSize: type.caption.fontSize,
    fontWeight: weight.heavy,
    letterSpacing: 0.6,
  },
  summaryLine: {
    color: 'palette.textSoft',
    fontSize: type.callout.fontSize,
    lineHeight: 20,
  },
});
