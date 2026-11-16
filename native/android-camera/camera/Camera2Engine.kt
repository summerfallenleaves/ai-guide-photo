package com.aiguide.photograph.camera

import android.content.Context
import android.graphics.ImageFormat
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.RggbChannelVector
import android.hardware.camera2.params.StreamConfigurationMap
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Surface
import java.io.File
import java.io.FileOutputStream
import kotlin.math.ln
import kotlin.math.pow

/**
 * 基于 Camera2 的相机引擎:预览 + 拍照 + 手动参数。
 *
 * 为什么自己写:expo-camera(CameraX 封装)不暴露任何曝光控制,
 * vision-camera 5.x 的 nitro 桥在本项目的 RN 版本上属性读取失效。
 * 这里直接往 CaptureRequest 写 ISO / 快门 / 对焦 / 白平衡。
 */
class Camera2Engine(
  private val context: Context,
  private val onError: (String) -> Unit,
  private val onReady: (previewWidth: Int, previewHeight: Int) -> Unit,
  private val onParams: (iso: Int, exposureNs: Long, focusDiopters: Float, kelvin: Int, manual: Boolean) -> Unit,
) {
  private val thread = HandlerThread("camera2-engine").apply { start() }
  private val handler = Handler(thread.looper)

  private var cameraDevice: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var imageReader: ImageReader? = null
  private var previewSurface: Surface? = null
  private var characteristics: CameraCharacteristics? = null
  private var sensorOrientation = 0
  private var pendingCapture: ((String?, Throwable?) -> Unit)? = null

  /** 一旦 destroy,后续异步回调都必须放弃,否则会把相机漏在打开状态 */
  private var disposed = false

  /** 手动参数;null 表示该轴走自动 */
  private var iso: Int? = null
  private var exposureNs: Long? = null
  private var focusDiopters: Float? = null
  private var kelvin: Int? = null

  var isAttached: Boolean = false
    private set

  fun capabilities(): Map<String, Any> {
    val c = characteristics ?: return emptyMap()
    val isoRange = c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
    val expRange = c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
    val minFocus = c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
    val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: 0f
    val aperture = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.firstOrNull() ?: 0f
    return mapOf(
      "focalLengthMm" to focal,
      "aperture" to aperture,
      "isoMin" to (isoRange?.lower ?: 100),
      "isoMax" to (isoRange?.upper ?: 800),
      "exposureMinNs" to (expRange?.lower ?: 30_000L),
      "exposureMaxNs" to (expRange?.upper ?: 1_000_000_000L),
      "minFocusDistance" to minFocus,
    )
  }

  fun attach(
    surfaceTexture: SurfaceTexture,
    viewWidth: Int,
    viewHeight: Int,
    facing: Int = CameraCharacteristics.LENS_FACING_BACK,
  ) {
    handler.post {
      if (disposed) return@post
      try {
        detachInternal()
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val cameraId = pickCameraId(manager, facing) ?: run {
          onError("找不到指定朝向的相机")
          return@post
        }
        val chars = manager.getCameraCharacteristics(cameraId)
        characteristics = chars
        sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0

        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
          ?: run { onError("拿不到相机配置"); return@post }

        val size = choosePreviewSize(map, viewWidth, viewHeight)
        surfaceTexture.setDefaultBufferSize(size.width, size.height)
        previewSurface = Surface(surfaceTexture)
        isAttached = true

        openCamera(manager, cameraId, surfaceTexture, viewWidth, viewHeight, facing, size, 0)
      } catch (t: Throwable) {
        onError("接上预览失败:${t.message}")
      }
    }
  }

  private fun openCamera(
    manager: CameraManager,
    cameraId: String,
    surfaceTexture: SurfaceTexture,
    viewWidth: Int,
    viewHeight: Int,
    facing: Int,
    size: Size,
    retry: Int,
  ) {
    try {
      manager.openCamera(cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(device: CameraDevice) {
          if (disposed) {
            // 打开过程中页面已经退出:立刻关掉,否则相机会被永久占用
            try { device.close() } catch (_: Throwable) {}
            return
          }
          cameraDevice = device
          startSession(size)
        }

        override fun onDisconnected(device: CameraDevice) {
          device.close()
          cameraDevice = null
          onError("相机被占用(通常是另一个页面还开着预览)")
        }

        override fun onError(device: CameraDevice, error: Int) {
          device.close()
          cameraDevice = null
          val busy = error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE ||
            error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE
          if (busy && retry < 4) {
            // 上一会话可能还没完全释放,稍等再试
            handler.postDelayed({
              if (!disposed) {
                openCamera(manager, cameraId, surfaceTexture, viewWidth, viewHeight, facing, size, retry + 1)
              }
            }, 400L)
          } else {
            onError("打开相机失败(code=$error)")
          }
        }
      }, handler)
    } catch (t: Throwable) {
      onError("打开相机异常:${t.message}")
    }
  }

  private fun pickCameraId(manager: CameraManager, facing: Int): String? =
    manager.cameraIdList.firstOrNull {
      manager.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == facing
    } ?: manager.cameraIdList.firstOrNull()

  private fun choosePreviewSize(map: StreamConfigurationMap, viewWidth: Int, viewHeight: Int): Size {
    val sizes = map.getOutputSizes(SurfaceTexture::class.java) ?: emptyArray()
    if (sizes.isEmpty()) return Size(1280, 720)
    val targetRatio = if (viewHeight == 0) 16f / 9f else viewWidth.toFloat() / viewHeight.toFloat()
    val matched = sizes.filter {
      kotlin.math.abs(it.width.toFloat() / it.height.toFloat() - targetRatio) < 0.08f
    }.ifEmpty { sizes.toList() }
    return matched.filter { it.width <= 1920 }.maxByOrNull { it.width }
      ?: matched.minByOrNull { it.width }!!
  }

  private fun startSession(size: Size) {
    val device = cameraDevice ?: return
    val map = characteristics?.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return

    val jpegSizes = map.getOutputSizes(ImageFormat.JPEG) ?: emptyArray()
    val jpegSize = jpegSizes.filter { it.width <= 4032 }.maxByOrNull { it.width }
      ?: jpegSizes.maxByOrNull { it.width } ?: Size(1920, 1080)

    imageReader?.close()
    val reader = ImageReader.newInstance(jpegSize.width, jpegSize.height, ImageFormat.JPEG, 2)
    imageReader = reader

    reader.setOnImageAvailableListener({ r ->
      val image = r.acquireNextImage() ?: return@setOnImageAvailableListener
      try {
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        val file = File(context.cacheDir, "camera2-${System.currentTimeMillis()}.jpg")
        FileOutputStream(file).use { it.write(bytes) }
        handler.post { pendingCapture?.invoke(file.absolutePath, null); pendingCapture = null }
      } catch (t: Throwable) {
        handler.post { pendingCapture?.invoke(null, t); pendingCapture = null }
      } finally {
        image.close()
      }
    }, handler)

    device.createCaptureSession(
      listOf(previewSurface!!, reader.surface),
      object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          session = s
          applyRepeatingRequest()
          onReady(size.width, size.height)
        }

        override fun onConfigureFailed(s: CameraCaptureSession) {
          onError("相机会话配置失败")
        }
      },
      handler,
    )
  }

  /** 用当前手动参数重建预览请求;参数不被支持时退回基础预览,绝不让画面黑掉 */
  private fun applyRepeatingRequest() {
    val device = cameraDevice ?: return
    val s = session ?: return
    val ps = previewSurface ?: return
    try {
      val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
      builder.addTarget(ps)
      applyManualParams(builder)
      s.setRepeatingRequest(builder.build(), resultCallback, handler)
    } catch (t: Throwable) {
      onError("参数不生效,已退回自动:${t.message}")
      try {
        val fallback = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
          addTarget(ps)
          set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
        }
        s.setRepeatingRequest(fallback.build(), resultCallback, handler)
      } catch (t2: Throwable) {
        onError("启动预览失败:${t2.message}")
      }
    }
  }

  /** 逐轴设置手动参数;设备不支持的轴自动跳过,不影响其他轴 */
  private fun applyManualParams(b: CaptureRequest.Builder) {
    val c = characteristics

    // --- 曝光 ---
    val aeOffSupported = c?.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)
      ?.contains(CaptureRequest.CONTROL_AE_MODE_OFF) == true
    val isoV = iso
    val expV = exposureNs
    if (isoV != null && expV != null && aeOffSupported) {
      try {
        b.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
        b.set(CaptureRequest.SENSOR_SENSITIVITY, isoV)
        b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, expV)
      } catch (t: Throwable) {
        onError("手动曝光不被支持:${t.message}")
        b.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
      }
    } else {
      b.set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
    }

    // --- 对焦 ---
    val afModes = c?.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES)
    val focusV = focusDiopters
    if (focusV != null && afModes?.contains(CaptureRequest.CONTROL_AF_MODE_OFF) == true) {
      try {
        b.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
        b.set(CaptureRequest.LENS_FOCUS_DISTANCE, focusV)
      } catch (t: Throwable) {
        onError("手动对焦不被支持:${t.message}")
        setAutoFocus(b, afModes)
      }
    } else {
      setAutoFocus(b, afModes)
    }

    // --- 白平衡 ---
    val awbModes = c?.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES)
    val k = kelvin
    if (k != null && awbModes?.contains(CaptureRequest.CONTROL_AWB_MODE_OFF) == true) {
      try {
        b.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_OFF)
        b.set(CaptureRequest.COLOR_CORRECTION_MODE, CaptureRequest.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
        b.set(CaptureRequest.COLOR_CORRECTION_GAINS, kelvinToRggb(k))
      } catch (t: Throwable) {
        onError("手动白平衡不被支持:${t.message}")
        b.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
      }
    } else {
      b.set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
    }
  }

  private fun setAutoFocus(b: CaptureRequest.Builder, afModes: IntArray?) {
    val mode = when {
      afModes?.contains(CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE) == true ->
        CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE
      afModes?.contains(CaptureRequest.CONTROL_AF_MODE_AUTO) == true ->
        CaptureRequest.CONTROL_AF_MODE_AUTO
      else -> return
    }
    try {
      b.set(CaptureRequest.CONTROL_AF_MODE, mode)
    } catch (_: Throwable) {
    }
  }

  private val resultCallback = object : CameraCaptureSession.CaptureCallback() {
    private var lastEmit = 0L
    override fun onCaptureCompleted(
      s: CameraCaptureSession,
      request: CaptureRequest,
      result: TotalCaptureResult,
    ) {
      val now = System.currentTimeMillis()
      if (now - lastEmit < 400) return
      lastEmit = now
      val curIso = result.get(TotalCaptureResult.SENSOR_SENSITIVITY) ?: 0
      val curExp = result.get(TotalCaptureResult.SENSOR_EXPOSURE_TIME) ?: 0L
      val curFocus = result.get(TotalCaptureResult.LENS_FOCUS_DISTANCE) ?: 0f
      onParams(curIso, curExp, curFocus, kelvin ?: 0, iso != null)
    }
  }

  fun setManual(isoValue: Int?, exposureValue: Long?, focusValue: Float?, kelvinValue: Int?) {
    iso = isoValue
    exposureNs = exposureValue
    focusDiopters = focusValue
    kelvin = kelvinValue
    handler.post { applyRepeatingRequest() }
  }

  fun takePicture(callback: (String?, Throwable?) -> Unit) {
    handler.post {
      val device = cameraDevice
      val s = session
      val reader = imageReader
      if (device == null || s == null || reader == null) {
        callback(null, IllegalStateException("相机还没准备好"))
        return@post
      }
      pendingCapture = callback
      try {
        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
        builder.addTarget(reader.surface)
        applyManualParams(builder)
        builder.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation)
        s.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {}, handler)
      } catch (t: Throwable) {
        pendingCapture = null
        callback(null, t)
      }
    }
  }

  fun detach() {
    handler.post { detachInternal() }
  }

  private fun detachInternal() {
    isAttached = false
    try {
      session?.close(); session = null
      cameraDevice?.close(); cameraDevice = null
      imageReader?.close(); imageReader = null
      previewSurface?.release(); previewSurface = null
    } catch (_: Throwable) {
    }
  }

  fun destroy() {
    if (disposed) return
    disposed = true
    // 必须在相机线程上关闭,且关闭完成后才退出线程
    handler.post {
      detachInternal()
      try { thread.quitSafely() } catch (_: Throwable) {}
    }
  }

  /** 色温(K)转 RGB 增益,让画面在当前光源下还原白色 */
  private fun kelvinToRggb(k: Int): RggbChannelVector {
    val temp = k.coerceIn(2500, 8000) / 100.0
    val r: Double
    val g: Double
    val b: Double
    if (temp <= 66) {
      r = 255.0
      g = 99.4708025861 * ln(temp) - 161.1195681661
      b = if (temp <= 19) 0.0 else 138.5177312231 * ln(temp - 10) - 305.0447927307
    } else {
      r = 329.698727446 * (temp - 60).pow(-0.1332047592)
      g = 288.1221695283 * (temp - 60).pow(-0.0755148492)
      b = 255.0
    }
    val rr = r.coerceIn(1.0, 255.0)
    val gg = g.coerceIn(1.0, 255.0)
    val bb = b.coerceIn(1.0, 255.0)
    val gainR = (gg / rr).toFloat().coerceIn(0.2f, 5f)
    val gainB = (gg / bb).toFloat().coerceIn(0.2f, 5f)
    return RggbChannelVector(gainR, 1f, 1f, gainB)
  }
}
