import { askDeepSeek, DeepSeekError, DEFAULT_ENDPOINT, type CameraLimits, type Thinking } from '@/infra/ai/client';
import type { PhotoMeta } from '@/domain/shared/exif';
import { getCachedApiKey } from '@/data/secure-key';
import type { AnalysisResult } from '@/domain/shared/types';

export { DeepSeekError, DEFAULT_ENDPOINT };

export type AnalyzeOptions = {
  thinking?: Thinking;
  endpoint?: string;
  timeoutMs?: number;
  /** 相机记录的光学参数 */
  meta?: PhotoMeta | null;
  /** 相机硬件可调范围,用于约束 AI 给出的参数 */
  limits?: CameraLimits;
  /** 快门前的最后一条取景建议,让点评能对照"用户有没有照做" */
  lastLiveSuggestion?: { headline: string; action: string } | null;
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
    limits: opts.limits,
    lastLiveSuggestion: opts.lastLiveSuggestion,
    apiKey,
    endpoint: opts.endpoint,
    timeoutMs: opts.timeoutMs,
  });
}
