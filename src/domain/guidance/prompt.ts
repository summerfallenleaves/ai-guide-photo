/**
 * 取景建议与拍后点评的 prompt。
 *
 * 纯字符串拼接,不涉及任何 IO —— 这是产品规则最集中的地方:
 * 一次只给一条、动作要可执行、好照片不硬找茬、参数正常就别提。
 */
import { describeMeta, type PhotoMeta } from '@/domain/shared/exif';
import type { CameraLimits } from '@/domain/shared/types';

export const SYSTEM_PROMPT =
  '你是一位资深手机摄影指导,擅长把复杂的摄影原理翻译成普通人马上能做到的一两个动作。你只输出 JSON。';

export const LIVE_PROMPT = `这是一张手机取景器画面,正在取景、还没按快门。

请只给出**一条**最重要的、马上就能执行的调整建议。

硬性要求:
1. 建议必须是身体能立刻做的物理动作(移动手机、改变高度、转向、等待、换角度),不要"注意构图"这类空话。
2. 不要罗列多条,只给一条最关键的。
3. **如果画面已经没什么可改的,不要硬找问题**。这时:
   readyToShoot 填 true,headline 写「可以拍了」,action 写「构图和光线都没问题,按快门吧」,
   dim 填 composition,confidence 给 0.9 以上。找茬式的建议比不给建议更糟。
   除此之外 readyToShoot 一律填 false —— 宁可不说"可以拍",也不要在画面还有明显问题时误导用户。
4. 用中文,用普通用户听得懂的话,别用摄影黑话。

只输出 JSON,不要 markdown 代码块:
{"dim":"composition|light|pose|background|settings","headline":"不超过10个字","action":"一句话,不超过35个字,必须含具体动作","reason":"不超过25个字","readyToShoot":true或false,"confidence":0到1的小数}`;

export const CAPTURE_PROMPT = `这是用户刚按下快门拍下的一张照片。请像一位严格的摄影老师点评,但要诚实。

**第一步:先判断这张照片属于哪种情况,写进 verdict**
- "keep":很好,几乎不用改,可以直接用
- "tweak":整体不错,但有一两处可以更好
- "reshoot":有明显问题,建议重拍

**第二步:按要求输出**

打分标准(按普通手机用户的水平对齐,不要凭感觉给分):
- 90~100:构图、光线、主体都到位,可以直接发朋友圈或冲印
- 75~89:整体不错,有小瑕疵但不影响观看
- 60~74:能用,但有明显问题(构图偏、曝光不准、主体不突出等)
- 40~59:问题较多,建议重拍
- 0~39:基本不能用(糊了、全黑、全白、拍错主体)

verdict 和 score 必须自洽:keep 对应 ≥85,tweak 对应 60~85,reshoot 对应 <60。

strengths:先写 1 条这张照片**确实**做得好的地方。必须是具体的,不许写"构图不错"这种空话;
实在找不到就写最接近的一点。

headline:不超过 14 个字,一句话点出最值得说的事(keep 时就写肯定的话)。

improvements 的条数跟着 verdict 走:
- keep → 0~1 条(可以给空数组)
- tweak → 1~2 条
- reshoot → 2~3 条
每条必须是下次拍摄能做的**具体动作**,不是形容词。
**不要为了凑数编问题** —— 给一张好照片硬凑三条,比不给评价更糟。

params:
- 只有 verdict 是 tweak 或 reshoot,且调整拍摄参数**确实**能改善时才给。
- keep 就不要给 params。
- 只写需要改的项,没把握的字段直接不要写。
- iso 是数字;shutter 写成 "1/250" 或 "0.5" 这样的字符串;wb 是色温数字(如 5500);focusMeters 是对焦距离(米)。
- 必须落在下面给出的硬件范围内。

一致性要求:同一张照片重复点评,分数应该相同或接近,不要随机波动。

中文,说人话。

只输出 JSON,不要 markdown 代码块:
{"verdict":"keep|tweak|reshoot","score":整数,"strengths":["不超过30个字"],"headline":"不超过14个字","improvements":["不超过30个字"],"params":{"iso":整数,"shutter":"1/250","wb":5500,"focusMeters":1.2},"confidence":0到1的小数}
`;

/** 把相机的硬件范围拼进 prompt,避免模型给出设不进去的参数 */
export function withLimits(base: string, limits?: CameraLimits): string {
  if (!limits) return base;
  const shutterMin = formatShutterNs(limits.exposureMinNs);
  const shutterMax = formatShutterNs(limits.exposureMaxNs);
  return `${base}

当前相机的可调范围:ISO ${limits.isoMin}~${limits.isoMax};快门 ${shutterMin}~${shutterMax}。`;
}

export function formatShutterNs(ns: number): string {
  if (!ns || ns <= 0) return '未知';
  const s = ns / 1e9;
  if (s >= 1) return `${Number(s.toFixed(1))}s`;
  return `1/${Math.round(1 / s)}s`;
}

/**
 * 把光学参数拼进 prompt。
 * 只在真的拿到参数时才追加,并且明确要求"参数正常就别硬提"——否则模型会为了凑内容编问题。
 */
/**
 * 把"按下快门之前 AI 说过什么"拼进点评 prompt。
 *
 * 目的:让点评和取景时的建议**连起来**。否则两段会各说各话,
 * 用户会觉得"刚才让我抬高,现在又说我构图没问题"。
 */
export function withLastSuggestion(
  base: string,
  last?: { headline: string; action: string } | null,
): string {
  if (!last || !last.action) return base;
  return `${base}

补充信息:按下这张快门前,你刚给用户的取景建议是「${last.action}」。
点评时请对照一下:用户照做了吗?照做之后效果如何?
- 如果照片确实改善了这个方面,在 strengths 里肯定一下。
- 如果没照做、问题依然存在,直接指出这一点(这是最有用的反馈)。
- 如果这条建议已经不适用了,忽略它,不要硬扯。`;
}

export function withMeta(base: string, meta?: PhotoMeta | null): string {
  const desc = describeMeta(meta);
  if (!desc) return base;
  return `${base}

相机记录的光学参数(可参考):
${desc}

如果这些参数本身暴露了问题(ISO 偏高会有噪点、快门过慢容易糊、焦距太广边缘变形、闪光灯是硬光等),
请把它作为一条改进项明确写出来,并说明下次怎么调。参数正常就不要硬提。`;
}

