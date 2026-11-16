import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export type CameraPermissionState = {
  /** 已经完成过一次查询,避免首帧闪烁 */
  checked: boolean;
  granted: boolean;
  /** 被"永久拒绝"时只能去系统设置里开 */
  canAskAgain: boolean;
  request: () => Promise<boolean>;
  recheck: () => Promise<boolean>;
};

/**
 * 相机权限。用 RN 内置的 PermissionsAndroid,不再依赖 expo-camera。
 * (expo-camera 只是 CameraX 封装,相机本体已经换成自研 Camera2)
 */
export function useCameraPermission(): CameraPermissionState {
  const [checked, setChecked] = useState(false);
  const [granted, setGranted] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const recheck = useCallback(async () => {
    if (Platform.OS !== 'android') {
      // 目前只验证了 Android;iOS 走自研相机时再补
      setChecked(true);
      setGranted(true);
      return true;
    }
    const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    setGranted(ok);
    setChecked(true);
    return ok;
  }, []);

  const request = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const ok = result === PermissionsAndroid.RESULTS.GRANTED;
    setGranted(ok);
    setCanAskAgain(result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    setChecked(true);
    return ok;
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) void recheck();
    });
    return () => {
      cancelled = true;
    };
  }, [recheck]);

  return { checked, granted, canAskAgain, request, recheck };
}
