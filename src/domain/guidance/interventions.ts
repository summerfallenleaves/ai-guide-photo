/**
 * 「AI 在我拍摄时做了什么」的记录。
 *
 * 用户把相机的控制权交给了代理:它会调参数、会自己按快门。
 * 那就必须能事后问清楚"刚才它动了什么"—— 这是知情权的最小实现。
 *
 * 纯函数,方便单测;记录本身只存在本地,不上传。
 */

export type Intervention = {
  at: number;
  kind: 'params' | 'auto-shot';
  /** 给人看的一句话,例如「ISO 800 · 1/125s」 */
  detail: string;
  /** 模型的理由(可选),例如「画面偏暗」 */
  reason?: string;
};

/** 一次会话最多记这么多条,防止长时间会话把内存/存储撑大 */
export const MAX_INTERVENTIONS = 20;

export function pushIntervention(list: Intervention[], next: Intervention): Intervention[] {
  return [...list, next].slice(-MAX_INTERVENTIONS);
}

export function countParams(list: Intervention[]): number {
  return list.filter((item) => item.kind === 'params').length;
}

export function countAutoShots(list: Intervention[]): number {
  return list.filter((item) => item.kind === 'auto-shot').length;
}

/**
 * 一句话总结,给复盘页 / 历史页用。
 *
 * 没有记录时返回 null —— 随手拍的照片不该显示"AI 什么也没做"这种废话。
 */
export function summarizeInterventions(list: Intervention[]): string | null {
  if (list.length === 0) return null;

  const params = countParams(list);
  const shots = countAutoShots(list);
  const parts: string[] = [];

  if (params > 0) parts.push(`AI 调过 ${params} 次参数`);
  if (shots > 0) parts.push('由 AI 自动按快门');

  return parts.length > 0 ? `拍摄时:${parts.join(' · ')}` : null;
}

/** 最近一次调参的说明(带理由),给卡片上那一行用 */
export function lastParamsNote(list: Intervention[]): string | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    if (item.kind !== 'params') continue;
    return item.reason ? `已自动调 ${item.detail}（${item.reason}）` : `已自动调 ${item.detail}`;
  }
  return null;
}
