# AI 拍照引导

[![CI](https://github.com/summerfallenleaves/ai-guide-photo/actions/workflows/ci.yml/badge.svg)](https://github.com/summerfallenleaves/ai-guide-photo/actions/workflows/ci.yml)
[![Android](https://github.com/summerfallenleaves/ai-guide-photo/actions/workflows/android.yml/badge.svg)](https://github.com/summerfallenleaves/ai-guide-photo/actions/workflows/android.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Latest release](https://img.shields.io/github/v/release/summerfallenleaves/ai-guide-photo)](https://github.com/summerfallenleaves/ai-guide-photo/releases)

**简体中文** | [English](./README.en.md)

举起手机取景时,实时告诉你"该往哪挪、该蹲多低、光在哪边",按下快门后再给一次复盘——
**而且给出的建议能一键设进相机**。

- 面向普通人的手机摄影助手,**不是专业相机 App**
- 纯本地运行:**没有自建服务器**,请求由手机直接发往 DeepSeek
- 产品定义与决策记录见 [REQUIREMENTS.md](./REQUIREMENTS.md)
- 给 AI 协作方的工程约定见 [AGENTS.md](./AGENTS.md)
- 想一起改代码?先看 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 发现安全问题请走私密通道,见 [SECURITY.md](./SECURITY.md)
- 发版流程见 [RELEASING.md](./RELEASING.md)

---

## 现在能做什么

### 相机

相机是**项目内自研的 Camera2 实现**(不是 expo-camera),所以能控制真正的拍摄参数。

| 功能 | 说明 |
| --- | --- |
| 实时预览 | 三分线、水平仪(端侧加速度计)、网格开关 |
| **捏合缩放** | 1x 到设备最大数字变焦,屏幕下方显示当前倍率 |
| **点按对焦** | 点哪里对哪里,出现对焦框 |
| **闪光灯** | 关 / 自动 / 常亮(硬件没有闪光灯时不显示该按钮) |
| **专业参数面板** | 半透明浮层,边调边看画面:曝光补偿 / ISO / 快门 / 对焦 / 白平衡 |
| **定时器** | 关 / 3 秒 / 10 秒,倒计时可点任意处取消 |
| **音量键快门** | 握持更稳,和屏幕快门同一套逻辑(含定时器) |
| **语音播报** | 把取景建议读出来,举着手机不用低头(**默认关闭**,需在设置里打开) |
| 前后摄切换 | 拍照方向按设备物理朝向自动摆正 |
| 所见即所得 | 预览与照片严格对齐(见下文"填充比例") |

**界面锁定竖屏。** 横屏界面已移除——它在预览方向和控件布局上反复出问题,而拍照方向由
设备朝向单独决定、不受界面影响,所以锁竖屏不影响横拍照片的正确性。

### AI

| 场景 | 行为 |
| --- | --- |
| 取景建议 | 每 3 秒抓一帧预览画面,给**一条**最值得改的建议 |
| 拍后点评 | 评分 + 做得好的地方 + 1~3 条改进项 + 可一键应用的拍摄参数 |
| 一键应用 | 复盘页点「应用参数并重拍」→ 回到相机,参数已经设进去 |

点评的结论分三档(`verdict`),用来避免"AI 硬找茬":

| 结论 | 分数 | 改进项 | 参数建议 |
| --- | --- | --- | --- |
| `keep` 很好 | ≥85 | 0~1 条 | 不给 |
| `tweak` 不错 | 60~85 | 1~2 条 | 可选 |
| `reshoot` 重拍 | <60 | 2~3 条 | 可选 |

这条规则**在代码里强制兜底**:模型即使给了 `keep` 又列三条问题,也会被截断成一条、参数直接丢弃。

### 其他

- **拍照历史**:按天分组,只保留最近 7 天(照片复制进 App 文档目录,过期连文件一起清)
- **成长统计**:历史页顶部显示平均分、最高分、结论分布、最常出问题的维度、最近 7 天趋势
  —— **纯本地计算,不消耗 API**
- **设置页**:API Key、快速模式、自动分析开关、分析间隔、参数建议开关、接口地址
- 断网或没配 Key 时不会白屏,会给出明确文案
- **不填 API Key 也能用**:相机的全部功能(缩放、对焦、闪光灯、专业参数、定时、音量键快门)
  都不需要网络 —— 顶部只显示一条提示,AI 部分自动隐藏,不会挡着你拍照

---

## 目录结构

```
src/app/                  页面(Expo Router,文件即路由)
  index.tsx               相机页
  review.tsx              拍后复盘页
  settings.tsx            设置
  history.tsx             拍照历史
src/components/           建议卡片 / 三分线 / 水平仪 / 闪光灯按钮 / 专业参数面板
src/hooks/                相机权限、水平仪、朝向
src/lib/                  设置、密钥、DeepSeek 客户端、图像处理、历史、设计 token
scripts/                  构建脚本(build.sh / release.sh,可移植)
modules/camera2/          ★ 自研相机(本地 Expo Module):预览/拍照/参数/方向
__tests__/                JS 单元测试(含 JS↔原生契约)
docs/REGRESSION.md        真机回归清单
```

**相机代码在 `modules/camera2/`,由 Expo autolinking 自动接入**,
不受 `npx expo prebuild --clean` 影响,也不需要手动注册。

---

## 架构

### 没有后端

```
手机 App ──HTTPS──▶ api.deepseek.com
   │
   └─ API Key 加密存在手机本地(SecureStore)
```

- Key **不在安装包里**,首次打开到设置里填一次
- 只存在设备加密存储,只出现在请求头里
- 想换成自己的服务:设置页的「接口地址」填上去即可

### 相机参数从哪来

自研相机通过 `TotalCaptureResult` **实时回报**当前 ISO / 快门 / 对焦位置(约 400ms 一次),
静态光学信息(焦距、光圈、ISO 范围、快门范围)由 `getCapabilities()` 一次取回。

这些参数有三个用途:

1. 拼进 prompt,让 AI 能给出参数层面的建议
2. 相机页顶栏显示实时读数
3. 复盘页显示一行,由「参数建议」开关控制

### 填充比例:预览与照片为什么必须一致

屏幕是 20:9(很细长),相机传感器是 4:3 或 16:9(比较方)。要在细长屏幕里显示较方的画面,
只有两条路:**留黑边**或者**裁掉两边**。

项目用一个连续参数 `DEFAULT_PREVIEW_FILL`(`src/app/index.tsx`)在两者之间调节:

- `0` = 完整显示,上下留黑边
- `1` = 铺满屏幕,左右裁切最多
- **当前 0.25**:真机上手调出来的值,画面足够满,裁切又不至于太多

**拍照后会按同一个可见比例裁切照片**,所以"取景框里看到的"就是"拍到的"。

---

## 怎么跑起来

### 直接装 APK(推荐)

装好后打开 App → 设置里填 DeepSeek API Key(来自 <https://platform.deepseek.com>)→
点「测试连接」确认可用。

### 从源码自己编

见下文 [从源码构建 APK](#从源码构建-apk)。

### 关于 Expo Go

**Expo Go 跑不了这个项目。** 相机是自研原生模块,Expo Go 里没有,会提示
"当前环境没有原生相机模块"。开发调试请直接构建 APK 安装。

---

## 设置项

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| 快速模式 | 开 | 开 → 点评用 `thinking: disabled`(1.6~1.8 秒);关 → `high`(3~6 秒,更细致) |
| 自动分析 | 开 | 开 → 取景时定时给建议;关 → 只保留拍后点评 |
| 自动分析间隔 | 3 秒 | 3~10 秒 |
| 参数建议 | 开 | 关 → 不读取也不使用拍摄参数 |

两条级联规则(界面上会把不可用的项置灰):

```
快速模式关  →  自动分析失效(高思考强度下 3 秒一轮永远滞后)
自动分析关  →  间隔配置失效
```

**关闭自动分析后,取景页的建议卡片整张不渲染**——它只服务于定时抓帧。
但如果出现错误(相机被占用、Key 失效等),错误卡片仍会显示,否则故障不可见。

---

## 常见问题

**取景建议出得慢?**

`deepseek-flash` 默认开启思考模式且 `effort=high`,一次调用会从 ~1 秒涨到 4 秒以上。
代码里已对取景建议**强制** `thinking: { type: "disabled" }`。

**为什么 AI 有时说不出问题?**

这是刻意的。点评有 `verdict` 三档,好照片会判 `keep` 并可能只给 0~1 条建议。
"给一张好照片硬凑三条问题"比"不给评价"更糟。

**照片和预览不一致?**

已经用"填充比例"对齐了。如果仍不一致,请记录:预览与照片的差异方向(裁多/裁少)。

**拍的照是什么画质?**

存相册和复盘页显示的是**同一张图**:先按可见比例裁切,再保存。
送模型的另有一份缩略图(长边 1280、质量 0.85),不影响你的照片。

**控制台报 `getPermissionsAsync has been rejected`?**

Expo Go 的已知限制,本项目已不再调用。相册写入改为"直接写,失败才申请权限"。

---

## 测试

```bash
npm test              # JS 单元测试(76 个)
npm run test:android  # Kotlin 单元测试(9 个)
npm run test:all      # 两者都跑
```

**相机行为必须真机验证**,清单见 [docs/REGRESSION.md](./docs/REGRESSION.md)。

其中最重要的是 `__tests__/native-camera2.contract.test.ts`——它锁死了 JS 调原生模块的
方法名、参数顺序、事件名和降级行为。动相机模块前先看它。

---

## 从源码构建 APK

### 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 见 `package.json` 的 `engines` |
| JDK | 17 | RN 0.88 / AGP 要求 |
| Android SDK | Platform 36+、Build-Tools 36+ | Android Studio 的 SDK Manager 装 |
| NDK | 27.1.12297006 | React Native 要编 C++,版本必须匹配 |

建议装 [Android Studio](https://developer.android.com/studio),它会一并装好 SDK 和 NDK,
然后把 `ANDROID_HOME` 指向 SDK 目录(macOS 默认 `~/Library/Android/sdk`)。

### 步骤

```bash
# 1. 装依赖
npm install

# 2. 生成原生工程(android/ 不入库,必须自己生成)
npx expo prebuild -p android

# 3. 构建 APK
export ANDROID_HOME="$HOME/Library/Android/sdk"    # Windows: %LOCALAPPDATA%\Android\Sdk
./scripts/build.sh assembleRelease

# 产物:android/app/build/outputs/apk/release/app-release.apk
```

`scripts/build.sh` 会自动处理环境变量:优先用你已导出的 `JAVA_HOME` / `ANDROID_HOME`,
找不到时回退到项目内的 `.toolchain/`(仓库维护者的离线工具链,不入库)。

想连版本号一起管理,用发布脚本:

```bash
./scripts/release.sh 0.0.2
# 产出:assets/apk/ai-guide-photo-v0.0.2.apk(并校验 APK 内的版本号)
```

**版本号规则**:文件名 `ai-guide-photo-v<主>.<次>.<修>.apk`;
`versionCode = 主×10000 + 次×100 + 修`(0.0.2 → 2),只增不减。

### 关于签名

`npx expo prebuild` 生成的工程用 **debug 密钥**签名 release 包,**自己装能用,但不能上架、
也不能给已安装的 App 做覆盖升级**。

要长期分发,自己生成密钥:

```bash
keytool -genkeypair -v -keystore my-release.keystore \
  -alias mykey -keyalg RSA -keysize 2048 -validity 10000

# 然后在 android/app/build.gradle 里把 signingConfigs.release 指向它
```

> ⚠️ 密钥文件**丢了就无法覆盖升级已安装的 App**(只能卸载重装,用户数据全丢)。
> 不要把它提交进仓库。

### 备选:云端构建(EAS)

没有本地 Android 环境也能出包,但需要一个 Expo 账号:

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

### 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| `android/ 目录不存在` | 没跑 `npx expo prebuild -p android` |
| `找不到 JDK` | 装 JDK 17 并设置 `JAVA_HOME` |
| NDK 版本不匹配 | SDK Manager 里装 `27.1.12297006`,或改 `android/build.gradle` 的 `ndkVersion` |
| 首次构建很慢(10 分钟以上) | 正常,C++ 要为每个原生模块编一遍;之后增量 20 秒~4 分钟 |
| 内存不足 / OOM | 调大 `android/gradle.properties` 的 `org.gradle.jvmargs`(如 `-Xmx4g`) |
| 想只编 arm64 减小体积 | `android/gradle.properties` 设 `reactNativeArchitectures=arm64-v8a` |

---

## 已知限制

- **iOS 未验证**:相机是纯 Android 实现,迁移需要重写相机层
- **鸿蒙 NEXT 未支持**:需要独立 `.hap`
- **无光学变焦**:手机只有一颗后摄(等效 23mm),缩放是数字裁切,3x 以上画质明显下降
- **ISO 上限 800**:暗光能力有限,夜里画质会下降
- **白平衡未标定**:色温转增益用传感器色彩矩阵换算,极端色温可能仍偏
- **横屏界面已移除**:需要时先读 AGENTS.md 里"界面锁定竖屏"一节
- 前置摄像头拍照方向未实测
