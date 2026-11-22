import { Asset, requestPermissionsAsync } from 'expo-media-library';

export type SaveResult = { ok: boolean; error?: string; assetId?: string };

/**
 * 把文件存进系统相册。
 *
 * 两个坑:
 * 1. Android 13+ 写相册本来就不需要运行时权限,所以先直接写,失败才去申请。
 * 2. **Expo Go 在 Android 上不允许查询相册权限**——`getPermissionsAsync` / `usePermissions`
 *    会直接 reject 并抛未捕获异常。所以这里全程不调用它们。
 *    需要判断权限时只调 `requestPermissionsAsync`,还失败就当作没权限。
 */
export async function saveToAlbum(uri: string): Promise<SaveResult> {
  try {
    const asset = await Asset.create(uri);
    return { ok: true, assetId: asset?.id };
  } catch (directError) {
    try {
      const res = await requestPermissionsAsync(true);
      if (!res.granted) {
        return { ok: false, error: '相册权限被拒绝,请到系统设置里开启' };
      }
      const created = await Asset.create(uri);
      return { ok: true, assetId: created?.id };
    } catch (retryError) {
      return { ok: false, error: describe(retryError) || describe(directError) };
    }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? '');
}
