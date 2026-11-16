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

export type Camera2Params = {
  iso: number;
  exposureNs: number;
  focusDiopters: number;
  kelvin: number;
  manual: boolean;
};

type Camera2ModuleType = {
  takePicture(): Promise<string>;
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

export async function getCapabilities(): Promise<Camera2Caps | null> {
  if (!native) return null;
  return native.getCapabilities();
}

export function addParamsListener(cb: (p: Camera2Params) => void): () => void {
  const sub = DeviceEventEmitter.addListener('Camera2Params', cb);
  return () => sub.remove();
}

export function formatShutterNs(ns: number): string {
  if (!ns || ns <= 0) return '—';
  const s = ns / 1e9;
  if (s >= 1) return `${Number(s.toFixed(1))}s`;
  return `1/${Math.round(1 / s)}`;
}
