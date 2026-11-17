package com.aiguide.photograph.camera

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
