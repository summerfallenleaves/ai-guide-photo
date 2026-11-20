# AI 拍照引导 · 项目说明

> 本文件是给 **AI 协作方**看的项目约定与历史经验。面向人类的快速上手请看 [README.md](./README.md),
> 分层与数据流图见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md),
> 产品需求与决策记录请看 [REQUIREMENTS.md](./REQUIREMENTS.md)。

> ⚠️ **提交与推送必须先获得用户的明确授权。** 见第十一节第一条。

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

### 运行形态

```bash
scripts/release.sh 0.0.2               # 发布:同步版本号 + 构建 + 命名(见第九节)
scripts/build.sh assembleDebug         # 只验证能否编译
```

**Expo Go 跑不了本项目** —— 相机是自研原生模块,Expo Go 里没有。
开发调试同样需要装 APK。

---

## 二、Expo 的 API 变化很快,不要凭记忆写代码

Expo 每个 SDK 版本都有破坏性改动,记忆里的 API 很可能已经改名或移除。动任何 Expo / RN 代码前:

1. 先看 `package.json` 里 `expo` 的主版本号;
2. 拉对应版本文档:`https://docs.expo.dev/versions/v<major>.0.0/`;
3. 其他事项查 <https://docs.expo.dev/llms.txt>(索引 + 常见误解更正)。

本项目已经因此踩过多次(见第七节),**一律以文档和类型定义为准**。

---

## 三、界面设计

### 3.0 设计 token(唯一事实来源)

**所有视觉值都在 `src/theme.ts`**,页面里不写字面量。

| token | 内容 |
| --- | --- |
| `palette` | 颜色:背景 / 浮层卡片 / 描边 / 填充 / 文字三档 / 强调 / 成功 / 警告 / 危险 |
| `spacing` | 间距 `xxs 2 · xs 4 · sm 6 · md 8 · lg 10 · xl 12 · xxl 16 · xxxl 24 · huge 32` |
| `radius` | `sm 10 · md 16 · lg 22 · pill` |
| `type` | 文字层级 `overline 10 · caption 11 · subhead 12.5 · callout 13 · body 15 · headline 16 · title 19 · metric 22 · display 26` |
| `weight` | `medium · semibold · bold · heavy` |
| `tabularNums` | 等宽数字(读数防抖) |
| `motion` | 动效时长 `fast 150 · base 250 · slow 400` |

规则:

- 颜色 / 字号 / 字重 / 内边距一律用 token;`fontSize: 15` 这种写法不允许
- 一次性光学微调(文字投影、图标 1px 偏移)可以留在原地,**但要写注释说明为什么**
- 新增 token 前先确认它会被用到第二次

### 3.1 视觉基线

- **暗色**:相机全屏铺底,UI 全部是浮在上面的半透明层
- **统一的浮层语言**:背景 `rgba(20,20,24,0.82)` + 1px 描边 `rgba(255,255,255,0.14)` + 圆角 22
- **配色**:强调 `#5BC8FF`、成功 `#4ADE80`、警告 `#FBBF24`、危险 `#F87171`
- **文字层级**:标题 19/700 → 正文 15/500 → 说明 12.5/400(灰 `rgba(255,255,255,0.58)`)
- 颜色与圆角统一放在 `src/theme.ts`,**不要在组件里写死色值**

### 3.2 相机页 `src/app/index.tsx`(只负责组合与布局)

页面曾经是 1115 行、21 个 state + 20 个 ref 平铺在一个作用域里,所有相机 bug 都出在这里。
现在按职责拆成 5 个 hook + 1 个纯函数模块:

| 文件 | 职责 |
| --- | --- |
| `src/domain/guidance/live-analysis-policy.ts` | **纯函数**:这一轮能不能跑、失败怎么计数、间隔取多少。有单测 |
| `hooks/use-live-analysis.ts` | 分析循环:抓帧、调模型、失败暂停、定时器 |
| `hooks/use-voice-guide.ts` | 播报 + 播报期间冻结建议 |
| `hooks/use-capture-flow.ts` | 拍照 → 前置镜像 → 存相册 → 进复盘 → 后台点评 |
| `hooks/use-shutter-timer.ts` | 定时快门(关/3s/10s + 倒计时) |
| `hooks/use-preview-gestures.ts` | 捏合缩放 + 点按对焦(唯一需要 React Compiler 豁免的地方) |

**约定**:新逻辑优先放进对应的 hook 或纯函数;页面只做组合和布局。
判断类逻辑先写成纯函数(可以单测),再让 hook 调它。

### 3.2.1 五层目录(改代码前先确认放哪一层)

| 层 | 目录 | 只做这件事 |
| --- | --- | --- |
| 表现层 | `src/app` `src/components` `src/theme.ts` | 组合与布局 |
| 应用层 | `src/hooks` | 时机、编排、副作用 |
| 领域层 | `src/domain/guidance` `src/domain/shared` | 规则,纯函数,不碰 IO |
| 数据层 | `src/data` | 持久化(设置 / 密钥 / 历史 / 内存态) |
| 基础设施层 | `src/infra` | 相机门面、模型客户端、图片、相册 |

**AI 不是一个目录,而是两半**:规则在 `domain/guidance`(prompt / scoring / 调度 / 统计),
模型调用在 `infra/ai`(传输与报错分类)。换模型只动 `infra/ai`,改规则只动 `domain/guidance`。

**硬边界:相机侧禁止依赖 AI**,由 ESLint `no-restricted-imports` 强制。
没有 API Key 时相机必须完全可用 —— 这条是产品要求,不是风格偏好。


竖屏(唯一形态):

```
┌────────────────────────────────┐
│ [专业]   [定时][⚡][水平✓][设置]  │  ← 顶栏:左专业,右四个控件
│                                │
│      ┌──────────────────┐      │
│      │                  │      │  ← 4:3 预览(铺满视图,不裁)
│      │   相机预览画面     │      │
│      │   (九宫格可开关)    │      │
│      └──────────────────┘      │
│  ┌──────────────────────────┐  │
│  │  构图  ●●○ AI  ↻          │  │  ← 建议卡片
│  └──────────────────────────┘  │
│  (◯历史)      ◯         翻转      │
└────────────────────────────────┘
```

**预览是 4:3、屏幕是 9:20,所以上下会空出来 —— 空出来的位置全部给 UI**:
顶栏在上,建议卡片和控件在下。不要为了"铺满"去裁切预览,那会同时牺牲画质和一致性。

**顶栏没有标题**:曾经有「AI 拍照引导」+ 一行实时 ISO/快门,为了给控件腾位置删掉了。
实时参数现在只在「专业」面板顶部可见。

左下角是**历史缩略图**(圆形,显示最近一张照片;没有历史时是纯白圆),
点击进拍照历史页 —— 取代了原来的「专业」文字按钮。
`专业` 挪到了顶栏左侧。
顶栏右侧常驻:`定时`(关/3s/10s) / `闪光灯`(有硬件才显示) / `水平仪` / **`设置`**。
**九宫格的开关在设置页**,顶栏没有网格按钮。
**设置入口必须在顶栏常驻**,不能只放在建议卡片里——关闭自动分析后卡片会变成
"已关闭"的说明文案,入口会跟着消失,用户就再也进不去设置了。

特殊状态:

| 状态 | 表现 |
| --- | --- |
| 没有 API Key | **相机照常可用**。顶部一条提示「没有 API Key · 相机可用,AI 建议和点评不可用」+「去设置」;建议卡片不渲染,拍照后不进 AI 点评 |
| 没有相机权限 | 引导授权;被永久拒绝则「去设置」跳系统设置 |
| 分析中 | 卡片右上角显示「更新中…」,**快门仍然可用** |
| 画面已经可以拍 | 快门圈变绿 + 轻震一次。**只是提示**,拿不到建议/出错时根本不出现 |
| 连续失败 3 次 | 自动暂停,卡片提示「点换一条重试」 |
| 自动分析关闭 | **整张卡片不渲染**(它只服务于定时抓帧) |
| 专业面板展开 | **卡片收起** —— 面板是半透明浮层,压在卡片上会把两层文字叠在一起 |
| 自动分析关闭 + 有错误 | **仍显示错误卡** —— 否则故障不可见 |

### 3.3 复盘页 `src/app/review.tsx`

- 上照片 + 下信息卡;信息卡 `maxHeight: 58%`,内部滚动
- 照片用 `contain` **完整显示不裁切**(复盘要看整张图)
- 评分圆环按分数变色:≥80 绿 / ≥60 黄 / 其余红
- 三态:点评中(转圈 + 说明文案)/ 完成 / 失败(显示具体原因)

### 3.4 设置页 `src/app/settings.tsx`

从上到下:

1. **当前生效** —— 一行摘要(`自动分析:每 3 秒` / `自动分析:关闭`)+ 版本号,不放推导信息
2. **网格** —— 九宫格开关,**默认开**
3. **快速模式** —— 开关
4. **自动分析** —— 开关,快速模式关闭时置灰并提示
5. **语音播报** —— 开关
6. **参数建议** —— 开关
7. **自动分析间隔** —— 3~10 秒,加减按钮 + 分段刻度,前置条件不满足时整块置灰
   **语音播报开启时这块也置灰**(显示「由语音节奏决定」)—— 见下文语音章节
8. **DeepSeek API Key** —— 已保存时只显示首尾各 4 位 + 「更换」「测试连接」
9. **接口地址** —— 高级项,默认留空走官方地址

> Key 和接口地址放在相邻位置:两者都是「连到哪里」的配置,放在一起更符合心智。

### 3.5 交互原则(改 UI 前必读)

1. **一次只给一条建议** —— 举着手机的人处理不了多条,信息过载等于弃用
2. **建议必须是可执行的物理动作**,不是形容词
   - ❌"构图不好" / ❌"左下角有杂物"
   - ✅"手机抬高 20 厘米,让桌面移出画面"
3. **拍照永远不被 AI 阻塞** —— 点了快门就有反馈,点评后台补。
   **没有 API Key 时相机必须完全可用**:曾经这里是一个整页 `return`,导致没配 Key 就等于一块砖,
   违背了"相机是独立能力"的设计。任何"前置拦截"都要警惕这一点
4. **只做竖屏** —— 界面已锁竖屏,新界面不必再考虑横屏布局
5. **空态、错态必须有明确文案** —— 不允许白屏或"转圈到永远"

建议卡片的可见性规则(`suggestion-card.tsx`):

1. **有错误** → 显示错误卡(重试 / 设置)
2. **没有错误且自动分析关闭** → 不渲染
3. 其余情况 → 正常显示建议 / 分析中 / 暂停

「换一条」在卡片**右上角**(和维度标签同一行),没有底部 footer。

**卡片与专业面板互斥**:面板一展开就收起卡片。曾经两者同时显示,
半透明面板下面的卡片文字会透上来,截图看起来像渲染错乱。

---

## 四、架构要点

### 4.1 没有后端

```
手机 App ──HTTPS──▶ api.deepseek.com
   └─ API Key 加密存在设备 Keystore / Keychain
```

- API Key **不在安装包里**,首次使用在设置页填入
- 任何"把 Key 写进代码/打包进 APK"的做法都是错的
- 早期还有一个局域网代理(`server/`),已在早期版本清理删除;git 历史里仍可找回。
  若以后要做"服务器托管 Key",把设置页的「接口地址」指向自己的服务即可

### 4.2 状态分布

| 数据 | 存放 | 实现 |
| --- | --- | --- |
| 用户设置 | AsyncStorage | `src/data/settings.ts` + `useSettings()` |
| API Key | SecureStore(加密) | `src/data/secure-key.ts` + `useApiKey()` |
| 刚拍的照片 / 点评状态 | 内存 | `src/data/capture-store.ts` |
| 拍照历史 | AsyncStorage + 文档目录 | `src/data/history.ts` |

三处都用 `useSyncExternalStore` 订阅,保存后相关页面自动刷新,**不要在各页面各存一份副本**。

### 4.3 图像的两条路径

```
拍摄 quality 0.9 ──▶ 原文件(完整分辨率)
                     ├─ 存相册            ← 原文件
                     ├─ 复盘页显示         ← 原文件
                     └─ 后台缩到长边 1280  ← 临时文件,只送模型
```

送模型的图缩小是因为**服务端本来就会把图缩到约 1300×1300**;上传原图纯属浪费带宽。
缩图逻辑在 `src/infra/analysis-image.ts`。

### 4.4 AI 调用参数

| 场景 | 思考强度 | max_tokens | detail |
| --- | --- | --- | --- |
| 取景建议(每 3 秒) | `disabled`(固定) | 400 | high |
| 拍后点评 · 快速模式开 | `disabled` | 600 | high |
| 拍后点评 · 快速模式关 | `high` | 3000 | high |

取景建议**不许**跟随用户设置走高思考强度——3 秒刷一次,一旦被推理拖住就彻底失去意义。

`temperature: 0.2` —— 打分要可复现,同一张图重复点评不应大幅波动。

### 点评的诚实性(别让 AI 硬找茬)

拍后点评要求模型**先判断再输出**,`verdict` 三档:

| verdict | 含义 | 分数段 | 改进项条数 | params |
| --- | --- | --- | --- | --- |
| `keep` | 很好,几乎不用改 | ≥85 | 0~1 | **不给** |
| `tweak` | 不错,可以更好 | 60~85 | 1~2 | 可选 |
| `reshoot` | 有明显问题 | <60 | 2~3 | 可选 |

解析层会做兜底(`__normalize`):verdict 与分数矛盾时以分数为准;`keep` 时
**强制截断改进项到 1 条、丢弃 params**,防止"说很好又挑三拣四"。
另有 `strengths`(1 条做得好的地方),让点评有平衡感。

**点评会带上"快门前的最后一条建议"**(`withLastSuggestion`),让模型评估用户有没有照做、
效果如何 —— 否则取景和点评两段各说各话,用户会觉得前后矛盾。
没有建议时(断网、关闭自动分析)这段不会拼进去。

### "可以拍了"只是提示,不是闸门

取景建议带 `readyToShoot` 字段。为 true 时快门圈变绿并轻震一次。

**关键约束:它绝不能成为拍照的前置条件。**
- 断网、没有 Key、AI 出错、自动分析关闭 → 一律为 false,但**快门照常可用**
- 不做"必须等到绿色才能拍"这类拦截 —— 那样断网时 App 就退化成一块砖
- 震动只在 false→true 的边沿触发一次,避免反复闪烁骚扰

### 语音播报(expo-speech)

- **默认关闭**(`settings.voiceGuide = false`)。户外/公共场合出声会打扰别人,必须用户主动开
- 播报内容:`readyToShoot` 时说 headline(通常是「可以拍了」),否则说 action(具体动作)
- 只在 `focused && appActive && voiceGuide` 时出声;离开页面或退到后台立即 `Speech.stop()`
- 用 `lastSpokenRef` 去重:同一句话不重复读
- 开始播报前先 `Speech.stop()`,避免两句叠在一起

**播报期间冻结取景建议**(`speakingRef`):不发新请求、不换卡片文字。

> 为什么必须冻结:一句中文播报要 4~5 秒,而分析间隔最短 3 秒。
> 不冻结的话每条建议都会被下一轮顶掉,用户听到的是半句话,
> 而且**听到的内容和卡片上看到的内容不一致**,比不说更糟。
>
> 冻结后节奏是:**念完 → 立刻补一次分析 → 出新建议 → 念新的**,
> 代价是刷新变慢(约 6~8 秒一轮),换来"听到的=看到的"。
>
> **语音模式下「自动分析间隔」这个设置不生效**,设置页会把它置灰并显示「由语音节奏决定」。
> 与其让用户设了没效果,不如直接说明白。定时器在语音模式下退化成 10 秒一次的兜底,
> 真正的节奏由播报驱动。

播报结束(含兜底超时)立刻调 `runLiveAnalysis()`,不干等下一个间隔。
兜底超时 = `文字长度 × 220ms + 2500ms`(上限 15 秒),防止某些 TTS 引擎不回调
`onDone` 导致标记永久卡住、再也不分析。

**补跑有最小间隔** `VOICE_MIN_ANALYZE_GAP_MS = 1500`:某些情况下 TTS 会瞬间回调 `onDone`
(没装语音包、引擎报错),不设下限就会变成"分析→秒回→立刻再分析"的连续请求。

用户点「换一条」会先 `stopSpeaking()` 打断播报,不冻结。

### 历史统计(零 AI 成本)

`src/domain/guidance/history-stats.ts` 里的 `computeHistoryStats()` 是**纯函数**:
平均分、最高分、verdict 分布、最常出问题的维度、最近 7 天每日均分。

这些数据本来就在本地,**不要再为统计去调一次模型**。
没有照片的那天在趋势里占位为空,避免图表跳格。

### 4.5 拍摄参数从哪来

自研相机通过 `TotalCaptureResult` **实时回报**当前 ISO / 快门 / 对焦位置(约 400ms 一次),
静态光学信息(焦距、光圈、ISO 范围、快门范围)由 `getCapabilities()` 一次取回。

这些组成了送模型的 `meta`,贯穿三处:

- 拼进 prompt(`withMeta`),且要求"参数正常就别硬提"
- **相机页只在「专业」面板顶部显示**实时值(`ISO 320 · 1/60s`,手动时加 `· 手动`)
  —— 顶栏那行参数已经删掉,给控件腾位置
- 复盘页显示一行,由设置项「参数建议」控制开关

**AI 返回的 `params` 可以一键应用**:复盘页点「应用参数并重拍」→ 存进 `pendingAdjust`
→ 回到相机页在就绪事件里合并下发。合并规则是"AI 提到哪个轴就改哪个轴",
其余轴保持当前状态,并在下发前按硬件范围 clamp。

---

## 五、并发与锁

拍照与抓帧现在由原生层各自处理,JS 侧只负责不重复触发:

- 分析中用 `analyzeBusyRef`,拍照用 `captureBusyRef`,两者独立
- 拍照时分析循环跳过;`reviewSeq` 自增用于丢弃上一张迟到的点评
- 抓帧用 `grabPreview()`(读 TextureView 当前帧),与 `takePicture()` 互不阻塞

> 早期版本用一个 `busyRef` 同时管两件事,导致**分析那 1~2 秒里按快门被静默吞掉**,
> 而按钮看起来还是可点的。改这块务必保持"锁相机不锁网络"。

---

## 六、相机:自研 Camera2(重要)

主界面的相机**不是 expo-camera**,而是项目内自研的 Camera2 实现。

源码在 **`modules/camera2/`** —— 一个**本地 Expo Module**,由 Expo autolinking 自动接入
(Gradle 工程名 `aiguide-camera2`)。不需要手动注册、不需要同步脚本。

```bash
# 改完 Kotlin 直接构建即可,autolinking 会带上
scripts/build.sh assembleRelease
# 模块自己的单元测试
scripts/build.sh :aiguide-camera2:test
```

### 为什么自研

| 方案 | 结果 |
| --- | --- |
| `expo-camera` | CameraX 高层封装,**不暴露任何曝光控制**,只能缩放/闪光 |
| `react-native-vision-camera` 5.x | 能编译,但 nitro 桥在 RN 0.88 上属性全返回默认值(设备名 `CameraDevice`、ISO 恒为 0),**运行时不可用**(已从依赖中移除) |
| **自研 Camera2**(当前) | 完全可控:手动 ISO / 快门 / 对焦 / 白平衡全部验证通过 |

设备能力:该机为 `LEVEL_3`,支持 `MANUAL_SENSOR` / `MANUAL_POST_PROCESSING`,
实测 ISO 100~800、快门 1s~1/38460s、f/1.6、等效约 23mm、单后摄(无光学变焦)。

### 结构

```
modules/camera2/                       本地 Expo Module(已入版本控制)
├── expo-module.config.json            注册 Camera2Module
├── package.json
└── android/
    ├── build.gradle
    └── src/
        ├── main/java/com/aiguide/photograph/camera/
        │   ├── Camera2Engine.kt       会话/预览/拍照/手动参数/实时参数回报
        │   ├── Camera2View.kt         ExpoView + TextureView,抓预览帧
        │   ├── Camera2Module.kt       JS 入口:方法 + 事件 + View 定义
        │   ├── Camera2Bus.kt          引擎 ↔ Module 的事件中转
        │   └── CameraMath.kt          纯计算(方向公式/尺寸选择),有单测
        └── test/.../Camera2MathTest.kt

（调试用的「相机能力探测」「白平衡标定」两个页面及其原生探针模块已移除,
见 TODO.md——需要时从 git 历史恢复）
```

**JS 门面**在 `src/infra/camera/native-camera2.ts`,应用只依赖这一层;它负责优雅降级
(模块不存在时给可读错误),并由 `__tests__/native-camera2.contract.test.ts` 锁死契约。

### 关键实现约定

- **手动曝光必须同时给 ISO 和快门**,只给一个会退回自动(`CONTROL_AE_MODE=OFF` 需要两者)
- 每轴设置前先查 `CONTROL_AE/AF/AWB_AVAILABLE_MODES`,不支持就跳过该轴,**不能让整个预览失败**
- 参数组合被拒时**退回基础预览请求**,保证永远有画面
- **离开页面必须释放相机**:预览按 `focused && appActive` 门控挂载;`destroy()` 要处理
  "打开过程中就退出"的竞态,否则相机会被漏在打开状态,导致别的页面一直黑屏
- **App 退到后台时系统会禁用相机**(`ERROR_CAMERA_DISABLED = 3`)。必须用 `AppState` 监听
  前后台,后台就卸载预览;只在 `useFocusEffect` 里判断路由焦点是不够的
- **回前台瞬间相机服务可能还没恢复**:`cameraManager.cameraIdList` 会是空的、
  甚至直接抛异常。这是正常现象,**必须等待重试**(500ms × 12 次),
  不能当成"没有相机"直接 `onError` 放弃——那样预览会一直黑屏
- 后台期间在途的网络请求会超时/挂起,它们的失败**不是真故障**:
  `catch` 里要检查当前是否在前台,否则会留下红字;连续失败计数也要在回前台时清零
- 抓帧分析用 `grabPreview()`(读 TextureView 当前帧),比拍全尺寸再缩图快得多,
  而且**送模型的就是用户看到的画面**

### 方向与旋转(踩过大坑,务必先读)

**这台设备的相机管线会自己按屏幕方向摆正预览,不需要任何补偿。**

- 预览:永远 `rotation = 0`。任何"补偿"都会把画面转歪
- 照片:`JPEG_ORIENTATION = (传感器角度 + 设备角度) % 360`（前置用减号,未实测）
  - 竖拍 `(90+0)=90`、横拍 `(90+270)%360=0`,均已实测通过
- 设备方向传感器的读数和直觉相反:**手机逆时针转 90°,它报 270°**
- **不要再依据窗口方向(`Display.getRotation`)做任何旋转**——按锁定按钮时窗口会变而手机没变

> 排查建议:遇到方向问题,先做一个能**当场切换角度**的调试开关,让设备给出答案,
> 不要靠读文档推断。这一轮因为反复推断,在方向问题上浪费了好几轮迭代。

### 镜像语义(前后置不一致,容易搞混)

| | 预览 | 照片 | 为什么 |
| --- | --- | --- | --- |
| **后置** | 不镜像 | 不镜像 | 真实方向,无歧义 |
| **前置** | **镜像**(像照镜子) | **镜像**(与预览一致) | 用户要求"所见即所得";JPEG 只带旋转不带镜像,所以在 `analysis-image.mirrorForFront` 里补一次 |

- **预览不要做任何镜像补偿**:这台设备的前置预览本来就是镜像的(相机管线做的),
  而 `SurfaceTexture.getTransformMatrix()` 的行列式**不反映**这个镜像 —— 试过按行列式判断,
  结果把预览翻成了"不镜像",反而和照片又不一致。所以预览保持原样,只补照片
- **已知代价**:前置拍文字(菜单 / 路牌 / 书页)时照片里的字是反的 —— 这是选择
  "前置所见即所得"的结果,不是 bug。若将来要改,改成"预览不镜像"才能彻底避免
- 分析用的取景帧(`grabPreview`)取的就是预览画面,**所以 AI 看到的和照片一致**,
  左右方向的建议不会反
- ⚠️ **跨机型未经验证**:上述结论来自一台设备。若别的机型前置预览本身不镜像,
  照片会多翻一次 —— 检测方案见 TODO.md(已明确推迟)

### 预览取景与实际照片的一致性

相机预览不能随便"铺满"——屏幕比例和传感器比例不同,铺满必然裁切。

- **预览流和拍照流都用传感器原生比例(4:3)**,`chooseSizes` 按 `activeArray` 选,不按屏幕比例
- JS 把预览视图做成**精确 4:3**(`previewRect`),原生 `fitPreview` 在"视图比例 == 画面比例"时
  **直接 match_parent 铺满、不缩放**;只有比例不一致时才退回 contain 兜底

> ⚠️ **视图尺寸 ≠ 画面尺寸**(2026-11 踩过,查了好几轮):
> `fitPreview` 曾按 buffer 像素尺寸布局再整体缩放 0.875,画面缩在视图中间、四周留 21~28dp 黑边。
> 网格是按**视图**画的,于是看起来"网格超出预览",实际是**画面没填满视图**。
> 教训:**位置/尺寸对不上时,先让设备把"视图尺寸"和"画面尺寸"都报出来**,不要从截图反推
> (曾在截图里把场景边缘误当成网格线,连续得出错误结论)。
- **照片不裁切**:4080×3072 全画幅,所见即所得由"两条流同比例 + 都不裁"保证
- 裁切相关代码(`cropToAspect` / `computeCropBox` / `crop-geometry.test.ts`)已删除,
  需要时 `git show v0.0.5:src/infra/analysis-image.ts`
- 选流与裁切区域已抽成纯函数 `CameraMath.captureFor` / `CameraMath.zoomCrop`,**有 Kotlin 测试**

> ⚠️ **为什么不能请求 20:9 这类非原生比例的流**(踩过三轮坑,结论写在这里):
> 传感器是 4:3,要变成 20:9 必须由 HAL 决定"裁哪一块"或"怎么拉伸",**各厂实现不同**。
> 实测这台设备:请求 20:9 后预览流和拍照流取景差 **1.328 倍**(正好等于 4:3 的宽高比),
> `SCALER_CROP_REGION` 下了也管不住预览流。
>
> 期间试过三种错误方向,都失败了:JS 里给比例取倒数、原生改 `fitPreview` 的缩放基准、
> 原生给两条流统一 crop region。**真正的问题是"不该请求非原生比例"**。
> 换任何设备,4:3 → 4:3 都不需要 HAL 做特殊处理,所以这个方案是跨机型安全的。

### 其他相机相关约束

- 抓帧频率别贪高,3 秒一次足够,再快明显发热
- 水平仪用的是加速度计(`src/hooks/use-tilt.ts`),**横竖握要换轴**:
  `|x|≥|y|` 时用 `atan2(y,|x|)`,否则 `atan2(x,|y|)`。写死竖屏公式会在横屏下算错
- **界面锁定竖屏**(当前做法)。三处一起锁,缺一不可:
  1. `app.json` 的 `orientation: portrait` —— **prebuild 时**生成清单用
  2. `android/app/src/main/AndroidManifest.xml` 的 `android:screenOrientation="portrait"`
     —— 已生成工程里的实际生效值(改 `app.json` 不会自动同步,要重新 prebuild 或手改)
  3. `src/app/_layout.tsx` 启动时 `ScreenOrientation.lockAsync(PORTRAIT_UP)`
     —— 兜底,防止系统"自动旋转"把界面转走

  横屏布局已删除。
  原因:横屏下相机预览的角度/比例反复出问题,而拍照方向由设备朝向单独决定、不受界面影响,
  所以锁竖屏不影响横拍照片的正确性。**重新引入横屏前先读这一节。**

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
npx eslint src __tests__ --ext .ts,.tsx   # lint

npm test                   # JS 单元测试(jest)
npm run test:android       # Kotlin 单元测试(gradle :app:test)
npm run test:all           # 两者都跑
```

**提交前必须过类型检查、lint 和测试。** `npx expo lint` 在当前环境会误报版本错误,直接用 `npx eslint`。

### 测试策略

| 层 | 位置 | 覆盖什么 |
| --- | --- | --- |
| JS 单元 | `__tests__/*.test.ts` | 纯逻辑 + **JS↔原生契约** |
| Kotlin 单元 | `modules/camera2/android/src/test/` | 方向公式、尺寸选择等纯计算 |
| 手工回归 | [docs/REGRESSION.md](./docs/REGRESSION.md) | 相机行为(必须真机) |

**最重要的那组是 `__tests__/native-camera2.contract.test.ts`**:它锁死了 JS 调原生模块的
方法名、参数顺序、事件名和降级行为。重构相机模块(例如改成 Expo Module)时,
只要这组测试还绿,JS 调用面就没变。

Kotlin 测试源码放在 `modules/camera2/android/src/test/`,直接跑
`scripts/build.sh :aiguide-camera2:test`(工程名来自 autolinking)。

**相机尺寸选择与裁切区域必须有 Kotlin 测试**(`CameraMath.captureFor` / `zoomCrop`):
这两条公式决定"预览和照片是否一致",而错了只能靠真机对比发现 ——
2026-11 那轮因为没有测试,在错误方向上改了三次原生代码才定位到根因。

---

## 九、本地 Android 构建

### 产物路径

| 用途 | 路径 |
| --- | --- |
| 原始产物 | `android/app/build/outputs/apk/release/app-release.apk` |
| 对外分发副本 | `assets/apk/ai-guide-photo-v<version>.apk`(该目录已 gitignore) |

包名 `com.aiguide.photograph`,arm64-v8a,APK Signature Scheme v2 签名。

### 重新打包(**每次都要升版本号**)

统一用发布脚本,它会把版本号写进两个地方再构建:

```bash
npx tsc --noEmit && npx eslint src --ext .ts,.tsx   # 先过类型和 lint
scripts/release.sh 0.0.2                          # 版本号自增
# 产出:assets/apk/ai-guide-photo-v0.0.2.apk
```

**命名规范**:`ai-guide-photo-v<主>.<次>.<修>.apk`,版本号只增不减。

**versionCode 规则**:`主 × 10000 + 次 × 100 + 修`
(1.0.0 → 10000,1.2.3 → 10203)。已装应用靠它判断升级。

> ⚠️ **必须改两处,改一处没用**:
> - `app.json` 的 `expo.version`(`android.versionCode`)——Expo 侧事实来源
> - `android/app/build.gradle` 的 `versionCode` / `versionName`——**prebuild 之后 Gradle 只认这里**
>
> 只改 `app.json` 打出来的包版本号不会变。`release.sh` 已经处理了这件事。

只需验证能否编译而不出包时,可以用 `scripts/build.sh assembleDebug`。

- 首次构建约 12 分钟(C++ 要为 5 个原生模块各编一遍 arm64),**增量 20 秒~4 分钟**
- `build.sh` 会自动导出 `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME` / `ANDROID_USER_HOME`

### 构建脚本与工具链

**脚本入库**(`scripts/`),**工具链不入库**(`.toolchain/`):

```
scripts/build.sh      构建入口,自动定位 JAVA_HOME / ANDROID_HOME
scripts/release.sh    同步版本号 + 构建 + 命名产物

.toolchain/           ← gitignore,只有本仓库维护者有
├── jdk17/            OpenJDK 17
├── android-sdk/      SDK 36 / build-tools 37 / NDK 27.1.12297006 / CMake
├── gradle-home/      Gradle 缓存 + 阿里云镜像
├── android-user-home/  替代 ~/.android(沙箱不可写时用)
└── keys/aiguide.keystore   Release 签名密钥(千万别提交)
```

`scripts/build.sh` 的查找顺序:**已导出的环境变量 → 项目内 `.toolchain/` → 系统 JDK/SDK**。
所以别人克隆后只需装 JDK 17 + Android SDK,不必有 `.toolchain/`。

`android/` 由 `npx expo prebuild` 生成,已在 gitignore 中。

### 三个必须知道的构建约束

1. `ANDROID_USER_HOME` 与 `ANDROID_PREFS_ROOT` **不能同时设置**,只保留前者
2. Gradle 依赖必须走阿里云镜像(官方源 127KB/s,镜像 1.4MB/s)
3. 相机代码在 `modules/camera2/`,**不受 prebuild 影响**。
   项目里已没有需要手动同步进 `android/` 的原生代码
4. **`prebuild --clean` 还会冲掉三处手工修改**,重建后要重新应用:
   - `android/gradle.properties`:`jvmargs` 提到 4G、`reactNativeArchitectures=arm64-v8a`、
     `android.enableMinifyInReleaseBuilds=false`
   - `android/app/build.gradle`:新增 `signingConfigs.release` 并让 release buildType 使用它
   - `android/gradle/wrapper/gradle-wrapper.properties`:`distributionUrl` 指向本地 zip

> ⚠️ **`.toolchain/keys/aiguide.keystore` 是签名密钥,丢了之后无法覆盖升级已安装的 App**
> (只能卸载重装,用户设置全丢)。密码写在 `android/app/build.gradle`。

---

## 十、已知遗留

- `expo-camera` / `expo-image` 已移除;相机权限改用 RN 内置 `PermissionsAndroid`,
  见 `src/hooks/use-camera-permission.ts`
- 白平衡已改为「CCT → 普朗克轨迹色度 → 用相机自己的 `SENSOR_COLOR_TRANSFORM1` 求逆换到传感器 RGB → 取倒数」,
  不再假设 sRGB 原色。增益夹在 0.35~2.8。仍缺真机标定,极端色温(2500K/8000K)可能仍偏
- 点评已加 `verdict` 三档并与分数自洽(`keep` 会强制丢弃 `params`),
  但**真实照片下的效果还没验证过**——见 TODO.md
- iOS 完全未验证(没有真机,模拟器相机不可用)
- 拍照历史已实现(`src/data/history.ts` + `src/app/history.tsx`):照片存文档目录,
  **按自然日保留最近 7 天**,列表按天分组;过期条目在启动和每次拍照时清理(含照片文件)
- 评分可复现性:已加打分锚点 + `temperature: 0.2` + prompt 明确要求一致,
  **仍待真实照片验证**
- 鸿蒙 NEXT 未支持

---

## 十一、规则

- **提交与推送必须先获得明确授权(最高优先级)**
  - 改完代码先汇报「改了什么 + 验证结果」,**等用户明确说可以**,再 `git commit` / `git push`
  - **不要因为改动小、或之前允许过,就默认这次也可以** —— 每次都要问
  - `commit` 和 `push` 是两件事:同意提交不等于同意推送,除非用户一次说清
  - 打 tag、发 release、改仓库设置、关闭 PR 同理,全部先问
  - 用户说「先别提交/别打 tag」时,改完就停在工作区,不要自行收拾
- **新增原生行为优先用 config plugin**(`app.json` 的 `plugins`),不要手改 `android/`。
  例外只有签名和 Gradle 参数这类插件表达不了的,清单见第九节。
- 加带原生代码的库之后,Expo Go 就跑不了了,需要重新打包。
- 优先用 Expo 官方模块,第三方库先确认在 Expo Go 里可用。
- 提交前跑类型检查和 lint。
- **不要随手打 tag**。tag = 正式发版 = CI 构建 + 生成 Release + 消耗版本号。
  自己验证改动用 `scripts/dev-build.sh`(产物 `assets/apk/ai-guide-photo-dev.apk`),版本号和 Releases 都不受影响。
- 改 UI 前读第三节的交互原则;改相机/并发前读第四、五、六节。
