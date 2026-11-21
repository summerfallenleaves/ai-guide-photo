import { parseShutterToNs } from '@/infra/camera/native-camera2';
import type { AdjustParams, CameraParamsSnapshot } from '@/domain/shared/types';

/**
 * 「Agent 直接调相机参数」的护栏。
 *
 * 原来模型只能说"把 ISO 调低一点",用户得自己去专业面板拨;
 * 现在模型可以直接给参数,应用立即下发 —— 但这把快门之外的控制权交出去了,
 * 所以所有判断都放在这个纯函数模块里,可以单测:
 *
 * - 夹到硬件范围(超出范围的值不报错,直接夹)
 * - 手动曝光必须 ISO + 快门成对,只给一个就整体丢弃
 * - 变化太小就不下发(避免每轮来回抖)
 * - 用户手动接管后,本次会话不再抢
 * - 两次下发之间要有间隔
 */

export type ParamLimits = {
  isoMin: number;
  isoMax: number;
  exposureMinNs: number;
  exposureMaxNs: number;
};

/** 相机当前的参数快照(定义在 shared,相机侧也能引用) */
export type ParamSnapshot = CameraParamsSnapshot;

/** 两次自动调参之间的最小间隔:比分析间隔长,等于最多隔一轮调一次 */
export const MIN_APPLY_GAP_MS = 4000;

/** 变化小于这些阈值就不下发(约 1/3 档曝光) */
const ISO_STEP_RATIO = 1.26;
const SHUTTER_STEP_RATIO = 1.26;
const KELVIN_STEP = 250;
const DIOPTER_STEP = 0.15;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 把模型给的参数归一化并夹到硬件范围。
 *
 * 返回 null 表示"这一组参数不能用":
 * - 空对象
 * - 手动曝光只给了一半(ISO 或快门缺一个)
 * - 所有值都解析失败
 */
export function normalizeAgentParams(
  patch: AdjustParams | null | undefined,
  limits: ParamLimits | null,
): AdjustParams | null {
  if (!patch) return null;

  const out: AdjustParams = {};

  const iso = typeof patch.iso === 'number' && Number.isFinite(patch.iso) ? Math.round(patch.iso) : undefined;
  const shutterNs = patch.shutter ? parseShutterToNs(patch.shutter) : undefined;

  // 手动曝光必须成对:只有一半时整体丢弃,避免相机退回自动(见相机章节的约定)
  const wantsExposure = iso != null || shutterNs != null;
  if (wantsExposure) {
    if (iso == null || shutterNs == null) return null;
    out.iso = limits ? clampNumber(iso, limits.isoMin, limits.isoMax) : iso;
    const ns = limits ? clampNumber(shutterNs, limits.exposureMinNs, limits.exposureMaxNs) : shutterNs;
    out.shutter = ns >= 1e9 ? `${Number((ns / 1e9).toFixed(2))}` : `1/${Math.round(1e9 / ns)}`;
  }

  if (typeof patch.wb === 'number' && Number.isFinite(patch.wb)) {
    // 相机支持的范围大致是 2000~8000K,这里再夹一层保守范围
    out.wb = Math.round(clampNumber(patch.wb, 2500, 8000));
  }

  if (typeof patch.focusMeters === 'number' && Number.isFinite(patch.focusMeters) && patch.focusMeters > 0) {
    out.focusMeters = Number(clampNumber(patch.focusMeters, 0.1, 20).toFixed(2));
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** 这次参数相对当前状态是否"值得下发" —— 太小的变化直接跳过,防止来回抖 */
export function isMeaningfulChange(next: AdjustParams, current: ParamSnapshot): boolean {
  if (!current) return true;

  if (next.iso != null) {
    const cur = current.manual ? current.iso : 0;
    // 自动模式下没有基准值,直接算"值得调"
    if (!cur) return true;
    if (Math.abs(next.iso / cur - 1) >= ISO_STEP_RATIO - 1) return true;
  }

  if (next.shutter) {
    const ns = parseShutterToNs(next.shutter);
    const cur = current.manual ? current.exposureNs : 0;
    if (ns && !cur) return true;
    if (ns && cur && Math.abs(ns / cur - 1) >= SHUTTER_STEP_RATIO - 1) return true;
  }

  if (next.wb != null) {
    const cur = current.kelvin;
    if (!cur) return true;
    if (Math.abs(next.wb - cur) >= KELVIN_STEP) return true;
  }

  if (next.focusMeters != null) {
    const nextDiopter = 1 / next.focusMeters;
    const cur = current.focusDiopters;
    if (!cur) return true;
    if (Math.abs(nextDiopter - cur) >= DIOPTER_STEP) return true;
  }

  // 能走到这里说明给的都是变化太小的量,不值得下发
  return false;
}

export type ApplyReason =
  | 'ok'
  | 'disabled'
  | 'busy'
  | 'user-takeover'
  | 'no-params'
  | 'too-soon'
  | 'no-change';

export type ApplyDecision = { apply: boolean; reason: ApplyReason };

export type ApplyInput = {
  /** 设置里的「AI 调参」开关 */
  enabled: boolean;
  /** 正在拍照 / 相机没就绪 */
  busy: boolean;
  /** 用户在本轮会话里手动拨过参数 → 交出控制权,不再自动调 */
  userTakeover: boolean;
  now: number;
  lastAppliedAt: number;
  /** 已经是归一化后的参数;传 null 表示这轮没给或不可用 */
  params: AdjustParams | null;
  current: ParamSnapshot;
};

/**
 * 是否应该把这一组参数真的下发给相机。
 *
 * 顺序有讲究:先排除"根本不该动"的情况(关掉 / 忙着 / 用户接管 / 太频繁),
 * 再看参数本身有没有意义 —— 这样日志里能看出是哪个原因跳过的。
 */
export function decideAgentParams(input: ApplyInput): ApplyDecision {
  if (!input.enabled) return { apply: false, reason: 'disabled' };
  if (input.busy) return { apply: false, reason: 'busy' };
  if (input.userTakeover) return { apply: false, reason: 'user-takeover' };
  if (!input.params) return { apply: false, reason: 'no-params' };
  if (input.lastAppliedAt > 0 && input.now - input.lastAppliedAt < MIN_APPLY_GAP_MS) {
    return { apply: false, reason: 'too-soon' };
  }
  if (!isMeaningfulChange(input.params, input.current)) {
    return { apply: false, reason: 'no-change' };
  }
  return { apply: true, reason: 'ok' };
}

/** 给卡片显示的一句话,例如「已自动调 ISO 400 · 1/125s」 */
export function describeApplied(params: AdjustParams): string {
  const parts: string[] = [];
  if (params.iso != null) parts.push(`ISO ${params.iso}`);
  if (params.shutter) parts.push(params.shutter.includes('/') ? `${params.shutter}s` : `${params.shutter}s`);
  if (params.wb != null) parts.push(`${params.wb}K`);
  if (params.focusMeters != null) parts.push(`对焦 ${params.focusMeters}m`);
  return parts.length > 0 ? `已自动调 ${parts.join(' · ')}` : '已自动调整参数';
}
