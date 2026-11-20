import { useSyncExternalStore } from 'react';

import { getApiKeySnapshot, subscribeApiKey } from '@/data/secure-key';

/** 订阅设备上保存的 API Key,保存/清除后使用它的页面会自动刷新 */
export function useApiKey(): string | null {
  return useSyncExternalStore(subscribeApiKey, getApiKeySnapshot);
}
