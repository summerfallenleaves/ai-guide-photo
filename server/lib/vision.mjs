/**
 * 轻量画面体检:不调用任何大模型,纯像素统计。
 * 目的是在 VLM 之前"先看一眼",能省一次 API 调用就省,并且给 VLM 提供客观指标。
 *
 * sharp 是可选依赖:装不上时整个服务仍能工作,只是退化为纯云端模式。
 */
let sharpModule;
async function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try {
    sharpModule = (await import('sharp')).default;
  } catch (err) {
    console.warn('[vision] sharp 不可用,跳过本地体检:', err.message);
    sharpModule = null;
  }
  return sharpModule;
}

export async function analyzeFrameSafe(buffer) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    return await analyzeFrame(buffer, sharp);
  } catch (err) {
    console.warn('[vision] 画面分析失败:', err.message);
    return null;
  }
}

export async function analyzeFrame(buffer, sharp) {
  const { data, info } = await sharp(buffer)
    .rotate() // 手机拍的照片常带 EXIF 方向
    .resize(96, 96, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const n = width * height;
  const lum = new Float32Array(n);

  let sum = 0;
  let sumSq = 0;
  let dark = 0;
  let bright = 0;
  let centerSum = 0;
  let centerCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * channels;
      const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
      lum[i] = l;
      sum += l;
      sumSq += l * l;
      if (l < 20) dark++;
      if (l > 242) bright++;
      if (x > width * 0.25 && x < width * 0.75 && y > height * 0.25 && y < height * 0.75) {
        centerSum += l;
        centerCount++;
      }
    }
  }

  const mean = sum / n;
  const contrast = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const darkPct = dark / n;
  const brightPct = bright / n;
  const centerMean = centerCount ? centerSum / centerCount : mean;

  // 边缘与中心亮度差:背景比主体亮太多时经常是逆光
  const backlight = centerMean - mean < -18;

  const verdict = pickVerdict({ mean, contrast, brightPct, backlight });

  return {
    mean: round(mean),
    contrast: round(contrast),
    darkPct: round(darkPct * 100),
    brightPct: round(brightPct * 100),
    centerMean: round(centerMean),
    verdict,
  };
}

function pickVerdict({ mean, contrast, brightPct, backlight }) {
  if (brightPct > 0.09) return 'tooBright';
  if (mean < 42) return 'tooDark';
  if (backlight) return 'backlight';
  if (contrast < 20) return 'flat';
  return 'ok';
}

/** 本地就能给出的建议,用来兜底(断网 / 未配置 Key / API 失败) */
export function localSuggestion(metrics) {
  switch (metrics.verdict) {
    case 'tooBright':
      return {
        dim: 'light',
        headline: '高光已经过曝',
        action: '手指点一下最亮的天空再降一档曝光,或侧身让光从侧面来',
        reason: '画面里超过 9% 的像素已经死白,后期拉不回来',
        confidence: 0.72,
      };
    case 'tooDark':
      return {
        dim: 'light',
        headline: '画面太暗了',
        action: '转向光源,或点击屏幕主体后把曝光滑杆往上推一格',
        reason: '平均亮度只有 ' + metrics.mean + '/255,暗部细节会丢失',
        confidence: 0.75,
      };
    case 'backlight':
      return {
        dim: 'light',
        headline: '主体在逆光里',
        action: '绕到被拍者的另一侧,让光落在脸上而不是背后',
        reason: '背景比主体亮很多,人物会变成剪影',
        confidence: 0.7,
      };
    case 'flat':
      return {
        dim: 'light',
        headline: '画面有点灰',
        action: '找一个有明暗对比的角度,比如让主体靠近窗边',
        reason: '对比度偏低,画面看起来会发闷',
        confidence: 0.6,
      };
    default:
      return {
        dim: 'composition',
        headline: '按三分法挪一下主体',
        action: '把人物眼睛放在画面上三分之一的交叉点附近',
        reason: '居中构图最稳,但缺少张力',
        confidence: 0.55,
      };
  }
}

function round(v) {
  return Math.round(v * 10) / 10;
}
