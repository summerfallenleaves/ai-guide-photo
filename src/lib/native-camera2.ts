import {
  DeviceEventEmitter,
  NativeModules,
  requireNativeComponent,
  type ViewProps,
} from 'react-native';

export type Camera2Facing = 'back' | 'front';

type Camera2PreviewProps = ViewProps & {
  facing?: Camera2Facing;
};

/** 原生 Camera2 预览视图(需要本地构建的 APK,Expo Go 里不存在) */
export const Camera2Preview = requireNativeComponent<Camera2PreviewProps>('Camera2Preview');

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

export type TransformInfo = {
  viewW: number;
  viewH: number;
  bufferW: number;
  bufferH: number;
  layoutW: number;
  layoutH: number;
  textureRotation: number;
  scale: number;
  displayRotation: number;
  /** SurfaceTexture 变换矩阵的旋转部分 */
  m0: number;
  m1: number;
  m4: number;
  m5: number;
  deviceOrientation: number;
};

type Camera2ModuleType = {
  takePicture(): Promise<string>;
  getTransformInfo(): Promise<TransformInfo>;
  grabPreview(targetWidth: number, quality: number): Promise<string>;
  setManual(
    iso: number | null,
    exposureNs: number | null,
    focusDiopters: number | null,
    kelvin: number | null,
  ): void;
  getCapabilities(): Promise<Camera2Caps>;
};

const native = (NativeModules as Record<string, Camera2ModuleType | undefined>).Camera2Module;

export function isNativeCameraAvailable(): boolean {
  return !!native;
}

/** 拍一张,返回本地文件路径(不带 file:// 前缀) */
export async function takePicture(): Promise<string> {
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

export async function getTransformInfo(): Promise<TransformInfo | null> {
  if (!native) return null;
  return native.getTransformInfo();
}

export async function getCapabilities(): Promise<Camera2CapsFull | null> {
  if (!native) return null;
  return (await native.getCapabilities()) as Camera2CapsFull;
}

export function addParamsListener(cb: (p: Camera2Params) => void): () => void {
  const sub = DeviceEventEmitter.addListener('Camera2Params', cb);
  return () => sub.remove();
}

export function addErrorListener(cb: (message: string) => void): () => void {
  const sub = DeviceEventEmitter.addListener('Camera2Error', cb);
  return () => sub.remove();
}

export function addReadyListener(cb: () => void): () => void {
  const sub = DeviceEventEmitter.addListener('Camera2Ready', cb);
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
