import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'deepseek_api_key';

/**
 * API Key 只存在设备上:
 * - Android 走 Keystore 加密的 EncryptedSharedPreferences
 * - iOS 走 Keychain
 * - **不在安装包里**,也不经过任何服务器
 */
let cached: string | null = null;
const listeners = new Set<() => void>();

function commit(next: string | null) {
  cached = next;
  listeners.forEach((notify) => notify());
}

/** 供 useSyncExternalStore 使用:返回稳定快照 */
export function getApiKeySnapshot(): string | null {
  return cached;
}

export function subscribeApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCachedApiKey(): string | null {
  return cached;
}

export function hasApiKey(): boolean {
  return !!cached && cached.length > 0;
}

export async function loadApiKey(): Promise<string | null> {
  let value: string | null = null;
  try {
    value = await SecureStore.getItemAsync(STORAGE_KEY);
  } catch (err) {
    console.warn('[key] 读取失败:', err);
  }
  if (value !== cached) commit(value);
  return value;
}

export async function saveApiKey(value: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    commit(null);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, trimmed);
  commit(trimmed);
}

/** 只用于界面展示,避免把完整 Key 露在屏幕上 */
export function maskKey(key: string | null): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
