import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/**
 * DeepSeek 服务端最终会把图缩到约 1300×1300 的量级再推理。
 * 所以先在手机上缩到这个尺寸,模型看到的精度完全一样,
 * 但上传体积从 2~3MB 降到约 200KB。
 */
export const ANALYSIS_LONG_SIDE = 1280;
const ANALYSIS_QUALITY = 0.85;

/**
 * 前置摄像头拍到的照片做水平镜像。
 *
 * 为什么需要:前置预览本身是镜像的(像照镜子),而 JPEG 只带旋转、不带镜像,
 * 所以默认拍出来是"真实方向"。用户要求所见即所得 —— **照片必须和预览一致**,
 * 于是在这里把照片也镜像一次。
 *
 * 代价:拍文字(菜单 / 路牌 / 书页)时,照片里的字会是反的。
 * 这是"前置所见即所得"换来的,已知取舍。
 */
export async function mirrorForFront(uri: string, isFront: boolean): Promise<string> {
  if (!isFront) return uri;
  const flipped = await ImageManipulator.manipulate(uri)
    .flip(FlipType.Horizontal)
    .renderAsync();
  const saved = await flipped.saveAsync({ compress: 0.95, format: SaveFormat.JPEG });
  return saved.uri;
}

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
