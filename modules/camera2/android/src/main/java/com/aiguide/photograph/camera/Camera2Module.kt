package com.aiguide.photograph.camera

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * 相机的 JS 入口。
 *
 * 对外契约(与重构前完全一致):
 * - 方法:takePicture / grabPreview / setManual / getCapabilities
 * - 事件:onParams / onError / onReady
 * - 视图:Camera2Camera 的 prop `facing`("back" / "front")
 *
 * 这层契约由 __tests__/native-camera2.contract.test.ts 保护。
 */
class Camera2Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("Camera2Camera")

    Events("onParams", "onError", "onReady", "onVolumeKey")

    OnCreate {
      Camera2Bus.onParams = { payload -> sendEvent("onParams", payload) }
      Camera2Bus.onError = { message ->
        sendEvent("onError", mapOf("message" to message))
      }
      Camera2Bus.onVolumeKey = {
        sendEvent("onVolumeKey", emptyMap<String, Any>())
      }
      Camera2Bus.onReady = {
        sendEvent("onReady", emptyMap<String, Any>())
      }
    }

    OnDestroy {
      Camera2Bus.onParams = null
      Camera2Bus.onError = null
      Camera2Bus.onVolumeKey = null
      Camera2Bus.onReady = null
    }

    AsyncFunction("takePicture") { promise: Promise ->
      val view = Camera2Bus.activeView
      if (view == null) {
        promise.reject("NO_VIEW", "预览还没挂载", null)
      } else {
        view.takePicture { path, err ->
          if (err != null || path == null) {
            promise.reject("CAPTURE_FAILED", err?.message ?: "拍照失败", err)
          } else {
            // 带上 JPEG 方向:照片横向存储,JS 裁切要据此换算坐标轴
            promise.resolve(
              mapOf(
                "path" to path,
                "rotation" to view.currentJpegRotation(),
              ),
            )
          }
        }
      }
    }

    AsyncFunction("grabPreview") { targetWidth: Int, quality: Int, promise: Promise ->
      val view = Camera2Bus.activeView
      if (view == null) {
        promise.reject("NO_VIEW", "预览还没挂载", null)
      } else {
        view.grabPreviewBase64(targetWidth, quality) { base64, err ->
          if (err != null || base64 == null) {
            promise.reject("GRAB_FAILED", err?.message ?: "抓帧失败", err)
          } else {
            promise.resolve(base64)
          }
        }
      }
    }

    Function("setZoom") { ratio: Float ->
      Camera2Bus.activeView?.setZoom(ratio)
    }

    Function("setFlashMode") { mode: String ->
      Camera2Bus.activeView?.setFlashMode(mode)
    }

    Function("setExposureCompensation") { steps: Int ->
      Camera2Bus.activeView?.setExposureCompensation(steps)
    }

    Function("focusAt") { x: Float, y: Float ->
      Camera2Bus.activeView?.focusAt(x, y)
    }

    AsyncFunction("grabHistogram") { promise: Promise ->
      val view = Camera2Bus.activeView
      if (view == null) {
        promise.reject("no_view", "相机还没准备好", null)
        return@AsyncFunction
      }
      view.grabHistogram { bins, error ->
        if (bins != null) promise.resolve(bins) else promise.reject("histogram_failed", error?.message ?: "取直方图失败", error)
      }
    }

    Function("setCaptureOptions") { afMode: String?, awbMode: String? ->
      Camera2Bus.activeView?.setCaptureOptions(afMode = afMode, awbMode = awbMode)
    }

    Function("setManual") { iso: Int?, exposureNs: Double?, focusDiopters: Double?, kelvin: Int? ->
      Camera2Bus.activeView?.setManual(
        iso = iso,
        exposureNs = exposureNs?.toLong(),
        focusDiopters = focusDiopters?.toFloat(),
        kelvin = kelvin,
      )
    }

    AsyncFunction("getCapabilities") {
      Camera2Bus.activeView?.capabilities() ?: emptyMap<String, Any>()
    }

    View(Camera2View::class) {
      Prop("facing") { view: Camera2View, facing: String? ->
        view.facingName = if (facing == "front") "front" else "back"
      }

      OnViewDestroys { view: Camera2View ->
        view.release()
      }
    }
  }
}
