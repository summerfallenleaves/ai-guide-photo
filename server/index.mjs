import http from 'node:http';
import { createHash } from 'node:crypto';
import { analyzeFrameSafe, localSuggestion } from './lib/vision.mjs';
import { askVisionAndJudge } from './lib/deepseek.mjs';

const PORT = Number(process.env.PORT ?? 8787);
const CONFIG = {
  apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
  model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash',
  baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
  timeoutMs: Number(process.env.ANALYZE_TIMEOUT_MS ?? 15000),
  // 拍后复盘要多写几句话,给宽一点
  captureTimeoutMs: Number(process.env.ANALYZE_CAPTURE_TIMEOUT_MS ?? 30000),
  // disabled(默认) / low / high / max —— 思考模式开关
  thinking: process.env.DEEPSEEK_THINKING?.trim() || 'disabled',
  // 视觉细节级别:high(默认,~1000 token)/ low(~200 token,更省更快但看不清细节)
  detail: process.env.DEEPSEEK_DETAIL?.trim() || 'high',
};

const MAX_BODY = 12 * 1024 * 1024;
const cache = new Map(); // sha1 -> { data, at }
const CACHE_TTL = 30_000;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // 手机端从局域网访问,放开 CORS(仅开发用)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      mode: CONFIG.apiKey ? 'deepseek' : 'local-only',
      model: CONFIG.model,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (url.pathname === '/api/analyze' && req.method === 'POST') {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: `请求体不合法: ${err.message}` });
    }

    const image = typeof payload.image === 'string' ? payload.image : '';
    const mode = payload.mode === 'capture' ? 'capture' : 'live';
    if (!image) return sendJson(res, 400, { ok: false, error: '缺少 image' });

    // 思考强度由客户端按设置传,缺省用服务端配置
    const thinking = normalizeThinking(payload.thinking) ?? CONFIG.thinking;

    const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return sendJson(res, 400, { ok: false, error: 'base64 解析失败' });
    }
    if (buffer.length < 512) return sendJson(res, 400, { ok: false, error: '图片太小' });

    const hash = `${mode}:${thinking}:${createHash('sha1').update(buffer).digest('hex')}`;
    const hit = cache.get(hash);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return sendJson(res, 200, { ok: true, data: hit.data, meta: { cached: true, ms: Date.now() - started } });
    }

    const metrics = await analyzeFrameSafe(buffer);

    let data;
    let source = 'local';
    if (CONFIG.apiKey) {
      try {
        data = await askVisionAndJudge({
          imageBase64: base64,
          mode,
          metrics: metrics ?? neutralMetrics(),
          config: { ...CONFIG, thinking },
        });
        source = 'deepseek';
      } catch (err) {
        console.warn('[analyze] 云端失败,退回本地:', err.message);
        data = fallback(data, mode, metrics);
      }
    } else {
      data = fallback(null, mode, metrics);
    }

    const result = { ...data, metrics };
    if (source === 'local') result.source = 'local';
    cache.set(hash, { data: result, at: Date.now() });
    if (cache.size > 200) cache.delete(cache.keys().next().value);

    console.log(
      `[analyze] mode=${mode} src=${result.source} ${buffer.length}B ${Date.now() - started}ms ` +
        `${metrics ? `mean=${metrics.mean} verdict=${metrics.verdict}` : 'no-metrics'}`
    );

    return sendJson(res, 200, { ok: true, data: result, meta: { ms: Date.now() - started, source: result.source } });
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

function normalizeThinking(value) {
  const v = typeof value === 'string' ? value.toLowerCase() : '';
  return ['disabled', 'low', 'high', 'max'].includes(v) ? v : null;
}

function fallback(partial, mode, metrics) {
  const local = metrics ? localSuggestion(metrics) : {
    dim: 'composition',
    headline: '试着换个角度',
    action: '把主体放到画面三分之一的位置,再按快门',
    reason: '居中构图最稳但缺少张力',
    confidence: 0.5,
  };

  if (mode === 'live') {
    return {
      mode: 'live',
      ...local,
      dimLabel: labelOf(local.dim),
      source: 'local',
    };
  }

  const score = scoreFromMetrics(metrics);
  return {
    mode: 'capture',
    score,
    headline: score >= 75 ? '这张可以用' : '还能再救一下',
    dim: local.dim,
    dimLabel: labelOf(local.dim),
    improvements: [local.action, '再拍一张,把主体放到三分线交叉点上'],
    confidence: 0.5,
    source: 'local',
  };
}

function scoreFromMetrics(m) {
  if (!m) return 60;
  let s = 70;
  if (m.verdict === 'tooDark' || m.verdict === 'tooBright') s -= 18;
  else if (m.verdict === 'backlight') s -= 12;
  else if (m.verdict === 'flat') s -= 6;
  else s += 8;
  if (m.contrast > 45) s += 5;
  return Math.max(10, Math.min(95, Math.round(s)));
}

function labelOf(dim) {
  return { composition: '构图', light: '光线', pose: '人物', background: '背景', settings: '参数' }[dim] ?? '构图';
}

function neutralMetrics() {
  return { mean: 128, contrast: 40, darkPct: 2, brightPct: 1, centerMean: 128, verdict: 'ok' };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('图片过大,请降低抓帧分辨率'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AI 拍照引导 · 本地代理已启动`);
  console.log(`  地址    http://0.0.0.0:${PORT}`);
  console.log(`  模型    ${CONFIG.model}`);
  console.log(`  状态    ${CONFIG.apiKey ? '✅ 已接入 DeepSeek' : '⚠️  未配置 DEEPSEEK_API_KEY,仅本地建议'}`);
  console.log(`  体检    http://localhost:${PORT}/health\n`);
});
