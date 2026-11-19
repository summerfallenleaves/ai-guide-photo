import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProSelection } from '@/components/pro-camera-panel';
import type { PhotoMeta } from '@/lib/exif';
import {
  addErrorListener,
  addParamsListener,
  addReadyListener,
  addVolumeKeyListener,
  formatShutterNs,
  getCapabilities,
  grabPreview,
  parseShutterToNs,
  setExposureCompensation,
  setFlashMode,
  setManual,
  type Camera2CapsFull,
  type Camera2Params,
  type FlashMode,
} from '@/lib/native-camera2';
import type { AdjustParams } from '@/lib/types';

/** 抓帧失败的重试次数:相机刚恢复的前几百毫秒可能还没有画面 */
const GRAB_ATTEMPTS = 3;
const GRAB_RETRY_MS = 250;
/** "已应用参数"提示的显示时长 */
const NOTE_MS = 4000;

export type CameraSessionDeps = {
  /** 是否把光学参数拼进 prompt(设置项) */
  paramAdvice: boolean;
  /** App 是否在前台 —— 后台的相机断开不是真故障 */
  isAppActive: () => boolean;
  /** 相机报错,与 AI 错误共用一个提示位置 */
  onError: (message: string) => void;
  /** 相机就绪:上层可借此清掉旧错误 */
  onReady: () => void;
  /** 音量键被当作快门按下 */
  onShutterKey: () => void;
};

export type CameraSession = {
  ready: boolean;
  caps: Camera2CapsFull | null;
  liveParams: Camera2Params | null;
  flashMode: FlashMode;
  /** 最近一次"已应用参数"的提示,几秒后自动消失 */
  appliedNote: string | null;
  /** 抓一帧预览(base64),内部已重试 */
  grab: () => Promise<string>;
  /** 拼成送模型的光学参数;参数建议关闭时返回 null */
  meta: () => PhotoMeta | null;
  /** 立刻下发(相机没就绪也照发,由原生自己忽略) */
  applyAdjust: (adj: AdjustParams) => void;
  /** 排队:等相机就绪后再下发(从复盘页带参数回来时用) */
  queueAdjust: (adj: AdjustParams) => void;
  /** 专业面板的每一档立即生效 */
  applyProSelection: (selection: ProSelection) => void;
  /** 闪光灯三态循环 */
  cycleFlash: () => void;
  /** 离开页面时清掉就绪状态 */
  markNotReady: () => void;
};

/**
 * 相机会话:订阅原生事件、缓存能力、下发参数。
 *
 * 这是 JS 与原生之间的唯一通道。之前这部分散在相机页里,页面直接调
 * `grabPreview` / `addReadyListener` / `setManual` —— "界面层不碰原生"就是假的。
 * 抽出来之后:界面层只认识 session 的方法;订阅与释放成对出现在同一处,不会漏。
 */
export function useCameraSession(deps: CameraSessionDeps): CameraSession {
  const [ready, setReady] = useState(false);
  const [caps, setCaps] = useState<Camera2CapsFull | null>(null);
  const [liveParams, setLiveParams] = useState<Camera2Params | null>(null);
  const [flashMode, setFlashModeState] = useState<FlashMode>('off');
  const [appliedNote, setAppliedNote] = useState<string | null>(null);

  const paramsRef = useRef<Camera2Params | null>(null);
  const capsRef = useRef<Camera2CapsFull | null>(null);
  /** 从复盘页带回来、等相机就绪后才应用的参数 */
  const pendingAdjustRef = useRef<AdjustParams | null>(null);

  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  }, [deps]);

  /** 把参数合并进当前状态并下发,同时给一句提示 */
  const applyAdjust = useCallback((adj: AdjustParams) => {
    const cur = paramsRef.current;
    const cap = capsRef.current;
    const wantsExposure = adj.iso != null || !!adj.shutter;

    let iso: number | null;
    let exposureNs: number | null;
    if (wantsExposure) {
      iso = adj.iso ?? (cur?.manual ? cur.iso : null);
      exposureNs = adj.shutter
        ? (parseShutterToNs(adj.shutter) ?? null)
        : cur?.manual
          ? cur.exposureNs
          : null;
      // 手动曝光要求 ISO 与快门同时有值,缺一个就整体退回自动
      if (iso == null || exposureNs == null) {
        iso = null;
        exposureNs = null;
      }
    } else if (cur?.manual) {
      iso = cur.iso;
      exposureNs = cur.exposureNs;
    } else {
      iso = null;
      exposureNs = null;
    }

    if (cap) {
      if (iso != null) iso = Math.min(cap.isoMax, Math.max(cap.isoMin, iso));
      if (exposureNs != null) {
        exposureNs = Math.min(cap.exposureMaxNs, Math.max(cap.exposureMinNs, exposureNs));
      }
    }

    const kelvin = adj.wb ?? (cur?.kelvin ? cur.kelvin : null);
    const focusDiopters = adj.focusMeters ? 1 / adj.focusMeters : cur?.focusDiopters || null;

    setManual({ iso, exposureNs, kelvin, focusDiopters });

    const parts: string[] = [];
    if (iso) parts.push(`ISO ${iso}`);
    if (exposureNs) parts.push(formatShutterNs(exposureNs));
    if (kelvin) parts.push(`${kelvin}K`);
    setAppliedNote(parts.length ? `已应用 ${parts.join(' · ')}` : '已应用建议参数');
  }, []);

  const queueAdjust = useCallback((adj: AdjustParams) => {
    pendingAdjustRef.current = adj;
  }, []);

  /** 专业面板:每一档立即生效 */
  const applyProSelection = useCallback((selection: ProSelection) => {
    setExposureCompensation(selection.ev ?? 0);

    // 手动曝光要求 ISO 与快门同时有值;只选了一个就用当前实测值补齐
    let iso = selection.iso;
    let shutterNs = selection.shutterNs;
    if (iso != null && shutterNs == null) {
      shutterNs = Math.round(paramsRef.current?.exposureNs ?? 0) || null;
    }
    if (shutterNs != null && iso == null) {
      iso = paramsRef.current?.iso ?? null;
    }

    setManual({
      iso,
      exposureNs: shutterNs,
      focusDiopters: selection.focusDiopters,
      kelvin: selection.kelvin,
    });
  }, []);

  const cycleFlash = useCallback(() => {
    setFlashModeState((prev) => {
      const next: FlashMode = prev === 'off' ? 'auto' : prev === 'auto' ? 'torch' : 'off';
      setFlashMode(next);
      return next;
    });
  }, []);

  /** 抓帧:相机刚恢复时纹理可能还没第一帧,重试几次再判失败 */
  const grab = useCallback(async (): Promise<string> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < GRAB_ATTEMPTS; attempt += 1) {
      try {
        return await grabPreview(1024, 60);
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, GRAB_RETRY_MS));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('抓帧失败');
  }, []);

  /** 把原生回报的参数拼成送模型的 meta */
  const meta = useCallback((): PhotoMeta | null => {
    if (!depsRef.current.paramAdvice) return null;
    const p = paramsRef.current;
    const cap = capsRef.current;
    if (!p && !cap) return null;
    return {
      iso: p?.iso && p.iso > 0 ? p.iso : undefined,
      exposureTime: p?.exposureNs ? p.exposureNs / 1e9 : undefined,
      fNumber: cap?.aperture && cap.aperture > 0 ? cap.aperture : undefined,
      focalLength: cap?.focalLengthMm && cap.focalLengthMm > 0 ? cap.focalLengthMm : undefined,
    };
  }, []);

  const markNotReady = useCallback(() => setReady(false), []);

  // 订阅原生事件:就绪 / 实时参数 / 相机错误
  useEffect(() => {
    const offReady = addReadyListener(() => {
      setReady(true);
      depsRef.current.onReady();
      const pending = pendingAdjustRef.current;
      if (pending) {
        pendingAdjustRef.current = null;
        applyAdjust(pending);
      }
      void getCapabilities().then((result) => {
        if (result) {
          capsRef.current = result;
          setCaps(result);
        }
      });
    });
    const offParams = addParamsListener((p) => {
      paramsRef.current = p;
      setLiveParams(p);
    });
    const offError = addErrorListener((msg) => {
      // 后台期间相机被系统断开是正常现象,不要留成红字
      if (depsRef.current.isAppActive()) depsRef.current.onError(msg);
    });
    return () => {
      offReady();
      offParams();
      offError();
    };
  }, [applyAdjust]);

  // 音量键当快门
  useEffect(() => addVolumeKeyListener(() => depsRef.current.onShutterKey()), []);

  // "已应用参数"提示几秒后自动消失
  useEffect(() => {
    if (!appliedNote) return;
    const timer = setTimeout(() => setAppliedNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [appliedNote]);

  return {
    ready,
    caps,
    liveParams,
    flashMode,
    appliedNote,
    grab,
    meta,
    applyAdjust,
    queueAdjust,
    applyProSelection,
    cycleFlash,
    markNotReady,
  };
}
