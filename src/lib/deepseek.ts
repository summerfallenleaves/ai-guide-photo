import { describeMeta, type PhotoMeta } from './exif';
import type { AdjustParams, CaptureResult, Dim, LiveSuggestion } from './types';

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
3. **如果画面已经没什么可改的,不要硬找问题**。这时:
   headline 写「可以拍了」,action 写「构图和光线都没问题,按快门吧」,dim 填 composition,
   confidence 给 0.9 以上。找茬式的建议比不给建议更糟。
4. 用中文,用普通用户听得懂的话,别用摄影黑话。

只输出 JSON,不要 markdown 代码块:
{"dim":"composition|light|pose|background|settings","headline":"不超过10个字","action":"一句话,不超过35个字,必须含具体动作","reason":"不超过25个字","confidence":0到1的小数}`;

const CAPTURE_PROMPT = `这是用户刚按下快门拍下的一张照片。

请像一位严格的摄影老师一样点评。

打分标准(按普通手机用户的水平对齐,不要凭感觉给分):
- 90~100:构图、光线、主体都到位,可以直接发朋友圈或冲印
- 75~89:整体不错,有小瑕疵但不影响观看
- 60~74:能用,但有明显问题(构图偏、曝光不准、主体不突出等)
- 40~59:问题较多,建议重拍
- 0~39:基本不能用(糊了、全黑、全白、拍错主体)

headline:一句话说清这张照片最大的亮点,或者最大的问题。不超过 14 个字。

improvements 的写法(**不要为了凑数编问题**):
- 照片确实有值得改的地方才写,写 2~3 条,每条必须是下次拍摄能做的具体动作。
- 如果这张已经很好(通常 score ≥ 85),可以只写 0~2 条,而且只写"锦上添花"的。
- **如果几乎没什么可改的,直接给空数组 [],headline 写一句肯定的评价。**
  给一张好照片硬凑三条问题,比不给评价更糟。

中文,说人话。

只输出 JSON,不要 markdown 代码块:
{"score":整数,"headline":"不超过14个字","improvements":["不超过30个字","...","..."],"params":{"iso":整数,"shutter":"1/250","wb":5500,"focusMeters":1.2},"confidence":0到1的小数}

关于 params:
- 只有当调整拍摄参数确实能改善这张照片时才给,照片已经很好就省略整个 params。
- 只写需要改的项,没把握的字段直接不要写。
- iso 是数字;shutter 写成 "1/250" 或 "0.5" 这样的字符串;wb 是色温数字(如 5500);focusMeters 是对焦距离(米)。
- 必须落在下面给出的硬件范围内,不要给范围外的值。`;

/** 把相机的硬件范围拼进 prompt,避免模型给出设不进去的参数 */
function withLimits(base: string, limits?: CameraLimits): string {
  if (!limits) return base;
  const shutterMin = formatShutterNs(limits.exposureMinNs);
  const shutterMax = formatShutterNs(limits.exposureMaxNs);
  return `${base}

当前相机的可调范围:ISO ${limits.isoMin}~${limits.isoMax};快门 ${shutterMin}~${shutterMax}。`;
}

function formatShutterNs(ns: number): string {
  if (!ns || ns <= 0) return '未知';
  const s = ns / 1e9;
  if (s >= 1) return `${Number(s.toFixed(1))}s`;
  return `1/${Math.round(1 / s)}s`;
}

/**
 * 把光学参数拼进 prompt。
 * 只在真的拿到参数时才追加,并且明确要求"参数正常就别硬提"——否则模型会为了凑内容编问题。
 */
function withMeta(base: string, meta?: PhotoMeta | null): string {
  const desc = describeMeta(meta);
  if (!desc) return base;
  return `${base}

相机记录的光学参数(可参考):
${desc}

如果这些参数本身暴露了问题(ISO 偏高会有噪点、快门过慢容易糊、焦距太广边缘变形、闪光灯是硬光等),
请把它作为一条改进项明确写出来,并说明下次怎么调。参数正常就不要硬提。`;
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'quota' | 'rate' | 'server' | 'timeout' | 'parse' | 'nokey',
  ) {
    super(message);
  }
}

/** 相机硬件可调范围,用于约束模型给出的参数 */
export type CameraLimits = {
  isoMin: number;
  isoMax: number;
  exposureMinNs: number;
  exposureMaxNs: number;
};

export type AskOptions = {
  imageBase64: string;
  mode: 'live' | 'capture';
  thinking: Thinking;
  limits?: CameraLimits;
  /** 拍摄参数,没有就不传 */
  meta?: PhotoMeta | null;
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
          { type: 'text', text: withLimits(withMeta(isCapture ? CAPTURE_PROMPT : LIVE_PROMPT, opts.meta), isCapture ? opts.limits : undefined) },
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
      params: normalizeParams(p.params),
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

/** 解析并清洗模型给的可执行参数;全空就返回 null */
function normalizeParams(raw: unknown): AdjustParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: AdjustParams = {};
  const iso = Number(o.iso);
  if (Number.isFinite(iso) && iso > 0) out.iso = Math.round(iso);
  if (typeof o.shutter === 'string' && o.shutter.trim()) out.shutter = o.shutter.trim();
  else if (Number.isFinite(Number(o.shutter)) && Number(o.shutter) > 0) out.shutter = String(o.shutter);
  const wb = Number(o.wb);
  if (Number.isFinite(wb) && wb >= 2000 && wb <= 10000) out.wb = Math.round(wb);
  const focus = Number(o.focusMeters);
  if (Number.isFinite(focus) && focus > 0) out.focusMeters = focus;
  return Object.keys(out).length > 0 ? out : null;
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
