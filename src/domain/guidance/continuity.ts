import { SCENES } from '@/domain/guidance/scenes';
import type { SceneId } from '@/domain/shared/types';

/**
 * 取景建议的连续性。
 *
 * 问题:每 3~10 秒独立分析一次,模型看不到上一轮说过什么,于是可能这轮说"抬高"、
 * 下轮说"降低" —— 用户会觉得 AI 不可靠,而且照着做会来回折腾。
 *
 * 做法:把上一条建议一起喂给模型,并告诉它"已经说过几次",让它判断
 * 「用户照做了吗 / 画面改善了吗 / 该不该换一个问题」,而不是每轮从零开始。
 *
 * 这里只有纯函数,方便单测;真正调用模型的地方在 hooks/use-live-analysis。
 */

export type Advice = {
  headline: string;
  action: string;
  dim: string;
  /** 这条建议是在哪个场景标准下给的(用户中途换场景时用来标记) */
  scene?: SceneId;
};

/**
 * 同一条建议被连续提出了几次。
 *
 * 判定标准是 action 文本相同 —— 只要动作一样就视为同一条,
 * headline 措辞变一变不算新建议。
 */
export function nextRepeat(previous: Advice | null, nextAction: string): number {
  const current = (previous?.action ?? '').trim();
  const incoming = (nextAction ?? '').trim();
  if (!current || !incoming) return 1;
  return current === incoming ? 2 : 1;
}

/**
 * 拼给模型的"上一轮说过什么"。
 *
 * - 第一次(没有历史)→ null,不拼
 * - 重复第 1 次 → 让它先判断有没有照做,不要重复
 * - 重复第 2 次及以上 → 要求换维度/换更明确的动作,别再说一遍
 */
export function continuityNote(previous: Advice | null, repeat: number): string | null {
  if (!previous || !previous.action) return null;

  const sceneLabel = previous.scene ? SCENES[previous.scene]?.label ?? previous.scene : null;
  const where = sceneLabel ? `场景:${sceneLabel} · ` : '';
  const head = `上一轮你已经建议过:「${previous.action}」(${where}维度:${previous.dim})。`;

  if (repeat <= 1) {
    return `${head}
先判断:用户照做了吗?画面改善了吗?
- 已经改善 → 简短肯定,并换到下一个真正值得改的问题;没有可改的就给 readyToShoot。
- 没照做、问题还在 → 可以说得更具体(比如量化成厘米、角度),但**不要原样重复**。
- 不要给出和它相反的方向(比如刚说抬高又说降低),除非画面确实反过来了 —— 那就说明原因。`;
  }

  return `${head}
这条建议已经连续提了 ${repeat} 次,用户可能做不到、或者听不进去。**不要再说第 ${repeat + 1} 次**:
- 换一个维度(构图 ↔ 光线 ↔ 背景 ↔ 人物),或者
- 换成一个**更容易执行**的动作(比如从"抬高 20 厘米"改成"把手机举到与屏幕齐平")
如果画面已经不错,直接给 readyToShoot。`;
}
