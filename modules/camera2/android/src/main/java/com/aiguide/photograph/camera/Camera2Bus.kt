package com.aiguide.photograph.camera

/** 相机事件的中转站:引擎 → 视图 → Module → JS */
object Camera2Bus {
  /** 当前挂载的预览视图;Module 的拍照/参数接口都作用在它身上 */
  var activeView: Camera2View? = null

  var onParams: ((Map<String, Any>) -> Unit)? = null
  var onError: ((String) -> Unit)? = null
  var onReady: (() -> Unit)? = null
}
