package com.aiguide.photograph.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 方向公式的回归测试。
 *
 * 这两个用例是**真机实测出来的基准**,改公式必须让它们继续通过。
 */
class CameraMathTest {

  @Test
  fun `后置 竖拍时旋转 90 度`() {
    // 竖着拿,设备角度 0 → 照片写 90
    assertEquals(90, CameraMath.jpegRotation(sensorOrientation = 90, deviceDegrees = 0, isFront = false))
  }

  @Test
  fun `后置 逆时针横拍时旋转 0 度`() {
    // 实测:手机逆时针横过来,传感器上报 270 → 照片不需要旋转
    assertEquals(0, CameraMath.jpegRotation(sensorOrientation = 90, deviceDegrees = 270, isFront = false))
  }

  @Test
  fun `后置 倒置时旋转 180 度`() {
    assertEquals(180, CameraMath.jpegRotation(sensorOrientation = 90, deviceDegrees = 90, isFront = false))
  }

  @Test
  fun `前置 方向与后置相反`() {
    assertEquals(90, CameraMath.jpegRotation(sensorOrientation = 90, deviceDegrees = 0, isFront = true))
    assertEquals(180, CameraMath.jpegRotation(sensorOrientation = 90, deviceDegrees = 270, isFront = true))
  }

  @Test
  fun `结果永远落在 0 到 359`() {
    for (sensor in listOf(0, 90, 180, 270)) {
      for (device in listOf(0, 90, 180, 270, 360, -90)) {
        for (front in listOf(true, false)) {
          val r = CameraMath.jpegRotation(sensor, device, front)
          assert(r in 0..359) { "越界: $r (sensor=$sensor device=$device front=$front)" }
        }
      }
    }
  }

  @Test
  fun `比例计算抹平横竖方向`() {
    assertEquals(0.75f, CameraMath.ratioOf(4032, 3024), 0.001f)
    assertEquals(0.75f, CameraMath.ratioOf(3024, 4032), 0.001f)
    assertEquals(1f, CameraMath.ratioOf(0, 100), 0.001f)
  }

  @Test
  fun `挑尺寸时选长宽比最接近屏幕的那个`() {
    val candidates = listOf(4032 to 3024, 3840 to 2160, 1920 to 1080)
    // 屏幕 1080x2340(≈0.46)→ 最接近 16:9(0.5625)
    assertEquals(3840 to 2160, CameraMath.closestAspect(1080, 2340, candidates))
    // 屏幕 1080x1440(0.75)→ 最接近 4:3
    assertEquals(4032 to 3024, CameraMath.closestAspect(1080, 1440, candidates))
  }

  @Test
  fun `候选为空时返回 null`() {
    assertNull(CameraMath.closestAspect(1080, 1920, emptyList()))
    assertNull(CameraMath.previewFor(3840, 2160, emptyList()))
  }

  @Test
  fun `预览尺寸跟随拍摄比例且不超过宽度上限`() {
    val previews = listOf(3840 to 2160, 1920 to 1080, 1280 to 720, 640 to 480)
    val picked = CameraMath.previewFor(3840, 2160, previews)
    assertEquals(1920 to 1080, picked)
  }

  // ---------- 选流:必须按传感器原生比例 ----------

  @Test
  fun `拍照流按传感器比例选,同比例取像素最多的`() {
    // 这台设备:active 4080x3072(4:3),候选里既有 4:3 也有 20:9
    val picked = CameraMath.captureFor(
      activeWidth = 4080,
      activeHeight = 3072,
      candidates = listOf(4080 to 1836, 4000 to 3000, 4080 to 3072, 2400 to 1080),
    )
    assertEquals(4080 to 3072, picked)
  }

  @Test
  fun `拍照流遇到更小的同比例候选时仍取最大的`() {
    val picked = CameraMath.captureFor(
      activeWidth = 4000,
      activeHeight = 3000,
      candidates = listOf(1600 to 1200, 4000 to 3000, 4032 to 3024),
    )
    // 4032x3024 与 4000x3000 同为 4:3,取面积最大的
    assertEquals(4032 to 3024, picked)
  }

  @Test
  fun `没有同比例候选时退到最接近的比例`() {
    val picked = CameraMath.captureFor(
      activeWidth = 4080,
      activeHeight = 3072,
      candidates = listOf(4080 to 1836, 1920 to 1080),
    )
    // 两者都远离 4:3,取更接近的 16:9 小尺寸
    assertEquals(1920 to 1080, picked)
  }

  @Test
  fun `拍照流候选为空时返回 null`() {
    assertNull(CameraMath.captureFor(4080, 3072, emptyList()))
  }

  // ---------- 裁切区域:只缩放,不换比例 ----------

  @Test
  fun `1x 时裁切区域等于整块传感器`() {
    val crop = CameraMath.zoomCrop(4080, 3072, 1f)
    assertEquals(CameraMath.CropRegion(0, 0, 4080, 3072), crop)
  }

  @Test
  fun `2x 时裁切区域是中心一半`() {
    val crop = CameraMath.zoomCrop(4080, 3072, 2f)
    assertEquals(CameraMath.CropRegion(1020, 768, 2040, 1536), crop)
  }

  @Test
  fun `1_5x 时裁切区域居中且比例不变`() {
    val crop = CameraMath.zoomCrop(4080, 3072, 1.5f)
    assertEquals(2720, crop.width)
    assertEquals(2048, crop.height)
    // 比例必须和传感器一致,否则画会变形
    assertEquals(
      CameraMath.ratioOf(4080, 3072),
      CameraMath.ratioOf(crop.width, crop.height),
      0.01f,
    )
  }

  @Test
  fun `非法 zoom 一律当 1x,保证永远有画面`() {
    assertEquals(CameraMath.CropRegion(0, 0, 4080, 3072), CameraMath.zoomCrop(4080, 3072, 0.5f))
    assertEquals(CameraMath.CropRegion(0, 0, 4080, 3072), CameraMath.zoomCrop(4080, 3072, 0f))
    assertEquals(CameraMath.CropRegion(0, 0, 4080, 3072), CameraMath.zoomCrop(4080, 3072, Float.NaN))
  }

  @Test
  fun `极大变焦时裁切区域不会退化成 0`() {
    val crop = CameraMath.zoomCrop(4080, 3072, 1000f)
    // 只要 ≥1 即可:0 会让 createCaptureRequest 抛异常
    assertTrue(crop.width >= 1)
    assertTrue(crop.height >= 1)
    assertTrue(crop.width <= 4080)
    assertTrue(crop.height <= 3072)
  }
}
