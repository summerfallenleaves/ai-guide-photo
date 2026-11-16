import { NativeModules } from 'react-native';

export type CameraCapability = {
  id: string;
  lensFacing?: number;
  hardwareLevel?: string;
  manualSensor?: boolean;
  manualPostProcessing?: boolean;
  manualFocus?: boolean;
  manualWhiteBalance?: boolean;
  manualExposureMode?: boolean;
  isoMin?: number;
  isoMax?: number;
  exposureMinNs?: number;
  exposureMaxNs?: number;
  aperture?: number;
  focalLengthMm?: number;
  sensorWidthMm?: number;
  sensorHeightMm?: number;
};

type ProbeModule = {
  getCapabilities(): Promise<CameraCapability[]>;
};

const native = (NativeModules as Record<string, ProbeModule | undefined>).CameraProbe;

/** Expo Go 里这个原生模块不存在,返回 null */
export function isProbeAvailable(): boolean {
  return !!native;
}

export async function probeCameras(): Promise<CameraCapability[]> {
  if (!native) throw new Error('当前运行环境没有相机探测模块(Expo Go 里不可用)');
  return native.getCapabilities();
}

export function formatShutter(ns?: number): string {
  if (!ns || ns <= 0) return '—';
  const seconds = ns / 1e9;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}s`;
}

/** 后置主摄(通常是第一颗 back 相机) */
export function mainBackCamera(list: CameraCapability[]): CameraCapability | undefined {
  return list.find((c) => c.lensFacing === 1);
}
