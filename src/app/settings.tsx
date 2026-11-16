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
import { palette, radius } from '@/lib/theme';

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
                placeholderTextColor="rgba(255,255,255,0.25)"
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
            placeholderTextColor="rgba(255,255,255,0.25)"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.cardDesc}>留空用官方地址。以后如果把请求转接到自己的服务器,填在这里。</Text>

          <Pressable onPress={() => router.push('/probe')} style={styles.probeRow} hitSlop={8}>
            <Text style={styles.linkText}>相机能力探测 ›</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/camera2-test')} hitSlop={8}>
            <Text style={styles.linkText}>自研 Camera2 相机验证 ›</Text>
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
  cardValueSmall: {
    color: palette.textFaint,
    fontSize: 11,
    fontWeight: '700',
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
  keyValue: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  input: {
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    color: palette.text,
    fontSize: 14,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  primaryBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  primaryBtnText: {
    color: '#00131F',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    minWidth: 92,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  probeRow: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  linkText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  testResult: {
    fontSize: 12.5,
    lineHeight: 19,
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
