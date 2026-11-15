import Constants from 'expo-constants';

import type { AnalysisResult } from './types';

const PORT = 8787;

/**
 * 手机上的 Exponse Go 会通过局域网加载 bundle,`hostUri` 就是开发机的 IP:端口。
 * 用它可以自动推导出代理地址,省掉手填 IP 的麻烦。
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') {
    return `http://${host}:${PORT}`;
  }
  return `http://127.0.0.1:${PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

export class AnalyzeError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'server' | 'timeout' = 'network',
  ) {
    super(message);
  }
}

export async function analyze(
  imageBase64: string,
  mode: 'live' | 'capture',
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AnalysisResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mode }),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: { ok?: boolean; data?: AnalysisResult; error?: string } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AnalyzeError(`服务返回了非 JSON 内容: ${text.slice(0, 80)}`, 'server');
    }

    if (!res.ok || !json?.ok || !json.data) {
      throw new AnalyzeError(json?.error ?? `服务返回 ${res.status}`, 'server');
    }
    return json.data;
  } catch (err) {
    if (err instanceof AnalyzeError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new AnalyzeError('分析超时了', 'timeout');
    }
    throw new AnalyzeError(
      `连不上本地代理。检查手机和电脑是否同一 Wi-Fi,以及 ${API_BASE_URL} 是否在跑`,
      'network',
    );
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
