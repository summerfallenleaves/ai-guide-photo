/**
 * DeepSeek 的 HTTP 客户端。
 *
 * 只负责传输:拼请求体、超时重试、错误分类。
 * **规则不在这里** —— prompt 在 `domain/guidance/prompt.ts`,
 * 返回内容的清洗在 `domain/guidance/scoring.ts`。
 */
import { SYSTEM_PROMPT, composeAnalysisPrompt } from '@/domain/guidance/prompt';
import { __normalize, parseJsonLoose } from '@/domain/guidance/scoring';
import type { PhotoMeta } from '@/domain/shared/exif';
import type { Advice } from '@/domain/guidance/continuity';
import type { AnalyzeOutcome, CameraLimits, SceneId } from '@/domain/shared/types';

export type { CameraLimits };

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-flash';

export type Thinking = 'disabled' | 'low' | 'high';

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'quota' | 'rate' | 'server' | 'timeout' | 'parse' | 'nokey',
  ) {
    super(message);
  }
}

export type AskOptions = {
  imageBase64: string;
  mode: 'live' | 'capture';
  thinking: Thinking;
  limits?: CameraLimits;
  /** 拍摄参数,没有就不传 */
  meta?: PhotoMeta | null;
  /** 快门前的最后一条取景建议 */
  lastLiveSuggestion?: { headline: string; action: string } | null;
  /** 上一轮取景建议与它被重复的次数,用于保持建议连续性 */
  previousAdvice?: { advice: Advice; repeat: number } | null;
  /** 整个取景会话的建议摘要,点评时用来对照 */
  sessionAdvice?: string | null;
  /** 场景:决定用哪一套标准与 few-shot */
  scene?: SceneId | null;
  /** 复盘参考图(只用于 capture;取景不带图,保持 3 秒节奏) */
  referenceImages?: { base64: string; caption: string }[] | null;
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
};

/** 直接请求 DeepSeek,不经过任何中间服务器 */
export async function askDeepSeek(opts: AskOptions): Promise<AnalyzeOutcome> {
  const isCapture = opts.mode === 'capture';
  const endpoint = (opts.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const model = opts.model || DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? (isCapture ? 40000 : 20000);

  // 参考图只在点评时带:每 3 秒一轮的取景带图会把延迟拖垮
  const refs = isCapture ? (opts.referenceImages ?? []).filter((item) => item.base64) : [];
  const referenceBlocks = refs.flatMap((item, index) => [
    { type: 'text', text: `参考图 ${index + 1}:${item.caption}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${item.base64}`, detail: 'high' } },
  ]);

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: composeAnalysisPrompt({
              mode: isCapture ? 'capture' : 'live',
              meta: opts.meta,
              scene: opts.scene,
              previousAdvice: opts.previousAdvice,
              lastLiveSuggestion: opts.lastLiveSuggestion,
              sessionAdvice: opts.sessionAdvice,
              limits: isCapture ? opts.limits : undefined,
              hasReferences: refs.length > 0,
            }),
          },
          ...referenceBlocks,
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${opts.imageBase64}`, detail: 'high' },
          },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: pickMaxTokens(opts.thinking, isCapture),
    response_format: { type: 'json_object' },
    ...thinkingParams(opts.thinking),
  };

  const call = async (payload: Record<string, unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await call(body);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new DeepSeekError(`请求超时(${Math.round(timeoutMs / 1000)} 秒)`, 'timeout');
    }
    // 网络抖动,重试一次
    try {
      res = await call(body);
    } catch {
      throw new DeepSeekError('网络连不上,请检查手机网络', 'network');
    }
  }

  // 少数账号不开放 json_object,降级重试
  if (res.status === 400) {
    const text = await res.text().catch(() => '');
    if (/response_format|json_object|json mode/i.test(text)) {
      delete body.response_format;
      res = await call(body);
    } else {
      throw new DeepSeekError(`请求被拒绝:${text.slice(0, 160)}`, 'server');
    }
  }

  if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));

  let json = await res.json();
  let raw: string = json?.choices?.[0]?.message?.content ?? '';

  // 思考模式的思维链也计入 max_tokens,预算不够时正文为空
  if (json?.choices?.[0]?.finish_reason === 'length') {
    body.max_tokens = Math.min(Number(body.max_tokens) * 2, 8000);
    const retry = await call(body);
    if (!retry.ok) throw mapHttpError(retry.status, await retry.text().catch(() => ''));
    json = await retry.json();
    raw = json?.choices?.[0]?.message?.content ?? '';
  }

  const parsed = parseJsonLoose(raw);
  if (!parsed) {
    throw new DeepSeekError('模型返回的内容无法解析,请重试', 'parse');
  }

  return __normalize(parsed, isCapture);
}

/** 用一次极小的文本请求验证 Key 是否可用 */
export async function verifyApiKey(apiKey: string, endpoint?: string): Promise<void> {
  const base = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: '只回复 OK 两个字母。' }],
        max_tokens: 8,
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''));
  } catch (err) {
    if (err instanceof DeepSeekError) throw err;
    throw new DeepSeekError('连不上 DeepSeek,请检查网络或接口地址', 'network');
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status: number, text: string): DeepSeekError {
  if (status === 401) return new DeepSeekError('API Key 无效或已过期', 'auth');
  if (status === 402) return new DeepSeekError('账户额度不足,请去 DeepSeek 后台充值', 'quota');
  if (status === 403) return new DeepSeekError('没有访问权限', 'auth');
  if (status === 429) return new DeepSeekError('请求太频繁,稍等一下', 'rate');
  if (status >= 500) return new DeepSeekError('DeepSeek 服务端出错,请稍后重试', 'server');
  return new DeepSeekError(`请求失败(${status}):${text.slice(0, 160)}`, 'server');
}

function thinkingParams(level: Thinking) {
  if (level === 'disabled') return { thinking: { type: 'disabled' } };
  return { thinking: { type: 'enabled' }, reasoning_effort: level };
}

/**
 * 思考模式的思维链同样计入 max_tokens,所以按强度分档。
 * 实测:不思考正文只用 32~77 token;high 会产生 260~814 个思考 token。
 */
function pickMaxTokens(thinking: Thinking, isCapture: boolean): number {
  if (thinking === 'disabled') return isCapture ? 600 : 400;
  if (thinking === 'low') return 1500;
  return 3000;
}
