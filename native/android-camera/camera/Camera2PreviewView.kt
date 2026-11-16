package com.aiguide.photograph.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCharacteristics
import android.util.Base64
import android.view.Gravity
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
 * 最小的原生相机预览视图。
 *
 * 只负责:把 TextureView 的 Surface 交给 Camera2Engine,把 takePicture / setManual 转发下去。
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
          updateTransform()
          onEngineReady?.invoke(w, h)
          Camera2Bus.onReady?.invoke()
        }
      },
      onParams = { iso, exp, focus, kelvin, manual, ar, ag, ab, nr, ng, nb ->
        post { Camera2Bus.onParams?.invoke(iso, exp, focus, kelvin, manual, ar, ag, ab, nr, ng, nb) }
      },
    ).also { engine = it }
    e.attach(st, width.coerceAtLeast(1), height.coerceAtLeast(1), facing)
  }

  /**
   * 让预览等比铺进容器:
   * 1. 把 TextureView 按缓冲尺寸摆放(缓冲是横向的)
   * 2. 按传感器角度整体旋转,画面才正立
   * 3. 等比缩放到容器内,多余部分留黑边 —— 不做拉伸
   *
   * 这样取景框里的构图和拍下来的照片完全对应。
   */
  private fun updateTransform() {
    val e = engine ?: return
    val ps = e.previewSize ?: return
    val vw = width
    val vh = height
    if (vw <= 0 || vh <= 0 || ps.width <= 0 || ps.height <= 0) return

    textureView.layoutParams = LayoutParams(ps.width, ps.height, Gravity.CENTER)
    textureView.rotation = e.sensorOrientation.toFloat()

    val rotated = e.sensorOrientation % 180 != 0
    val dispW = (if (rotated) ps.height else ps.width).toFloat()
    val dispH = (if (rotated) ps.width else ps.height).toFloat()
    val scale = kotlin.math.min(vw / dispW, vh / dispH)
    textureView.scaleX = scale
    textureView.scaleY = scale
    textureView.requestLayout()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateTransform()
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

  var onEngineReady: ((Int, Int) -> Unit)? = null
  var onEngineError: ((String) -> Unit)? = null

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Camera2Module.activeView = this
  }

  override fun onDetachedFromWindow() {
    // 只有"当前就是自己"时才清空,否则会把另一个还活着的视图踢掉
    if (Camera2Module.activeView === this) Camera2Module.activeView = null
    stop()
    super.onDetachedFromWindow()
  }
}
