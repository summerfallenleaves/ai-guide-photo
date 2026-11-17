package com.aiguide.photograph.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.util.Base64
import android.view.Gravity
import android.view.OrientationEventListener
import android.view.TextureView
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream

/**
 * 相机预览视图。
 *
 * **预览不做任何旋转补偿** —— 这台设备的相机管线会自己按屏幕方向摆正画面。
 * 界面的横竖屏切换只影响 UI,不碰预览。
 * 方向传感器只用来给**拍照**算 JPEG 方向,保证存下来的照片是正的。
 */
class Camera2View(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val container = FrameLayout(context)
  private val textureView = TextureView(context)
  private var engine: Camera2Engine? = null

  /** "back" 或 "front",由 JS 侧 prop 控制 */
  var facingName: String = "back"
    set(value) {
      if (field != value) {
        field = value
        restart()
      }
    }

  private var deviceOrientation = 0

  private val orientationListener = object : OrientationEventListener(context) {
    override fun onOrientationChanged(orientation: Int) {
      if (orientation == ORIENTATION_UNKNOWN) return
      deviceOrientation = (((orientation + 45) / 90) * 90) % 360
    }
  }

  init {
    container.addView(
      textureView,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
        Gravity.CENTER,
      ),
    )
    addView(
      container,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )

    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) = start(w, h)
      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) = start(w, h)
      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        stop()
        return true
      }

      override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit
    }
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    fitPreview()
  }

  private fun start(width: Int, height: Int) {
    val st = textureView.surfaceTexture ?: return
    val e = engine ?: Camera2Engine(
      context = context,
      onError = { msg ->
        post { Camera2Bus.onError?.invoke(msg) }
      },
      onReady = { _, _ ->
        post {
          fitPreview()
          Camera2Bus.onReady?.invoke()
        }
      },
      onParams = { iso, exp, focus, kelvin, manual, ar, ag, ab, nr, ng, nb ->
        post {
          Camera2Bus.onParams?.invoke(
            mapOf(
              "iso" to iso,
              "exposureNs" to exp.toDouble(),
              "focusDiopters" to focus.toDouble(),
              "kelvin" to kelvin,
              "manual" to manual,
              "awbR" to ar.toDouble(),
              "awbG" to ag.toDouble(),
              "awbB" to ab.toDouble(),
              "neutralR" to nr.toDouble(),
              "neutralG" to ng.toDouble(),
              "neutralB" to nb.toDouble(),
            ),
          )
        }
      },
    ).also {
      it.deviceOrientationProvider = { deviceOrientation }
      engine = it
    }
    e.attach(
      st,
      width.coerceAtLeast(1),
      height.coerceAtLeast(1),
      if (facingName == "front") CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK,
    )
  }

  /**
   * 把预览铺进容器:**保持缓冲原始比例、不做旋转**,等比放大铺满。
   * 这一步是为了避免"把缓冲直接拉伸到容器大小"造成的人物变形。
   */
  private fun fitPreview() {
    val ps = engine?.previewSize ?: return
    val vw = width
    val vh = height
    if (vw <= 0 || vh <= 0 || ps.width <= 0 || ps.height <= 0) return

    textureView.layoutParams = FrameLayout.LayoutParams(ps.width, ps.height, Gravity.CENTER)
    textureView.rotation = 0f
    val scale = kotlin.math.max(vw.toFloat() / ps.width, vh.toFloat() / ps.height)
    textureView.scaleX = scale
    textureView.scaleY = scale
    textureView.requestLayout()
  }

  private fun restart() {
    stop()
    if (textureView.isAvailable) start(textureView.width, textureView.height)
  }

  private fun stop() {
    engine?.destroy()
    engine = null
  }

  fun takePicture(callback: (String?, Throwable?) -> Unit) {
    val e = engine
    if (e == null || !e.isAttached) {
      callback(null, IllegalStateException("相机还没准备好"))
      return
    }
    e.takePicture(callback)
  }

  /**
   * 抓当前预览画面并压成 JPEG base64。
   * 比"拍一张全尺寸再缩图"快得多,而且抓到的就是用户看到的构图。
   */
  fun grabPreviewBase64(targetWidth: Int, quality: Int, callback: (String?, Throwable?) -> Unit) {
    post {
      try {
        val bmp = textureView.bitmap ?: run {
          callback(null, IllegalStateException("预览还没就绪"))
          return@post
        }
        val w = if (targetWidth > 0 && targetWidth < bmp.width) targetWidth else bmp.width
        val h = (bmp.height.toFloat() * w / bmp.width).toInt().coerceAtLeast(1)
        val scaled = if (w == bmp.width) bmp else Bitmap.createScaledBitmap(bmp, w, h, true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 95), out)
        if (scaled !== bmp) scaled.recycle()
        callback(Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP), null)
      } catch (t: Throwable) {
        callback(null, t)
      }
    }
  }

  fun setZoom(ratio: Float) = engine?.setZoom(ratio) ?: Unit

  fun setFlashMode(mode: String) = engine?.setFlashMode(mode) ?: Unit

  fun setExposureCompensation(steps: Int) = engine?.setExposureCompensation(steps) ?: Unit

  fun focusAt(x: Float, y: Float) = engine?.focusAt(x, y) ?: Unit

  fun setManual(iso: Int?, exposureNs: Long?, focusDiopters: Float?, kelvin: Int?) {
    engine?.setManual(iso, exposureNs, focusDiopters, kelvin)
  }

  fun capabilities(): Map<String, Any> {
    val raw = engine?.capabilities() ?: return emptyMap()
    // Expo 的类型系统不认 FloatArray,统一转成 Double 列表
    return raw.mapValues { (_, value) ->
      if (value is FloatArray) value.map { it.toDouble() } else value
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Camera2Bus.activeView = this
    if (orientationListener.canDetectOrientation()) orientationListener.enable()
  }

  override fun onDetachedFromWindow() {
    orientationListener.disable()
    if (Camera2Bus.activeView === this) Camera2Bus.activeView = null
    stop()
    super.onDetachedFromWindow()
  }

  /** 由 Module 在视图销毁时调用 */
  fun release() {
    stop()
  }
}
