# AI 拍照引导 · 项目说明

> 本文件是给 **AI 协作方**看的项目约定与历史经验。面向人类的快速上手请看 [README.md](./README.md),
> 产品需求与决策记录请看 [REQUIREMENTS.md](./REQUIREMENTS.md)。

---

## 一、这是什么

一个手机摄影助手:**取景时实时给一条可执行的调整建议**("手机抬高 20 厘米,让桌面移出画面"),
按下快门后再给评分与改进项。

### 技术栈

| 项 | 值 |
| --- | --- |
| 框架 | Expo SDK 58 / React Native 0.88 / React 19 |
| 语言 | TypeScript 6(strict) |
| 路由 | Expo Router,页面在 `src/app/` |
| AI | DeepSeek `deepseek-flash`(视觉模型),**App 直连,无自建后端** |
| 目标平台 | Android(arm64)。iOS 未验证 |

### 两个运行形态

```bash
npm start                              # 开发:手机装 Expo Go 扫码,热更新
.toolchain/build.sh assembleRelease    # 打包:产出 APK,见第九节
```

---

## 二、Expo 的 API 变化很快,不要凭记忆写代码

Expo 每个 SDK 版本都有破坏性改动,记忆里的 API 很可能已经改名或移除。动任何 Expo / RN 代码前:

1. 先看 `package.json` 里 `expo` 的主版本号;
2. 拉对应版本文档:`https://docs.expo.dev/versions/v<major>.0.0/`;
3. 其他事项查 <https://docs.expo.dev/llms.txt>(索引 + 常见误解更正)。

本项目已经因此踩过多次(见第七节),**一律以文档和类型定义为准**。

---

## 三、界面设计

### 3.1 视觉基线

- **暗色**:相机全屏铺底,UI 全部是浮在上面的半透明层
- **统一的浮层语言**:背景 `rgba(20,20,24,0.82)` + 1px 描边 `rgba(255,255,255,0.14)` + 圆角 22
- **配色**:强调 `#5BC8FF`、成功 `#4ADE80`、警告 `#FBBF24`、危险 `#F87171`
- **文字层级**:标题 19/700 → 正文 15/500 → 说明 12.5/400(灰 `rgba(255,255,255,0.58)`)
- 颜色与圆角统一放在 `src/lib/theme.ts`,**不要在组件里写死色值**

### 3.2 相机页 `src/app/index.tsx`

竖屏:

```
┌──────────────────────────┐
│ AI 拍照引导      [水平✓][↻]│  ← 顶部:品牌 + 水平仪 + 旋转
│                          │
│      相机预览(三分线)     │
│                          │
│ ┌──────────────────────┐ │
│ │ 构图   ●●○  AI   设置 │ │  ← 建议卡片
│ │ 手机抬高一点           │ │     维度标签 / 置信度点 / 来源
│ │ 抬高约20厘米,让桌面…  │ │     标题 + 动作 + 理由(理由可省)
│ │ 背景杂物会抢注意力      │ │
│ └──────────────────────┘ │
│   网格     ◯快门     翻转 │  ← 快门 78px 白圈
│   直连 DeepSeek · 本机发起 │
└──────────────────────────┘
```

横屏:**不再压住画面**,右侧浮一列(34% 宽,230~320),元素各自带半透明底。
卡片切精简模式(去掉理由行、缩小字号),快门缩到 62px。

特殊状态:

| 状态 | 表现 |
| --- | --- |
| 没有 API Key | 整页引导「还没有配置 API Key」+「去设置」按钮 |
| 没有相机权限 | 引导授权;被永久拒绝则「去设置」跳系统设置 |
| 分析中 | 卡片右上角显示「更新中…」,**快门仍然可用** |
| 连续失败 3 次 | 自动暂停,卡片提示「点换一条重试」 |
| 自动分析关闭 | 卡片显示「自动分析已关闭,按快门后照常点评」 |

### 3.3 复盘页 `src/app/review.tsx`

- **竖屏**:上照片 + 下信息卡;信息卡 `maxHeight: 58%`,内部滚动
- **横屏**:左照片 + 右信息栏(36%,260~340)
- 照片用 `contain` **完整显示不裁切**(复盘要看整张图)
- 评分圆环按分数变色:≥80 绿 / ≥60 黄 / 其余红
- 三态:点评中(转圈 + 说明文案)/ 完成 / 失败(显示具体原因)

### 3.4 设置页 `src/app/settings.tsx`

从上到下:

1. **当前生效** —— 一行摘要(`自动分析:每 3 秒` / `自动分析:关闭`),不放推导信息
2. **API Key** —— 已保存时只显示首尾各 4 位 + 「更换」「测试连接」
3. **快速模式** —— 开关
4. **自动分析** —— 开关,快速模式关闭时置灰并提示
5. **自动分析间隔** —— 3~10 秒,加减按钮 + 分段刻度,前置条件不满足时整块置灰
6. **接口地址** —— 高级项,默认留空走官方地址

### 3.5 交互原则(改 UI 前必读)

1. **一次只给一条建议** —— 举着手机的人处理不了多条,信息过载等于弃用
2. **建议必须是可执行的物理动作**,不是形容词
   - ❌"构图不好" / ❌"左下角有杂物"
   - ✅"手机抬高 20 厘米,让桌面移出画面"
3. **拍照永远不被 AI 阻塞** —— 点了快门就有反馈,点评后台补
4. **横竖屏都要能用** —— 任何新界面都要考虑两个方向
5. **空态、错态必须有明确文案** —— 不允许白屏或"转圈到永远"

---

## 四、架构要点

### 4.1 没有后端

```
手机 App ──HTTPS──▶ api.deepseek.com
   └─ API Key 加密存在设备 Keystore / Keychain
```

- API Key **不在安装包里**,首次使用在设置页填入
- 任何"把 Key 写进代码/打包进 APK"的做法都是错的
- `server/` 目录是早期"局域网代理"方案的遗留,**当前不使用**,保留是为了以后能做"服务器托管 Key"的形态
  (设置页的「接口地址」填自己的服务器即可切换)

### 4.2 状态分布

| 数据 | 存放 | 实现 |
| --- | --- | --- |
| 用户设置 | AsyncStorage | `src/lib/settings.ts` + `useSettings()` |
| API Key | SecureStore(加密) | `src/lib/secure-key.ts` + `useApiKey()` |
| 刚拍的照片 / 点评状态 | 内存 | `src/lib/capture-store.ts` |

三处都用 `useSyncExternalStore` 订阅,保存后相关页面自动刷新,**不要在各页面各存一份副本**。

### 4.3 图像的两条路径

```
拍摄 quality 0.9 ──▶ 原文件(完整分辨率)
                     ├─ 存相册            ← 原文件
                     ├─ 复盘页显示         ← 原文件
                     └─ 后台缩到长边 1280  ← 临时文件,只送模型
```

送模型的图缩小是因为**服务端本来就会把图缩到约 1300×1300**;上传原图纯属浪费带宽。
缩图逻辑在 `src/lib/analysis-image.ts`。

### 4.4 AI 调用参数

| 场景 | 思考强度 | max_tokens | detail |
| --- | --- | --- | --- |
| 取景建议(每 3 秒) | `disabled`(固定) | 400 | high |
| 拍后点评 · 快速模式开 | `disabled` | 600 | high |
| 拍后点评 · 快速模式关 | `high` | 3000 | high |

取景建议**不许**跟随用户设置走高思考强度——3 秒刷一次,一旦被推理拖住就彻底失去意义。

---

## 五、并发与锁

相机有一个硬约束:**同一时刻只能有一次 `takePictureAsync`**。但"分析"和"拍照"要能并行。

- `useCameraLock`(`src/hooks/use-camera-lock.ts`)把拍摄调用串成队列
- 锁**只包住 `takePictureAsync` 本身**,不包网络请求
- 分析中用 `analyzeBusyRef`,拍照用 `captureBusyRef`,两者独立
- 拍照时分析循环跳过;`reviewSeq` 自增用于丢弃上一张迟到的点评

> 早期版本用一个 `busyRef` 同时管两件事,导致**分析那 1~2 秒里按快门被静默吞掉**,
> 而按钮看起来还是可点的。改这块务必保持"锁相机不锁网络"。

---

## 六、相机相关的硬约束

- `CameraView` **拿不到预览帧流**,只能定时 `takePictureAsync` 抓快照;更高频会明显发热
- `animateShutter` 是 `CameraView` 的 **prop**,不是 `takePictureAsync` 的选项;必须设为 `false`,
  否则每 3 秒抓帧都会触发一次快门动画和声音
- 水平仪用的是加速度计(`src/hooks/use-tilt.ts`),**横竖握要换轴**:
  `|x|≥|y|` 时用 `atan2(y,|x|)`,否则 `atan2(x,|y|)`。写死竖屏公式会在横屏下算错
- 旋转用 `ScreenOrientation.lockAsync(LANDSCAPE)`,不写死 `LANDSCAPE_LEFT`,让系统按握持方向决定

---

## 七、踩坑记录(全都实际踩过)

### 7.1 Expo / RN API 变化

| 坑 | 现状 |
| --- | --- |
| `expo-media-library` 的 `saveToLibraryAsync` 已废弃,调用会在运行时抛错 | 改用 `Asset.create(uri)` |
| 该库的 `usePermissions` / `getPermissionsAsync` 在 **Expo Go + Android 上直接 reject** | 全项目不再调用;改为"先直接写相册,失败才 `requestPermissionsAsync`" |
| `expo-image-manipulator` 旧 `manipulateAsync` 已废弃 | 用新的 `ImageManipulator.manipulate(uri)` → `renderAsync()` → `saveAsync()` |
| `StyleSheet.absoluteFillObject` 在 RN 0.88 类型里已不存在 | 手写 `position/top/left/right/bottom` |
| `expo-image` 加载本地 `file://` 在部分机型渲染成纯黑,且不报错 | 复盘页改用 RN 原生 `Image` |

### 7.2 相机

- 预览默认 `FILL`(裁切),和实际拍下的照片视野不一致;要"所见即所得"必须显式配比例
- 抓帧频率别贪高,3 秒一次已经足够,再快明显发热
- 抓帧时 `shutterSound: false`,否则每轮都会响

### 7.3 AI 调用(最贵的几个坑)

1. **DeepSeek 默认开启思考模式且 `effort=high`** → 一次取景建议从 1s 涨到 4s+,
   频繁撞超时后退回本地规则。必须显式 `thinking: { type: 'disabled' }`。
2. **思维链也计入 `max_tokens`**。预算给 450 时,`high` 模式思考就把额度吃光、
   **正文为空** → 解析失败 → 静默退化成硬编码建议。用户看到的"AI 建议"其实是假的。
   现在按强度分档(600/1500/3000),并检测 `finish_reason === 'length'` 时**翻倍重试一次**。
3. **`low` 不等于"快"**。实测 `low` 仍会产生 300~800 个思考 token、单次 3.5~8 秒,
   和 `high` 差不多。真正快的是 `disabled`(1.6~1.8 秒)。
4. **`detail: "low"` 只有约 200 个输入 token**(远低于文档说的 1024 上限),细节基本丢失;
   `"high"` 约 1000 token,而**延迟几乎不变**(预填充很快,时间主要花在生成上)。
5. 报错要分类(没 Key / Key 失效 / 额度不足 / 限流 / 网络 / 超时 / 解析失败),
   统一文案会让排查变得很难。

### 7.4 布局

- **flex 挤压**:信息区按内容撑开 + 图片区 `flex:1` → 横屏时图片被压成一条缝(看起来"没图片")。
  修法:信息区加 `maxHeight`(58%),超出内部滚动。
- **浮层遮挡**:横屏面板一开始是"盖在预览上"的实心黑条,导致看不到完整画面。
  最终改成"不重叠"或"半透明浮动",取决于是否要让出预览宽度。
- 任何绝对定位的浮层都要配 `pointerEvents="box-none"`,否则会吞掉下层点击。

### 7.5 数据与权限

- 路由参数传 `file://` 地址不可靠(编解码/丢失),复盘页因此显示成黑屏。
  现在用**内存 store 兜底**,路由参数只作备用。
- 权限申请顺序:Android 13+ 写相册不需要运行时权限,**先直接写,失败再申请**,不要一上来就弹框。

### 7.6 构建(详见第九节)

- 本机没有系统 JDK / Android SDK,且**沙箱只允许写项目内目录** → 工具链全部装在 `.toolchain/`
- AGP 同时检测到 `ANDROID_USER_HOME` 和 `ANDROID_PREFS_ROOT` 会直接报错(值相同也不行)
- AGP 默认要写 `~/.android` → `Operation not permitted`,必须重定向
- Release 模板默认用**调试密钥**签名 → 已换成 `.toolchain/keys/aiguide.keystore`

### 7.7 下载

- 大文件走 `curl -LO` 单线程只有 127~240KB/s,且频繁 `HTTP/2 stream not closed` 断流。
- 有效解法:`--http1.1` + `-C -`(断点续传)+ 分段并行(16 路,约 1.5MB/s,快 6~10 倍)。
  脚本见 `.toolchain/downloads/par-download.sh`。

---

## 八、常用命令

```bash
npx expo install <pkg>     # 装依赖必须用它,会挑 SDK 兼容版本;不要直接 npm install
npm start                  # 开发服务器
npx tsc --noEmit           # 类型检查
npx eslint src --ext .ts,.tsx   # lint
```

**提交前必须过类型检查和 lint。** `npx expo lint` 在当前环境会误报版本错误,直接用 `npx eslint`。

---

## 九、本地 Android 构建

### 产物路径

| 用途 | 路径 |
| --- | --- |
| 原始产物 | `android/app/build/outputs/apk/release/app-release.apk` |
| 对外分发副本 | `assets/apk/ai-guide-photo-v<version>.apk`(该目录已 gitignore) |

包名 `com.aiguide.photograph`,arm64-v8a,APK Signature Scheme v2 签名。

### 重新打包

```bash
npx tsc --noEmit && npx eslint src --ext .ts,.tsx
.toolchain/build.sh assembleRelease
```

- 首次构建约 12 分钟(C++ 要为 5 个原生模块各编一遍 arm64),**增量 2~4 分钟**
- 只需验证能编译时可用 `assembleDebug`
- `build.sh` 会自动导出 `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME` / `ANDROID_USER_HOME`

### 工具链位置

工具链**全部在项目内**,不写系统目录(沙箱只有工作区可写):

```
.toolchain/
├── jdk17/                    OpenJDK 17
├── android-sdk/              compileSdk 36 / build-tools 37.0.0 / NDK 27.1.12297006 / CMake
├── gradle-home/              Gradle 9.4.1 缓存 + init.d/aliyun-mirrors.gradle(国内 Maven 镜像)
├── android-user-home/        替代 ~/.android
├── keys/aiguide.keystore     Release 签名密钥
├── downloads/                组件压缩包与下载脚本(可删)
└── build.sh                  构建入口
```

`android/` 由 `npx expo prebuild` 生成,已在 gitignore 中。

### 三个必须知道的构建约束

1. `ANDROID_USER_HOME` 与 `ANDROID_PREFS_ROOT` **不能同时设置**,只保留前者
2. Gradle 依赖必须走阿里云镜像(官方源 127KB/s,镜像 1.4MB/s)
3. **`prebuild --clean` 会冲掉三处手工修改**,重建后要重新应用:
   - `android/gradle.properties`:`jvmargs` 提到 4G、`reactNativeArchitectures=arm64-v8a`、
     `android.enableMinifyInReleaseBuilds=false`
   - `android/app/build.gradle`:新增 `signingConfigs.release` 并让 release buildType 使用它
   - `android/gradle/wrapper/gradle-wrapper.properties`:`distributionUrl` 指向本地 zip

> ⚠️ **`.toolchain/keys/aiguide.keystore` 是签名密钥,丢了之后无法覆盖升级已安装的 App**
> (只能卸载重装,用户设置全丢)。密码写在 `android/app/build.gradle`。

---

## 十、已知遗留

- `expo-image` 依赖已不再使用(复盘页换成了 RN 原生 `Image`),可移除
- `server/` 是旧代理方案,未删除,当前不参与运行
- iOS 完全未验证(没有真机,模拟器相机不可用)
- 「建议历史」未实现
- 评分可复现性差:同一张图两次可能差 20 分以上,需要固定评分锚点或降 temperature
- 鸿蒙 NEXT 未支持

---

## 十一、规则

- **新增原生行为优先用 config plugin**(`app.json` 的 `plugins`),不要手改 `android/`。
  例外只有签名和 Gradle 参数这类插件表达不了的,清单见第九节。
- 加带原生代码的库之后,Expo Go 就跑不了了,需要重新打包。
- 优先用 Expo 官方模块,第三方库先确认在 Expo Go 里可用。
- 提交前跑类型检查和 lint。
- 改 UI 前读第三节的交互原则;改相机/并发前读第四、五、六节。
