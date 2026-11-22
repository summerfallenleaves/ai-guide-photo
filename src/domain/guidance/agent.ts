import type { Advice } from '@/domain/guidance/continuity';
import { SCENES } from '@/domain/guidance/scenes';
import { DIM_LABELS } from '@/domain/guidance/scoring';
import type { Dim, SceneId } from '@/domain/shared/types';

/**
 * 取景 Agent 的决策内核。
 *
 * 这是一个**纯状态机**:输入"当前状态 + 事件 + 护栏条件",输出"下一个状态 + 是否该按快门"。
 * 所有副作用(抓帧、调模型、真按快门)都在 `hooks/use-live-session.ts` 里,
 * 这里只做判断,所以可以完整单测。
 *
 * 为什么用状态机而不是"if 判断散在 hook 里":
 * 会话有明确的起止和互斥阶段(idle / observing),散着写很容易出现
 * "拍摄过程中又来一轮分析"这类状态错乱。
 *
 * **没有倒计时**:连续两轮 ready 就直接按快门。
 * 用户想要控制权时,关掉设置里的「自动拍摄」或结束会话即可 ——
 * 中间再塞一个 3 秒倒计时,既多一次点击,又让"AI 替我拍"这件事变得半吊子。
 */

export type Phase = 'idle' | 'observing';

export type SessionState = {
  phase: Phase;
  /** 连续几轮 readyToShoot */
  readyStreak: number;
  /** 本轮会话已分析的轮数 */
  rounds: number;
  /** 连续失败次数 */
  failures: number;
  /** 暂停(专业面板展开 / App 后台 / 连续失败) */
  paused: boolean;
  /** 当前的护栏条件(由页面/设置同步进来,状态机据此判断能不能拍) */
  guard: CaptureGuard;
};

/** 会话内保留的建议条数上限 */
export const MAX_ADVICE = 12;
/** 需要连续几轮"可以拍了"才允许拍摄 */
export const READY_STREAK_REQUIRED = 2;
/** 连续失败这么多次就暂停 */
export const MAX_FAILURES = 3;

export const INITIAL_STATE: SessionState = {
  phase: 'idle',
  readyStreak: 0,
  rounds: 0,
  failures: 0,
  paused: false,
  guard: { autoCapture: false, blocked: true },
};

export type SessionEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'ROUND_OK'; readyToShoot: boolean }
  | { type: 'ROUND_FAIL' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'GUARD'; autoCapture: boolean; blocked: boolean }
  /** 换了场景:标准变了,连续 ready 必须重新攒;历史不动 */
  | { type: 'RESET_READY' };

/** 决定"能不能真正按快门"的外部条件 */
export type CaptureGuard = {
  /** 设置里的「自动拍摄」开关 */
  autoCapture: boolean;
  /** 当前是否被别的事情占用:专业面板开着 / App 在后台 / 正在拍照 */
  blocked: boolean;
};

export type ReduceResult = {
  state: SessionState;
  /** true = 这一刻应该按快门(一次会话内可能多次:拍完用户继续开会话才有多张) */
  capture: boolean;
};

/** 允许自动拍摄的唯一判据(过了就立刻拍,不再等待) */
export function shouldArmCapture(state: SessionState, guard: CaptureGuard): boolean {
  return (
    state.phase === 'observing' &&
    !state.paused &&
    state.readyStreak >= READY_STREAK_REQUIRED &&
    guard.autoCapture &&
    !guard.blocked
  );
}

export function reduce(state: SessionState, event: SessionEvent): ReduceResult {
  switch (event.type) {
    case 'START':
      // 无条件重置会话数据:用户重新开启时必须清掉上一条残留建议。
      // 但 guard 是"环境条件"(开关/遮挡),不属于会话数据,必须原样保留。
      return {
        state: { ...INITIAL_STATE, phase: 'observing', guard: state.guard },
        capture: false,
      };

    case 'STOP':
      return { state: { ...INITIAL_STATE, guard: state.guard }, capture: false };

    case 'ROUND_FAIL': {
      if (state.phase !== 'observing') return { state, capture: false };
      const failures = state.failures + 1;
      return {
        state: {
          ...state,
          failures,
          // 没观察到画面,连续 ready 就断了
          readyStreak: 0,
          paused: failures >= MAX_FAILURES ? true : state.paused,
        },
        capture: false,
      };
    }

    case 'ROUND_OK': {
      if (state.phase !== 'observing') return { state, capture: false };

      const next: SessionState = {
        ...state,
        readyStreak: event.readyToShoot ? state.readyStreak + 1 : 0,
        rounds: state.rounds + 1,
        failures: 0,
      };

      if (shouldArmCapture(next, next.guard)) {
        // 立刻拍:streak 清零,避免拍摄流程还没走完又来一轮"可以拍了"重复触发
        return { state: { ...next, readyStreak: 0 }, capture: true };
      }
      return { state: next, capture: false };
    }

    case 'PAUSE':
      // 被遮挡(面板/后台)就暂停观察;连续 ready 必须重新攒
      return { state: { ...state, paused: true, readyStreak: 0 }, capture: false };

    case 'RESET_READY':
      return { state: { ...state, readyStreak: 0 }, capture: false };

    case 'GUARD':
      return {
        state: { ...state, guard: { autoCapture: event.autoCapture, blocked: event.blocked } },
        capture: false,
      };

    case 'RESUME':
      return { state: { ...state, paused: false, failures: 0 }, capture: false };

    default:
      return { state, capture: false };
  }
}

/** 把新建议追加进时间线,超过上限时丢最旧的 */
export function appendAdvice(list: Advice[], next: Advice, max = MAX_ADVICE): Advice[] {
  return [...list, next].slice(-max);
}

/** 会话是否正在进行(决定要不要显示卡片和跑定时器) */
export function isSessionActive(state: SessionState): boolean {
  return state.phase !== 'idle';
}

/**
 * 把会话内的建议时间线压成一段摘要,给复盘页的点评用。
 *
 * - 连续相同动作合并成一条,并标出重复次数
 * - 超过上限时保留开头 2 条 + 结尾 6 条(开头交代背景,结尾最接近成品)
 * - 没有建议时返回 null —— 随手拍也能进复盘,只是没有这段
 */
export function adviceDigest(advice: Advice[], max = 8): string | null {
  if (advice.length === 0) return null;

  type Line = { dim: string; action: string; repeat: number; scene?: SceneId };
  const merged: Line[] = [];
  for (const item of advice) {
    const last = merged[merged.length - 1];
    if (last && last.action === item.action && last.scene === item.scene) {
      last.repeat += 1;
    } else {
      merged.push({ dim: item.dim, action: item.action, repeat: 1, scene: item.scene });
    }
  }

  let picked = merged;
  if (merged.length > max) {
    picked = [...merged.slice(0, 2), ...merged.slice(-(max - 2))];
  }

  // 用户中途换过场景时插一行标记:
  // 否则复盘会拿"最终场景"的标准去评价另一个场景下给的建议
  const rows: string[] = [];
  let previousScene: SceneId | undefined;
  for (const line of picked) {
    if (line.scene !== previousScene) {
      if (previousScene !== undefined && line.scene) {
        const from = SCENES[previousScene]?.label ?? previousScene;
        const to = SCENES[line.scene]?.label ?? line.scene;
        rows.push(`—— 场景切换到「${to}」(之前是「${from}」)——`);
      }
      previousScene = line.scene;
    }
    const suffix = line.repeat > 1 ? `(同一建议第 ${line.repeat} 次)` : '';
    rows.push(`- [${DIM_LABELS[line.dim as Dim] ?? line.dim}] ${line.action}${suffix}`);
  }

  return `本次取景共 ${advice.length} 轮建议,用户按此取景后拍摄:\n${rows.join('\n')}`;
}
