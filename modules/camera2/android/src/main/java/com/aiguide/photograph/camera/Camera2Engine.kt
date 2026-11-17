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
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Size
import android.view.Surface
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs

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
  private val onParams: (
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
  ) -> Unit,
) {
  private val thread = HandlerThread("camera2-engine").apply { start() }
  private val handler = Handler(thread.looper)

  private var cameraDevice: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var imageReader: ImageReader? = null
  private var previewSurface: Surface? = null
  private var characteristics: CameraCharacteristics? = null
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

  /** 传感器安装角度(90 或 270 很常见),预览旋转要用 */
  var sensorOrientation: Int = 0
    private set

  /** 预览缓冲尺寸;视图按它做等比适配 */
  var previewSize: Size? = null
    private set

  private var facing: Int = CameraCharacteristics.LENS_FACING_BACK

  fun capabilities(): Map<String, Any> {
    val c = characteristics ?: return emptyMap()
    val isoRange = c.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
    val expRange = c.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
    val minFocus = c.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
    val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: 0f
    val aperture = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_APERTURES)?.firstOrNull() ?: 0f
    val transform = c.get(CameraCharacteristics.SENSOR_COLOR_TRANSFORM1)
    val colorMatrix = if (transform != null) {
      FloatArray(9) { idx -> transform.getElement(idx / 3, idx % 3).toFloat() }
    } else {
      FloatArray(0)
    }
    return mapOf(
      "colorTransform" to colorMatrix,
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
        this.facing = facing
        sensorOrientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0

        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
          ?: run { onError("拿不到相机配置"); return@post }

        val (captureSize, preview) = chooseSizes(map, viewWidth, viewHeight)
        previewSize = preview
        surfaceTexture.setDefaultBufferSize(preview.width, preview.height)
        previewSurface = Surface(surfaceTexture)
        isAttached = true

        openCamera(manager, cameraId, surfaceTexture, viewWidth, viewHeight, facing, captureSize, 0)
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
          // 切后台/别的应用抢占都会走到这里:悄悄重开,不要直接吓用户
          if (!disposed && retry < 6) {
            handler.postDelayed({
              if (!disposed) {
                openCamera(manager, cameraId, surfaceTexture, viewWidth, viewHeight, facing, size, retry + 1)
              }
            }, 600L)
          } else {
            onError("相机被占用,请退出重进")
          }
        }

        override fun onError(device: CameraDevice, error: Int) {
          device.close()
          cameraDevice = null
          // 1=被占用 2=相机数量超限 3=被系统禁用(切后台常见) 4=设备错误,
          // 这几种都值得重试;相机服务不可用(5)就没什么可等的了。
          val recoverable = error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE ||
            error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE ||
            error == CameraDevice.StateCallback.ERROR_CAMERA_DISABLED ||
            error == CameraDevice.StateCallback.ERROR_CAMERA_DEVICE
          // 被系统禁用通常要等回到前台,给更多次数和更长的间隔
          val maxRetry = if (error == CameraDevice.StateCallback.ERROR_CAMERA_DISABLED) 8 else 4
          if (recoverable && retry < maxRetry) {
            val delay = if (error == CameraDevice.StateCallback.ERROR_CAMERA_DISABLED) 700L else 400L
            handler.postDelayed({
              if (!disposed) {
                openCamera(manager, cameraId, surfaceTexture, viewWidth, viewHeight, facing, size, retry + 1)
              }
            }, delay)
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

  /**
   * 选尺寸。关键:拍摄尺寸不再"取最大",而是**挑长宽比最接近屏幕的**,
   * 预览再挑一个和拍摄同比例、分辨率适中的。
   * 这样取景框里看到的就是拍下来的构图,不会被裁掉或拉伸。
   */
  private fun chooseSizes(map: StreamConfigurationMap, viewWidth: Int, viewHeight: Int): Pair<Size, Size> {
    val jpegSizes = map.getOutputSizes(ImageFormat.JPEG) ?: emptyArray()
    val textureSizes = map.getOutputSizes(SurfaceTexture::class.java) ?: emptyArray()
    if (jpegSizes.isEmpty() || textureSizes.isEmpty()) {
      return Size(1280, 720) to Size(1280, 720)
    }

    val target = ratioOf(viewWidth.toFloat(), viewHeight.toFloat())
    val capture = jpegSizes.minByOrNull { kotlin.math.abs(ratioOf(it.width.toFloat(), it.height.toFloat()) - target) }
      ?: jpegSizes.maxByOrNull { it.width }!!
    val captureRatio = ratioOf(capture.width.toFloat(), capture.height.toFloat())

    val sameRatio = textureSizes.filter {
      kotlin.math.abs(ratioOf(it.width.toFloat(), it.height.toFloat()) - captureRatio) < 0.01f
    }
    val preview = sameRatio.filter { it.width <= 1920 }.maxByOrNull { it.width }
      ?: sameRatio.minByOrNull { it.width }
      ?: textureSizes.filter { it.width <= 1920 }.maxByOrNull { it.width }
      ?: textureSizes.first()

    return capture to preview
  }

  /** 统一成 <1 的比例,竖看横看都可比 */
  private fun ratioOf(w: Float, h: Float): Float =
    if (w <= 0f || h <= 0f) 1f else kotlin.math.min(w, h) / kotlin.math.max(w, h)

  private fun startSession(size: Size) {
    val device = cameraDevice ?: return

    val jpegSize = size
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

      val gains = result.get(TotalCaptureResult.COLOR_CORRECTION_GAINS)
      var nr = 0f
      var ng = 0f
      var nb = 0f
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // 中性色点是 3 个 Rational(传感器空间的 R/G/B)
        val np = result.get(TotalCaptureResult.SENSOR_NEUTRAL_COLOR_POINT)
        if (np != null && np.size >= 3) {
          nr = np[0].toFloat()
          ng = np[1].toFloat()
          nb = np[2].toFloat()
        }
      }

      onParams(
        result.get(TotalCaptureResult.SENSOR_SENSITIVITY) ?: 0,
        result.get(TotalCaptureResult.SENSOR_EXPOSURE_TIME) ?: 0L,
        result.get(TotalCaptureResult.LENS_FOCUS_DISTANCE) ?: 0f,
        kelvin ?: 0,
        iso != null,
        gains?.red ?: 0f,
        gains?.greenEven ?: 0f,
        gains?.blue ?: 0f,
        nr, ng, nb,
      )
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
        builder.set(CaptureRequest.JPEG_ORIENTATION, jpegRotation())
        s.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {}, handler)
      } catch (t: Throwable) {
        pendingCapture = null
        callback(null, t)
      }
    }
  }

  /** 设备物理朝向由预览视图注入(方向传感器),JPEG 方向据此计算 */
  var deviceOrientationProvider: (() -> Int)? = null

  /**
   * JPEG 方向:用**设备物理朝向**补偿,不看窗口方向。
   * 具体公式见 CameraMath,那里有单元测试保护。
   */
  private fun jpegRotation(): Int = CameraMath.jpegRotation(
    sensorOrientation = sensorOrientation,
    deviceDegrees = deviceOrientationProvider?.invoke() ?: 0,
    isFront = facing == CameraCharacteristics.LENS_FACING_FRONT,
  )

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

  /**
   * 色温(K)→ RGB 增益。
   *
   * 关键点:不能假设传感器是 sRGB 原色。先从 CCT 求出普朗克轨迹上的色度坐标,
   * 再用相机自己的 SENSOR_COLOR_TRANSFORM1(传感器 RGB→XYZ)求逆,把白点换到
   * **这颗传感器**的 RGB 空间,最后取倒数归一化得到增益。
   *
   * 拿不到矩阵时退回 sRGB 近似(老做法)。
   */
  private fun kelvinToRggb(k: Int): RggbChannelVector {
    val cct = k.coerceIn(2500, 8000).toDouble()
    val (cx, cy) = cctToChromaticity(cct)
    if (cy <= 1e-6) return RggbChannelVector(1f, 1f, 1f, 1f)

    val X = cx / cy
    val Y = 1.0
    val Z = (1.0 - cx - cy) / cy

    val rgb = xyzToSensorRgb(X, Y, Z) ?: xyzToSrgb(X, Y, Z)
    val r = rgb[0].coerceAtLeast(1e-4)
    val g = rgb[1].coerceAtLeast(1e-4)
    val b = rgb[2].coerceAtLeast(1e-4)

    // 增益 = 让该通道还原为中性的补偿量;夹在常见硬件区间内,避免过冲
    val gainR = (g / r).toFloat().coerceIn(0.35f, 2.8f)
    val gainB = (g / b).toFloat().coerceIn(0.35f, 2.8f)
    return RggbChannelVector(gainR, 1f, 1f, gainB)
  }

  /** CCT → 普朗克轨迹色度坐标(CIE 1931 xy),Kim et al. 拟合 */
  private fun cctToChromaticity(t: Double): Pair<Double, Double> {
    val x = if (t <= 4000) {
      -0.2661239e9 / (t * t * t) - 0.2343589e6 / (t * t) + 0.8776956e3 / t + 0.179910
    } else {
      -3.0258469e9 / (t * t * t) + 2.1070379e6 / (t * t) + 0.2226347e3 / t + 0.240390
    }
    val y = when {
      t <= 2222 -> -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683
      t <= 4000 -> -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867
      else -> 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483
    }
    return x to y
  }

  /** XYZ → 传感器 RGB(用相机自己的矩阵求逆);矩阵缺失或不可逆时返回 null */
  private fun xyzToSensorRgb(X: Double, Y: Double, Z: Double): DoubleArray? {
    val c = characteristics ?: return null
    val transform = c.get(CameraCharacteristics.SENSOR_COLOR_TRANSFORM1) ?: return null
    // 该 SDK 的 ColorSpaceTransform 只提供 getElement(row, col)
    val m = DoubleArray(9) { idx -> transform.getElement(idx / 3, idx % 3).toDouble() }
    val inv = invert3x3(m) ?: return null
    return doubleArrayOf(
      inv[0] * X + inv[1] * Y + inv[2] * Z,
      inv[3] * X + inv[4] * Y + inv[5] * Z,
      inv[6] * X + inv[7] * Y + inv[8] * Z,
    )
  }

  private fun xyzToSrgb(X: Double, Y: Double, Z: Double) = doubleArrayOf(
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  )

  private fun invert3x3(m: DoubleArray): DoubleArray? {
    val a = m[0]; val b = m[1]; val c = m[2]
    val d = m[3]; val e = m[4]; val f = m[5]
    val g = m[6]; val h = m[7]; val i = m[8]
    val det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if (abs(det) < 1e-9) return null
    val inv = 1.0 / det
    return doubleArrayOf(
      (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
      (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
      (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
    )
  }
}
