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
export async function cropToAspect(
  uri: string,
  targetAspect: number,
  jpegRotation = 0,
): Promise<string> {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return uri;

  // 照片是横向存储的,靠 EXIF 方向标记让它竖着显示。
  // 真正的像素坐标是横向的,所以目标比例要反过来算。
  const rawTarget =
    jpegRotation % 180 === 0 ? targetAspect : 1 / targetAspect;

  // 渲染一次拿到像素尺寸(此时仍是存储方向)
  const base = await ImageManipulator.manipulate(uri).renderAsync();
  const width = base.width;
  const height = base.height;
  if (!width || !height) return uri;

  const currentAspect = width / height;
  if (Math.abs(currentAspect - rawTarget) < 0.005) {
    const same = await base.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
    return same.uri;
  }

  // 2. 按显示方向计算居中裁切区域
  let cropW = width;
  let cropH = height;
  if (currentAspect > rawTarget) {
    cropW = Math.round(height * rawTarget);
  } else {
    cropH = Math.round(width / rawTarget);
  }
  const originX = Math.max(0, Math.round((width - cropW) / 2));
  const originY = Math.max(0, Math.round((height - cropH) / 2));

  // 3. 在已摆正的图上裁切
  const cropped = await ImageManipulator.manipulate(base)
    .crop({ originX, originY, width: cropW, height: cropH })
    .renderAsync();
  const saved = await cropped.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return saved.uri;
}
