import type { CaptureResult, Dim, LiveSuggestion } from './types';

export type Thinking = 'disabled' | 'low' | 'high';
export type AnalyzeOutcome = LiveSuggestion | CaptureResult;

export const DEFAULT_ENDPOINT = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-flash';

const DIM_LABELS: Record<Dim, string> = {
  composition: '构图',
  light: '光线',
  pose: '人物',
  background: '背景',
  settings: '参数',
};

const SYSTEM_PROMPT =
  '你是一位资深手机摄影指导,擅长把复杂的摄影原理翻译成普通人马上能做到的一两个动作。你只输出 JSON。';

const LIVE_PROMPT = `这是一张手机取景器画面,正在取景、还没按快门。

请只给出**一条**最重要的、马上就能执行的调整建议。

硬性要求:
1. 建议必须是身体能立刻做的物理动作(移动手机、改变高度、转向、等待、换角度),不要"注意构图"这类空话。
2. 不要罗列多条,只给一条最关键的。
3. 如果画面已经很好,就给一个"可以按快门了"式的肯定,并把 confidence 调高。
4. 用中文,用普通用户听得懂的话,别用摄影黑话。

只输出 JSON,不要 markdown 代码块:
{"dim":"composition|light|pose|background|settings","headline":"不超过10个字","action":"一句话,不超过35个字,必须含具体动作","reason":"不超过25个字","confidence":0到1的小数}`;

const CAPTURE_PROMPT = `这是用户刚按下快门拍下的一张照片。

请像一位严格的摄影老师一样点评。

要求:
1. score 是 0-100 的整体分数,按普通手机用户的水平来打分,别太苛刻也别滥给高分。
2. headline 一句话说清这张照片最大的问题或最大的亮点。
3. improvements 给 2-3 条具体改进,每条必须是下一次拍摄时能做的动作。
4. 中文,说人话。

只输出 JSON,不要 markdown 代码块:
{"score":整数,"headline":"不超过14个字","improvements":["不超过30个字","...","..."],"dims":["composition","light","pose","background","settings" 中的一个或多个],"confidence":0到1的小数}`;

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

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: isCapture ? CAPTURE_PROMPT : LIVE_PROMPT },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${opts.imageBase64}`, detail: 'high' },
          },
        ],
      },
    ],
    temperature: 0.4,
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

  return normalize(parsed, isCapture);
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

function normalize(p: Record<string, unknown>, isCapture: boolean): AnalyzeOutcome {
  const dimValue = typeof p.dim === 'string' ? p.dim : '';
  const dim: Dim = (Object.keys(DIM_LABELS) as Dim[]).includes(dimValue as Dim)
    ? (dimValue as Dim)
    : 'composition';

  if (isCapture) {
    const rawScore = Number(p.score);
    const improvements = Array.isArray(p.improvements)
      ? p.improvements.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 3).map((x) => clip(x, 40))
      : [];
    return {
      mode: 'capture',
      score: Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 60,
      headline: clip(p.headline, 20) || '还行,可以更好',
      dim,
      dimLabel: DIM_LABELS[dim],
      improvements,
      confidence: clamp01(p.confidence, 0.6),
      source: 'deepseek',
    };
  }

  return {
    mode: 'live',
    dim,
    dimLabel: DIM_LABELS[dim],
    headline: clip(p.headline, 14) || '调整一下试试',
    action: clip(p.action, 40) || '换一个角度再取景',
    reason: clip(p.reason, 30),
    confidence: clamp01(p.confidence, 0.6),
    source: 'deepseek',
  };
}

function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clamp01(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function parseJsonLoose(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
