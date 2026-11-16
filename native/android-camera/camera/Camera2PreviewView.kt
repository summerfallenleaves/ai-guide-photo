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
import java.io.ByteArrayOutputStream

/** 相机实时参数的出口:引擎 → 视图 → 模块 → JS */
object Camera2Bus {
  var onParams: ((
    iso: Int,
    exposureNs: Long,
    focusDiopters: Float,
    kelvin: Int,
    manual: Boolean,
    awbR: Float,
    awbG: Float,
    awbB: Float,
    neutralR: Float,
    neutralG: Float,
    neutralB: Float,
  ) -> Unit)? = null
  var onError: ((String) -> Unit)? = null
  var onReady: (() -> Unit)? = null
}

/**
 * 原生相机预览视图。
 *
 * **预览不做任何旋转补偿** —— 画面永远按传感器原始朝向显示。
 * 界面上的旋转按钮只影响 UI 元素(快门/网格/翻转/悬浮卡片),不碰预览。
 * 方向传感器只用来给**拍照**算 JPEG 方向,保证存下来的照片是正的。
 */
class Camera2PreviewView(context: Context) : FrameLayout(context) {

  private val textureView = TextureView(context)
  private var engine: Camera2Engine? = null

  var facing: Int = CameraCharacteristics.LENS_FACING_BACK
    set(value) {
      if (field != value) {
        field = value
        restart()
      }
    }

  /** 设备物理朝向,只用于拍照方向 */
  private var deviceOrientation = 0

  private val orientationListener = object : OrientationEventListener(context) {
    override fun onOrientationChanged(orientation: Int) {
      if (orientation == ORIENTATION_UNKNOWN) return
      deviceOrientation = (((orientation + 45) / 90) * 90) % 360
    }
  }

  init {
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER))
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

  private fun start(width: Int, height: Int) {
    val st = textureView.surfaceTexture ?: return
    val e = engine ?: Camera2Engine(
      context = context,
      onError = { msg ->
        post {
          onEngineError?.invoke(msg)
          Camera2Bus.onError?.invoke(msg)
        }
      },
      onReady = { w, h ->
        post {
          fitPreview()
          onEngineReady?.invoke(w, h)
          Camera2Bus.onReady?.invoke()
        }
      },
      onParams = { iso, exp, focus, kelvin, manual, ar, ag, ab, nr, ng, nb ->
        post { Camera2Bus.onParams?.invoke(iso, exp, focus, kelvin, manual, ar, ag, ab, nr, ng, nb) }
      },
    ).also {
      it.deviceOrientationProvider = { deviceOrientation }
      engine = it
    }
    e.attach(st, width.coerceAtLeast(1), height.coerceAtLeast(1), facing)
  }

  /**
   * 把预览铺进容器:**保持缓冲原始比例、不做旋转**,等比放大铺满。
   * 这一步是为了避免以前"把缓冲直接拉伸到容器大小"造成的人物变形。
   */
  private fun fitPreview() {
    val ps = engine?.previewSize ?: return
    val vw = width
    val vh = height
    if (vw <= 0 || vh <= 0 || ps.width <= 0 || ps.height <= 0) return

    textureView.layoutParams = LayoutParams(ps.width, ps.height, Gravity.CENTER)
    textureView.rotation = 0f
    val scale = kotlin.math.max(vw.toFloat() / ps.width, vh.toFloat() / ps.height)
    textureView.scaleX = scale
    textureView.scaleY = scale
    textureView.requestLayout()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    fitPreview()
    post { fitPreview() }
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
        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        callback(b64, null)
      } catch (t: Throwable) {
        callback(null, t)
      }
    }
  }

  fun setManual(iso: Int?, exposureNs: Long?, focusDiopters: Float?, kelvin: Int?) {
    engine?.setManual(iso, exposureNs, focusDiopters, kelvin)
  }

  fun capabilities(): Map<String, Any> = engine?.capabilities() ?: emptyMap()

  /**
   * 排查预览方向用的现场数据。
   * transformMatrix 是关键:它由 SurfaceTexture 的生产者(HAL)设置,
   * 我们设的 textureView.rotation 覆盖不了它。
   */
  fun transformInfo(): Map<String, Any> {
    val ps = engine?.previewSize
    val m = FloatArray(16)
    try {
      textureView.surfaceTexture?.getTransformMatrix(m)
    } catch (_: Throwable) {
    }
    val displayRot = try {
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
        display?.rotation ?: 0
      } else {
        @Suppress("DEPRECATION")
        (context.getSystemService(android.content.Context.WINDOW_SERVICE) as android.view.WindowManager)
          .defaultDisplay.rotation
      }
    } catch (_: Throwable) {
      0
    }
    val lp = textureView.layoutParams
    return mapOf(
      "viewW" to width,
      "viewH" to height,
      "bufferW" to (ps?.width ?: 0),
      "bufferH" to (ps?.height ?: 0),
      "layoutW" to (lp?.width ?: 0),
      "layoutH" to (lp?.height ?: 0),
      "textureRotation" to textureView.rotation,
      "scale" to textureView.scaleX,
      "displayRotation" to displayRot,
      "m0" to m[0],
      "m1" to m[1],
      "m4" to m[4],
      "m5" to m[5],
      "deviceOrientation" to deviceOrientation,
    )
  }

  var onEngineReady: ((Int, Int) -> Unit)? = null
  var onEngineError: ((String) -> Unit)? = null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Camera2Module.activeView = this
    if (orientationListener.canDetectOrientation()) orientationListener.enable()
  }

  override fun onDetachedFromWindow() {
    orientationListener.disable()
    // 只有"当前就是自己"时才清空,否则会把另一个还活着的视图踢掉
    if (Camera2Module.activeView === this) Camera2Module.activeView = null
    stop()
    super.onDetachedFromWindow()
  }
}
