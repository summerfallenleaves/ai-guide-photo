package com.aiguide.photograph.camera

import android.hardware.camera2.CameraCharacteristics
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

/** 把 Camera2PreviewView 暴露成 RN 的 <Camera2Preview /> */
class Camera2ViewManager : SimpleViewManager<Camera2PreviewView>() {
  override fun getName() = "Camera2Preview"

  override fun createViewInstance(reactContext: ThemedReactContext) = Camera2PreviewView(reactContext)

  @ReactProp(name = "facing")
  fun setFacing(view: Camera2PreviewView, facing: String?) {
    view.facing = if (facing == "front") {
      CameraCharacteristics.LENS_FACING_FRONT
    } else {
      CameraCharacteristics.LENS_FACING_BACK
    }
  }
}

class Camera2Package : com.facebook.react.ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf(Camera2Module(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext) =
    listOf(Camera2ViewManager())
}
