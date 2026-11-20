package com.aiguide.photograph.camera

/**
 * 相机相关的纯计算。
 *
 * 单独抽出来是为了能写 JVM 单元测试 —— 这几条公式是**实测反复试出来的**,
 * 重构相机模块时必须保证行为不变。
 */
object CameraMath {

  /**
   * 照片的 JPEG 方向(顺时针旋转角度)。
   *
   * 注意:这台设备的方向传感器返回值和直觉相反 —— 手机逆时针转 90° 时上报 270°,
   * 所以后置用加法。实测:竖拍 90°、横拍 0°。
   */
  fun jpegRotation(sensorOrientation: Int, deviceDegrees: Int, isFront: Boolean): Int {
    val normalized = ((deviceDegrees % 360) + 360) % 360
    return if (isFront) {
      ((sensorOrientation - normalized) % 360 + 360) % 360
    } else {
      (sensorOrientation + normalized) % 360
    }
  }

  /** 把宽高归一成 ≤1 的比例,竖看横看都可比 */
  fun ratioOf(width: Int, height: Int): Float {
    if (width <= 0 || height <= 0) return 1f
    val lo = minOf(width, height).toFloat()
    val hi = maxOf(width, height).toFloat()
    return lo / hi
  }

  /**
   * 在候选尺寸里挑长宽比最接近目标的那个。
   * 相机返回的尺寸列表都是横向的(宽 > 高),ratioOf 会把方向抹平。
   */
  fun closestAspect(
    targetWidth: Int,
    targetHeight: Int,
    candidates: List<Pair<Int, Int>>,
  ): Pair<Int, Int>? {
    if (candidates.isEmpty()) return null
    val target = ratioOf(targetWidth, targetHeight)
    return candidates.minByOrNull { candidate ->
      kotlin.math.abs(ratioOf(candidate.first, candidate.second) - target)
    }
  }

  /** 传感器坐标系里的一块裁切区域 */
  data class CropRegion(val left: Int, val top: Int, val width: Int, val height: Int)

  /**
   * 按传感器原生比例挑**拍照流**尺寸。
   *
   * 为什么必须按原生比例:请求 20:9 这类非原生比例的流时,"从 4:3 里裁哪块"
   * 由 HAL 决定,各厂实现不同 —— 实测某机型预览与照片取景差 1.33 倍。
   * 用原生比例,两条流都不需要 HAL 做比例变换,取景必然一致。
   *
   * 同比例里取像素最多的(画质优先)。没有同比例的就退到最接近的。
   */
  fun captureFor(
    activeWidth: Int,
    activeHeight: Int,
    candidates: List<Pair<Int, Int>>,
  ): Pair<Int, Int>? {
    if (candidates.isEmpty()) return null
    val target = ratioOf(activeWidth, activeHeight)
    val best = candidates.minByOrNull {
      kotlin.math.abs(ratioOf(it.first, it.second) - target)
    } ?: return null
    val bestRatio = ratioOf(best.first, best.second)
    return candidates
      .filter { kotlin.math.abs(ratioOf(it.first, it.second) - bestRatio) < 0.01f }
      .maxByOrNull { it.first.toLong() * it.second }
      ?: best
  }

  /**
   * 变焦对应的裁切区域。
   *
   * 比例**始终等于 activeArray**,只缩尺寸 —— 不做任何比例变换。
   * 1x 时就是整块传感器;非法 zoom 一律当 1x 处理,保证永远有画面。
   */
  fun zoomCrop(activeWidth: Int, activeHeight: Int, zoomRatio: Float): CropRegion {
    val zoom = if (zoomRatio.isFinite() && zoomRatio > 1f) zoomRatio else 1f
    val w = (activeWidth / zoom).toInt().coerceIn(1, activeWidth)
    val h = (activeHeight / zoom).toInt().coerceIn(1, activeHeight)
    return CropRegion(
      left = (activeWidth - w) / 2,
      top = (activeHeight - h) / 2,
      width = w,
      height = h,
    )
  }

  /** 在候选里挑长宽比和给定尺寸最接近、且宽度不超过上限的最大者 */
  fun previewFor(
    captureWidth: Int,
    captureHeight: Int,
    candidates: List<Pair<Int, Int>>,
    maxWidth: Int = 1920,
  ): Pair<Int, Int>? {
    if (candidates.isEmpty()) return null
    val target = ratioOf(captureWidth, captureHeight)
    val sameRatio = candidates.filter {
      kotlin.math.abs(ratioOf(it.first, it.second) - target) < 0.01f
    }
    val pool = sameRatio.ifEmpty { candidates }
    return pool.filter { it.first <= maxWidth }.maxByOrNull { it.first }
      ?: pool.minByOrNull { it.first }
  }
}
