package com.aiguide.photograph

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 探测设备相机的光学能力,用来判断值不值得迁移到支持手动控制的相机方案。
 *
 * 关键判断项:
 * - manualSensor:是否允许手动 ISO / 快门(Camera2 MANUAL_SENSOR)
 * - manualPostProcessing:是否允许手动白平衡 / 对焦
 * - isoMin/isoMax、exposureMinNs/exposureMaxNs:可调区间
 */
class CameraProbeModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CameraProbe"

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    try {
      val manager = reactApplicationContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val result = Arguments.createArray()

      for (id in manager.cameraIdList) {
        val c = manager.getCameraCharacteristics(id)
        val map = Arguments.createMap()
        map.putString("id", id)
        map.putInt("lensFacing", c.get(CameraCharacteristics.LENS_FACING) ?: -1)

        val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
        map.putBoolean(
          "manualSensor",
          caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
        )
        map.putBoolean(
          "manualPostProcessing",
          caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING)
        )

        c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)?.let {
          map.putString("hardwareLevel", hardwareLevelName(it))
        }

        c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)?.let {
          map.putInt("isoMin", it.lower)
          map.putInt("isoMax", it.upper)
        }

        c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)?.let {
          map.putDouble("exposureMinNs", it.lower.toDouble())
          map.putDouble("exposureMaxNs", it.upper.toDouble())
        }

        c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.let {
          if (it.isNotEmpty()) map.putDouble("aperture", it[0].toDouble())
        }

        c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.let {
          if (it.isNotEmpty()) map.putDouble("focalLengthMm", it[0].toDouble())
        }

        c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.let {
          map.putDouble("sensorWidthMm", it.width.toDouble())
          map.putDouble("sensorHeightMm", it.height.toDouble())
        }

        c.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)?.let {
          map.putBoolean("manualFocus", it.contains(CameraCharacteristics.CONTROL_AF_MODE_OFF))
        }

        c.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)?.let {
          map.putBoolean("manualWhiteBalance", it.contains(CameraCharacteristics.CONTROL_AWB_MODE_OFF))
        }

        c.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)?.let {
          map.putBoolean("manualExposureMode", it.contains(CameraCharacteristics.CONTROL_AE_MODE_OFF))
        }

        result.pushMap(map)
      }

      promise.resolve(result)
    } catch (e: Throwable) {
      promise.reject("PROBE_FAILED", e.message, e)
    }
  }

  private fun hardwareLevelName(level: Int): String = when (level) {
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY(旧版,能力最弱)"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED(受限)"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL(完整)"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3(完整+)"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL(外接)"
    else -> "未知($level)"
  }
}
