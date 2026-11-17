package com.aiguide.photograph.camera

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/** 把原生相机的拍照 / 手动参数能力暴露给 JS,并回报实时参数 */
class Camera2Module(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  companion object {
    var activeView: Camera2PreviewView? = null
  }

  init {
    Camera2Bus.onError = { message ->
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("Camera2Error", message)
    }
    Camera2Bus.onReady = {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("Camera2Ready", true)
    }
    Camera2Bus.onParams = { iso, exposureNs, focus, kelvin, manual, awbR, awbG, awbB, neutralR, neutralG, neutralB ->
      val map = Arguments.createMap().apply {
        putInt("iso", iso)
        putDouble("exposureNs", exposureNs.toDouble())
        putDouble("focusDiopters", focus.toDouble())
        putInt("kelvin", kelvin)
        putBoolean("manual", manual)
        putDouble("awbR", awbR.toDouble())
        putDouble("awbG", awbG.toDouble())
        putDouble("awbB", awbB.toDouble())
        putDouble("neutralR", neutralR.toDouble())
        putDouble("neutralG", neutralG.toDouble())
        putDouble("neutralB", neutralB.toDouble())
      }
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("Camera2Params", map)
    }
  }

  override fun getName() = "Camera2Module"

  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  @ReactMethod
  fun takePicture(promise: Promise) {
    val view = activeView
    if (view == null) {
      promise.reject("NO_VIEW", "预览还没挂载")
      return
    }
    view.takePicture { path, err ->
      if (err != null || path == null) {
        promise.reject("CAPTURE_FAILED", err?.message ?: "拍照失败", err)
      } else {
        promise.resolve(path)
      }
    }
  }

  /**
   * 设置手动参数。任一参数传 null 表示该轴回到自动。
   * iso 与 exposureNs 需要同时提供才会切成手动曝光。
   */
  @ReactMethod
  fun setManual(
    iso: Double?,
    exposureNs: Double?,
    focusDiopters: Double?,
    kelvin: Double?,
  ) {
    activeView?.setManual(
      iso = iso?.toInt(),
      exposureNs = exposureNs?.toLong(),
      focusDiopters = focusDiopters?.toFloat(),
      kelvin = kelvin?.toInt(),
    )
  }

  @ReactMethod
  fun grabPreview(targetWidth: Double, quality: Double, promise: Promise) {
    val view = activeView
    if (view == null) {
      promise.reject("NO_VIEW", "预览还没挂载")
      return
    }
    view.grabPreviewBase64(targetWidth.toInt(), quality.toInt()) { b64, err ->
      if (err != null || b64 == null) promise.reject("GRAB_FAILED", err?.message ?: "抓帧失败", err)
      else promise.resolve(b64)
    }
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val caps = activeView?.capabilities() ?: emptyMap()
    val map = Arguments.createMap()
    caps.forEach { (k, v) ->
      when (v) {
        is Int -> map.putInt(k, v)
        is Long -> map.putDouble(k, v.toDouble())
        is Float -> map.putDouble(k, v.toDouble())
        is FloatArray -> map.putArray(k, Arguments.fromList(v.map { it.toDouble() }))
        else -> map.putString(k, v.toString())
      }
    }
    promise.resolve(map)
  }
}
