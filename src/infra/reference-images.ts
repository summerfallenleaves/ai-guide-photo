import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { getSceneReferences } from '@/domain/guidance/scene-refs';

/**
 * 把打包进 APK 的参考图片读成 base64。
 *
 * 只在拍后点评时用(取景每 3 秒一轮,带图太贵),所以延迟不是问题;
 * 但仍然做内存缓存 —— 同一场景反复拍照不该反复解码。
 */

const cache = new Map<number, string>();

async function loadOne(moduleId: number): Promise<string | null> {
  const cached = cache.get(moduleId);
  if (cached) return cached;

  try {
    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) return null;
    const file = new File(uri);
    if (!file.exists) return null;
    const base64 = await file.base64();
    if (!base64) return null;
    cache.set(moduleId, base64);
    return base64;
  } catch {
    // 参考图读不出来不该影响点评:退化成"没有参考图"继续跑
    return null;
  }
}

export type LoadedReference = { base64: string; caption: string };

/** 取出某个场景的参考图;读失败的条目直接跳过 */
export async function loadSceneReferences(scene: string): Promise<LoadedReference[]> {
  const refs = getSceneReferences(scene as never);
  if (refs.length === 0) return [];

  const loaded = await Promise.all(
    refs.map(async (ref) => ({ base64: await loadOne(ref.asset), caption: ref.caption })),
  );
  return loaded.filter((item): item is LoadedReference => !!item.base64);
}

/** 测试用:清掉缓存 */
export function __clearReferenceCache() {
  cache.clear();
}
