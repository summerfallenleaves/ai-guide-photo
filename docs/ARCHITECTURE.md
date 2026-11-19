# 架构

只画**职责与流向**,不写函数名和行号 —— 那种细节半年后一定过时,而分层和流向基本稳定。

面向贡献者的操作说明见 [CONTRIBUTING.md](../CONTRIBUTING.md);相机层的实现约定和踩坑记录见
[AGENTS.md](../AGENTS.md) 第六节。

---

## 一、分层

```mermaid
graph TD
  subgraph UI["界面层 src/app + src/components"]
    Camera["index.tsx<br/>相机页:只做组合与布局"]
    Review["review.tsx<br/>复盘页"]
    Settings["settings.tsx<br/>设置"]
    History["history.tsx<br/>拍照历史"]
    Cards["components/*<br/>建议卡片 / 专业面板 / 三分线 / 水平仪"]
  end

  subgraph HOOKS["src/hooks —— 交互与副作用"]
    Live["use-live-analysis<br/>分析循环"]
    Voice["use-voice-guide<br/>播报 + 冻结"]
    Capture["use-capture-flow<br/>拍照链路"]
    Timer["use-shutter-timer<br/>定时快门"]
    Gestures["use-preview-gestures<br/>缩放 / 点按对焦"]
    Env["use-tilt · use-api-key · use-camera-permission"]
  end

  subgraph LIB["src/lib —— 纯逻辑与 IO"]
    Policy["live-analysis-policy<br/>纯函数,有单测"]
    Stats["history-stats<br/>纯函数,有单测"]
    AI["api + deepseek<br/>prompt / 解析 / 兜底"]
    Facade["native-camera2<br/>JS 门面 + 优雅降级"]
    Images["analysis-image<br/>裁切 / 缩图"]
    Store["capture-store · history · settings · secure-key · media"]
  end

  subgraph NATIVE["原生层 modules/camera2 (Kotlin)"]
    Bridge["Camera2Module<br/>方法 + 事件 + View"]
    View["Camera2View<br/>TextureView 预览 / 抓帧"]
    Engine["Camera2Engine<br/>会话 / 拍照 / 手动参数"]
    Math["CameraMath<br/>方向公式 / 尺寸选择,有单测"]
  end

  Camera --> HOOKS
  Review --> Store
  Settings --> Store
  History --> Stats
  History --> Store
  Camera --> Cards
  HOOKS --> Policy
  HOOKS --> AI
  HOOKS --> Facade
  HOOKS --> Store
  Capture --> Images
  Facade --> Bridge
  Bridge --> View
  Bridge --> Engine
  Engine --> Math
```

**依赖只能向下**:界面 → hooks → lib → 原生。
反过来的情况只有一种:原生用**事件**（`onReady` / `onParams` / `onError` / `onVolumeKey`）通知上层。

---

## 二、取景建议(每 3~10 秒一轮)

```mermaid
sequenceDiagram
  participant T as 定时器
  participant L as useLiveAnalysis
  participant N as 原生相机
  participant D as DeepSeek
  participant UI as 建议卡片
  participant V as useVoiceGuide

  T->>L: 触发一轮
  L->>L: 前提检查(关闭/暂停/无 Key/无权限/在播报/在拍照 → 跳过)
  L->>N: grabPreview(直接读预览帧)
  N-->>L: base64
  L->>D: 图片 + 光学参数(思考关闭)
  D-->>L: 维度 / 标题 / 动作 / 是否可拍
  L->>UI: 换一条建议
  opt 语音播报开启
    L->>V: 新建议
    V->>V: 置位"播报中" → 后续分析跳过
    V->>L: 念完(或兜底超时)后补一次,间隔 ≥1.5s
  end
```

关键取舍:

- **抓的是预览帧,不是拍照** —— 送模型的就是用户眼前这一帧
- **播报期间冻结** —— 一句话 4~5 秒而间隔最短 3 秒,不冻结就会被顶掉半句
- **失败超过 3 次自动暂停** —— 后台期间的失败不算数,否则回前台就是一片红字

---

## 三、拍照到点评

```mermaid
sequenceDiagram
  participant S as 快门(屏幕 / 音量键)
  participant Tm as useShutterTimer
  participant C as useCaptureFlow
  participant N as 原生相机
  participant F as 相册 / 文档目录
  participant R as 复盘页
  participant D as DeepSeek

  S->>Tm: 按下
  opt 定时器开启
    Tm->>Tm: 倒计时(点任意处取消)
  end
  Tm->>C: capture()
  C->>N: takePicture()
  N-->>C: 文件路径 + JPEG 方向角
  C->>C: 按预览可见比例裁切(方向角决定换算哪个轴)
  C->>F: 写入系统相册
  C->>F: 复制进文档目录(历史用)
  C->>R: 照片先落地,立刻跳转
  C->>D: 后台点评(带上"快门前的最后一条建议")
  D-->>R: 分数 / 结论 / 做得好的地方 / 改进项 / 建议参数
  R->>C: 「应用参数并重拍」→ 暂存
  C->>N: 回到相机页后下发手动参数
```

关键取舍:

- **照片先落地再点评** —— 用户不该为了等 AI 盯着快门干站
- **裁切跟着预览走** —— 否则"取景框里看到的"和"拍到的"不一致
- **没有 API Key 也照常拍** —— 只是不进点评,不会拦着你按快门

---

## 四、状态归属

| 数据 | 存在哪 | 写入 | 读取 |
| --- | --- | --- | --- |
| 用户设置(快速模式 / 自动分析 / 间隔 / 语音 / 参数建议) | AsyncStorage | `settings.ts` | `useSettings()` 全局订阅 |
| API Key | SecureStore(系统密钥库) | `secure-key.ts` | `useApiKey()` |
| 刚拍的照片 + 点评状态 + 待应用参数 | 内存 | `capture-store.ts` | 复盘页、相机页 |
| 拍照历史(含照片文件) | AsyncStorage + 文档目录 | `history.ts` | `useHistory()` |
| 历史统计 | 派生(每次渲染现算) | — | `computeHistoryStats()` |
| 实时 ISO / 快门 / 对焦 | 内存(原生事件推送) | `use-live-analysis` 的 `meta()` | 相机页顶栏、prompt |
| 相机硬件能力 | 内存(就绪后取一次) | `getCapabilities()` | 变焦上限、闪光灯、参数档位 |

**约定**:用 `useSyncExternalStore` 订阅,保存后相关页面自动刷新,**不要在各页面各存一份副本**。

---

## 五、没做的部分

架构上明确排除的,避免以后被"怎么没有"困住:

| 没做 | 原因 |
| --- | --- |
| 自建后端 | Key 存设备密钥库就够;多一个服务就多一份运维和泄露面 |
| 端侧图像分析 | 端侧做构图判断的收益远低于直接送模型,而且相机帧在原生层,JS 拿不到高效像素数据 |
| 横屏布局 | 横屏下预览角度/比例反复出问题;拍照方向由设备朝向决定,与界面无关 |
| iOS | 相机层是纯 Android 实现,迁移等于重写 |
