import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';

/**
 * 自研相机模块的 JS 门面。
 *
 * 原生实现在 `modules/camera2`(本地 Expo Module),这层负责:
 * - 给应用提供稳定的类型和方法名
 * - 模块不存在时优雅降级(Expo Go 里没有这个原生模块)
 *
 * ⚠️ 对外契约由 `__tests__/native-camera2.contract.test.ts` 保护:
 * 方法名、参数顺序、事件名、降级行为都不能随意改。
 */

const MODULE_NAME = 'Camera2Camera';

export type Camera2Facing = 'back' | 'front';

export type Camera2Caps = {
  isoMin: number;
  isoMax: number;
  exposureMinNs: number;
  exposureMaxNs: number;
  minFocusDistance: number;
};

export type Camera2CapsFull = Camera2Caps & {
  focalLengthMm?: number;
  aperture?: number;
  /** 最大数字变焦倍数 */
  maxZoom?: number;
  /** 预览缓冲的宽高比(宽/高),用于让取景框和照片对齐 */
  previewAspect?: number;
  /** 是否有闪光灯 */
  hasFlash?: boolean;
  /** 曝光补偿范围(EV 档) */
  evMin?: number;
  evMax?: number;
  evStep?: number;
  /** SENSOR_COLOR_TRANSFORM1(传感器 RGB→XYZ,行优先 9 个数) */
  colorTransform?: number[];
};

export type Camera2Params = {
  iso: number;
  exposureNs: number;
  focusDiopters: number;
  kelvin: number;
  manual: boolean;
  /** 相机 AWB 当场算出的补偿增益,标定白平衡时当参考 */
  awbR?: number;
  awbG?: number;
  awbB?: number;
  /** 传感器空间的中性色点(Android 10+) */
  neutralR?: number;
  neutralG?: number;
  neutralB?: number;
};

type Subscription = { remove: () => void };

type Camera2NativeModule = {
  takePicture(): Promise<{ path: string; rotation: number }>;
  grabPreview(targetWidth: number, quality: number): Promise<string>;
  setManual(
    iso: number | null,
    exposureNs: number | null,
    focusDiopters: number | null,
    kelvin: number | null,
  ): void;
  setZoom(ratio: number): void;
  setPreviewFill(ratio: number): void;
  setFlashMode(mode: string): void;
  setExposureCompensation(steps: number): void;
  focusAt(x: number, y: number): void;
  getCapabilities(): Promise<Camera2CapsFull>;
  addListener(eventName: string, listener: (payload: unknown) => void): Subscription;
};

const native = requireOptionalNativeModule<Camera2NativeModule>(MODULE_NAME);

export type Camera2PreviewProps = {
  style?: unknown;
  facing?: Camera2Facing;
  /** 预览填充比例:0 = 完整显示留黑边,1 = 铺满裁切 */
  previewFill?: number;
};

/** 原生预览视图(需要本地构建的 APK,Expo Go 里不存在) */
export const Camera2Preview: ComponentType<Camera2PreviewProps> =
  requireNativeView<Camera2PreviewProps>(MODULE_NAME);

export function isNativeCameraAvailable(): boolean {
  return !!native;
}

/** 拍一张,返回文件路径(不带 file:// 前缀)与 JPEG 方向角 */
export async function takePicture(): Promise<{ path: string; rotation: number }> {
  if (!native) throw new Error('当前环境没有原生相机模块');
  return native.takePicture();
}

/** 抓当前预览帧,返回 JPEG base64(不带 data: 前缀) */
export async function grabPreview(targetWidth = 1024, quality = 60): Promise<string> {
  if (!native) throw new Error('当前环境没有原生相机模块');
  return native.grabPreview(targetWidth, quality);
}

/** 设置手动参数;某个轴传 null 表示回到自动 */
export function setManual(params: Partial<{
  iso: number | null;
  exposureNs: number | null;
  focusDiopters: number | null;
  kelvin: number | null;
}>): void {
  native?.setManual(
    params.iso ?? null,
    params.exposureNs ?? null,
    params.focusDiopters ?? null,
    params.kelvin ?? null,
  );
}

/** 预览填充比例:0 = 完整显示(留黑边),1 = 铺满(裁切) */
export function setPreviewFill(ratio: number): void {
  native?.setPreviewFill(ratio);
}

/** 变焦倍数;设备不支持时静默忽略 */
export function setZoom(ratio: number): void {
  native?.setZoom(ratio);
}

export type FlashMode = 'off' | 'auto' | 'torch';

/** 闪光灯:关 / 自动 / 常亮 */
export function setFlashMode(mode: FlashMode): void {
  native?.setFlashMode(mode);
}

/** 曝光补偿,单位是 EV 档(不是 EV 值) */
export function setExposureCompensation(steps: number): void {
  native?.setExposureCompensation(steps);
}

/** 点按对焦:x/y 为预览画面里的归一化坐标(0~1) */
export function focusAt(x: number, y: number): void {
  native?.focusAt(x, y);
}

export async function getCapabilities(): Promise<Camera2CapsFull | null> {
  if (!native) return null;
  return native.getCapabilities();
}

export function addParamsListener(cb: (p: Camera2Params) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onParams', (payload) => cb(payload as Camera2Params));
  return () => sub.remove();
}

export function addErrorListener(cb: (message: string) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onError', (payload) => {
    const message = (payload as { message?: string } | undefined)?.message;
    cb(message ?? '相机出错了');
  });
  return () => sub.remove();
}

/** 音量键按下(当作快门) */
export function addVolumeKeyListener(cb: () => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onVolumeKey', () => cb());
  return () => sub.remove();
}

export function addReadyListener(cb: () => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onReady', () => cb());
  return () => sub.remove();
}

/** "1/250" 或 "0.5" → 纳秒;解析不出来返回 undefined */
export function parseShutterToNs(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace('s', '');
  const frac = t.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const v = Number(frac[1]) / Number(frac[2]);
    return Number.isFinite(v) && v > 0 ? v * 1e9 : undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n * 1e9 : undefined;
}

export function formatShutterNs(ns: number): string {
  if (!ns || ns <= 0) return '—';
  const s = ns / 1e9;
  if (s >= 1) return `${Number(s.toFixed(1))}s`;
  return `1/${Math.round(1 / s)}`;
}
