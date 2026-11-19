import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * DeepSeek 服务端最终会把图缩到约 1300×1300 的量级再推理。
 * 所以先在手机上缩到这个尺寸,模型看到的精度完全一样,
 * 但上传体积从 2~3MB 降到约 200KB。
 */
export const ANALYSIS_LONG_SIDE = 1280;
const ANALYSIS_QUALITY = 0.85;

/**
 * 生成"只用于送模型分析"的 base64。
 *
 * 注意:这是一份**独立的临时文件**,不会覆盖相册里的原图,
 * 也不会替换复盘页显示的那张。
 */
export async function toAnalysisBase64(uri: string, width: number, height: number): Promise<string> {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const longSide = Math.max(w, h);

  const context = ImageManipulator.manipulate(uri);

  if (longSide > 0 && longSide > ANALYSIS_LONG_SIDE) {
    if (w >= h) context.resize({ width: ANALYSIS_LONG_SIDE });
    else context.resize({ height: ANALYSIS_LONG_SIDE });
  } else if (longSide === 0) {
    // 拿不到尺寸时按宽度兜底
    context.resize({ width: ANALYSIS_LONG_SIDE });
  }

  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: ANALYSIS_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });

  if (!result.base64) throw new Error('缩图失败,没拿到 base64');
  return result.base64;
}

/**
 * 按目标宽高比居中裁切照片。
 *
 * ⚠️ 关键:不能直接对原始文件裁切。相机写出的 JPEG 是横向的,
 * 靠 EXIF 方向标记让它"竖着显示"。直接裁会按横向坐标切,转过来之后
 * 就变成了"上下被裁掉"。
 *
 * 做法:先 renderAsync 一次 —— 这一步会把 EXIF 方向烘焙进像素,
 * 拿到的宽高就是屏幕上看到的方向;然后在这张图上裁。
 *
 * @param targetAspect 宽 / 高(按**显示方向**算)
 */

/** 裁切框(以显示方向为准)。null 表示比例已经一致,不需要裁 */
export type CropBox = { originX: number; originY: number; width: number; height: number };

/**
 * 算出把 width×height 裁成 targetAspect 的居中裁切框。
 *
 * 抽成纯函数是为了能单测:这条公式踩过一次坑 —— 传进来的是**已摆正**的尺寸,
 * 却又按"横向存储"反算了一次比例,结果把竖图裁成了一条横带(上下全没了)。
 *
 * @param width  已摆正后的像素宽
 * @param height 已摆正后的像素高
 * @param targetAspect 期望的宽 / 高
 */
export function computeCropBox(
  width: number,
  height: number,
  targetAspect: number,
): CropBox | null {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return null;
  if (!width || !height || width <= 0 || height <= 0) return null;

  const current = width / height;
  // 差得太小就不裁,省一次重编码
  if (Math.abs(current - targetAspect) < 0.005) return null;

  let cropW = width;
  let cropH = height;
  if (current > targetAspect) {
    // 太宽:砍左右
    cropW = Math.round(height * targetAspect);
  } else {
    // 太高:砍上下
    cropH = Math.round(width / targetAspect);
  }
  return {
    originX: Math.max(0, Math.round((width - cropW) / 2)),
    originY: Math.max(0, Math.round((height - cropH) / 2)),
    width: cropW,
    height: cropH,
  };
}

export async function cropToAspect(uri: string, targetAspect: number): Promise<string> {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return uri;

  // renderAsync 会把 EXIF 方向烘焙进像素:拿到的宽高就是屏幕上看到的方向,
  // 之后所有裁切都在这个坐标系里算,不需要再按存储方向换算。
  const base = await ImageManipulator.manipulate(uri).renderAsync();
  const box = computeCropBox(base.width, base.height, targetAspect);
  if (!box) {
    const same = await base.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
    return same.uri;
  }

  const cropped = await ImageManipulator.manipulate(base)
    .crop(box)
    .renderAsync();
  const saved = await cropped.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return saved.uri;
}
