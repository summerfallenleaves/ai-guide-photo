import { askDeepSeek, DeepSeekError, DEFAULT_ENDPOINT, type Thinking } from './deepseek';
import type { PhotoMeta } from './exif';
import { getCachedApiKey } from './secure-key';
import type { AnalysisResult } from './types';

export { DeepSeekError, DEFAULT_ENDPOINT };

export type AnalyzeOptions = {
  thinking?: Thinking;
  endpoint?: string;
  timeoutMs?: number;
  /** 相机记录的光学参数 */
  meta?: PhotoMeta | null;
};

/**
 * 直接调用 DeepSeek,不经过任何自建服务器。
 *
 * Key 从设备的加密存储里读,只在本机内存和请求头里出现,
 * 既不在安装包里,也不经过任何中间服务器。
 */
export async function analyze(
  imageBase64: string,
  mode: 'live' | 'capture',
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const apiKey = getCachedApiKey();
  if (!apiKey) {
    throw new DeepSeekError('还没有配置 API Key,去设置里填一个', 'nokey');
  }

  return askDeepSeek({
    imageBase64,
    mode,
    thinking: opts.thinking ?? 'disabled',
    meta: opts.meta,
    apiKey,
    endpoint: opts.endpoint,
    timeoutMs: opts.timeoutMs,
  });
}
