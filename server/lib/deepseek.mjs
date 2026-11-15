const DIM_LABELS = {
  composition: '构图',
  light: '光线',
  pose: '人物',
  background: '背景',
  settings: '参数',
};

const LIVE_PROMPT = (m) => `这是一张手机取景器画面,正在取景、还没按快门。

客观指标(0-255):平均亮度 ${m.mean},对比度 ${m.contrast},死黑占比 ${m.darkPct}%,过曝占比 ${m.brightPct}%,中心亮度 ${m.centerMean}。

请只给出**一条**最重要的、马上就能执行的调整建议。

硬性要求:
1. 建议必须是身体能立刻做的物理动作(移动手机、改变高度、转向、等待、换角度),不要"注意构图"这类空话。
2. 不要罗列多条,只给一条最关键的。
3. 如果画面已经很好,就给一个"可以按快门了"式的肯定,并把 confidence 调高。
4. 用中文,用普通用户听得懂的话,别用摄影黑话。

只输出 JSON,不要 markdown 代码块:
{"dim":"composition|light|pose|background|settings","headline":"不超过10个字","action":"一句话,不超过35个字,必须含具体动作","reason":"不超过25个字","confidence":0到1的小数}`;

const CAPTURE_PROMPT = (m) => `这是用户刚按下快门拍下的一张照片。

客观指标(0-255):平均亮度 ${m.mean},对比度 ${m.contrast},死黑占比 ${m.darkPct}%,过曝占比 ${m.brightPct}%。

请像一位严格的摄影老师一样点评。

要求:
1. score 是 0-100 的整体分数,按普通手机用户的水平来打分,别太苛刻也别滥给高分。
2. headline 一句话说清这张照片最大的问题或最大的亮点。
3. improvements 给 2-3 条具体改进,每条必须是下一次拍摄时能做的动作。
4. 中文,说人话。

只输出 JSON,不要 markdown 代码块:
{"score":整数,"headline":"不超过14个字","improvements":["不超过30个字","...","..."],"dims":["composition","light","pose","background","settings" 中的一个或多个],"confidence":0到1的小数}`;

export async function askVisionAndJudge({ imageBase64, mode, metrics, config }) {
  const isCapture = mode === 'capture';
  const body = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content:
          '你是一位资深手机摄影指导,擅长把复杂的摄影原理翻译成普通人马上能做到的一两个动作。你只输出 JSON。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: (isCapture ? CAPTURE_PROMPT : LIVE_PROMPT)(metrics) },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' },
          },
        ],
      },
    ],
    temperature: 0.4,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let res;
  try {
    res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // 部分模型/账号不开放 json_object,降级重试一次
    if (res.status === 400) {
      const errText = await res.text().catch(() => '');
      if (/response_format|json_object|json mode/i.test(errText)) {
        delete body.response_format;
        res = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } else {
        throw new Error(`DeepSeek 400: ${errText.slice(0, 200)}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const raw = json?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error(`无法解析模型返回: ${String(raw).slice(0, 200)}`);

  return {
    ...normalize(parsed, isCapture),
    source: 'deepseek',
    usage: json?.usage ?? null,
  };
}

function normalize(p, isCapture) {
  const dim = DIM_LABELS[p.dim] ? p.dim : 'composition';
  if (isCapture) {
    const score = Number.isFinite(+p.score) ? Math.min(100, Math.max(0, Math.round(+p.score))) : 60;
    return {
      mode: 'capture',
      score,
      headline: str(p.headline, 20) || '还行,可以更好',
      dim,
      dimLabel: DIM_LABELS[dim],
      improvements: Array.isArray(p.improvements)
        ? p.improvements.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3).map((x) => str(x, 40))
        : [],
      confidence: clamp01(p.confidence, 0.6),
    };
  }
  return {
    mode: 'live',
    dim,
    dimLabel: DIM_LABELS[dim],
    headline: str(p.headline, 14) || '调整一下试试',
    action: str(p.action, 40) || '换一个角度再取景',
    reason: str(p.reason, 30),
    confidence: clamp01(p.confidence, 0.6),
  };
}

function str(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clamp01(v, fallback) {
  const n = +v;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** 模型偶尔会带 ```json 围栏或前后废话,这里做宽松解析 */
export function parseJsonLoose(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
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

export { DIM_LABELS };
