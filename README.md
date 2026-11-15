# AI 拍照引导

举起手机取景时,实时告诉你"该往哪挪、该蹲多低、光在哪边",按下快门后再给一次复盘。

产品定义与决策记录见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 现在是什么状态

这是一个跑在你**真实 Android 手机**上的 MVP,不是网页 demo:

- ✅ 相机实时预览 + 三分线 + **实时水平仪**(端侧加速度计,零延迟)
- ✅ **横竖屏自适应**:跟系统自动旋转,右上角 `↻` 可强制切换;横屏下控件变成右侧半透明浮动列
- ✅ 每 3 秒自动抓帧 → 本地代理分析 → 一条可执行建议
- ✅ **设置页**:快速模式(low/high 思考强度)、自动分析开关、分析间隔 3~10 秒,配置持久化
- ✅ 快门拍照 → 自动存相册 → 拍后复盘(评分 + 改进项)
- ✅ 断网/未配 Key 时自动降级为本地建议,不白屏
- ⏳ 鸿蒙与 iOS:未开始(见 REQUIREMENTS 第四节)

## 目录结构

```
src/app/           路由(Expo Router,文件即页面)
  index.tsx        相机页
  review.tsx       拍后复盘页
src/components/    构图线 / 水平仪 / 建议卡片
src/hooks/         水平仪(加速度计)
src/lib/           API 客户端、类型、配色
server/            本地代理:画面体检 + DeepSeek 视觉建议
```

## 架构:App 直连 DeepSeek,不需要任何服务器

```
手机 App  ──HTTPS──▶  api.deepseek.com
   │
   └─ API Key 加密存在手机本地(Keystore / Keychain)
```

- **不需要电脑**,不需要同 Wi-Fi,不需要部署服务器
- Key **不在安装包里**:打开 App 后到设置里填一次
- Key 只存在设备加密存储,只出现在请求头里

`server/` 目录是早期"局域网代理"方案留下的,当前**不再使用**,保留着方便以后切回
"服务器托管 Key"的形态(App 的「接口地址」填你的服务器即可)。

## 三步跑起来

### 1. 启动 App

```bash
npm start
```

终端里会出现一个二维码。**这个二维码不是网址,必须用手机上的 Expo Go 扫,用浏览器扫一定会失败。**

`exp://` 是 Expo 自定义协议,只有 Expo Go 认得;微信、夸克、系统浏览器都会把它当坏链接。

- 手机装 **Expo Go**:应用商店搜;国内没有 Google Play 就去 <https://expo.dev/go> 下 Android 版 APK
- 打开 Expo Go → 启动页选「Scan QR code」→ 扫终端二维码
- 扫码无效时,在 Expo Go 里手动输:`exp://<电脑IP>:8081`(如 `exp://<电脑IP>:8081`)

手机和电脑连**同一个 Wi-Fi**。App 会自动从 Expo 的 `hostUri` 推导出电脑的局域网 IP,不需要你手动填代理地址。

> 鸿蒙 NEXT 设备装不了 Expo Go(不兼容安卓 APK),真机调试只能用 Android 手机。

### 3. 填入 API Key

首次打开 App 会提示「还没有配置 API Key」,点「去设置」填入 `sk-...`。
保存后点「测试连接」确认可用。Key 来自 <https://platform.deepseek.com>。

## 常见问题

**「连不上本地代理」**

- 手机和电脑必须在同一 Wi-Fi(公司网络常见 AP 隔离,会拦住)。
- 检查电脑防火墙是否放行 8787 端口。
- 兜底:在项目根目录建 `.env.local`,写入 `EXPO_PUBLIC_API_URL=http://<电脑IP>:8787`。

**为什么相机画面没有快门动画?**  
`animateShutter` 已关掉——因为每 3 秒要静默抓一次帧做分析,开着会一直响。

**为什么抓帧比实际画面慢半拍?**  
`expo-camera` 不提供预览帧流,只能"拍一张低质量快照"来拿数据。真正的逐帧实时需要 `react-native-vision-camera` + 自定义 dev client,留到下一阶段。

**拍的照是什么画质?**  
存相册和复盘页显示的是**同一个原始文件**:完整分辨率、JPEG 质量 0.9。

送去模型的是**另生成的一份缩略图**(长边 1280、质量 0.85),不影响你的照片。这样做是因为 DeepSeek 服务端本来就会把图缩到约 1300×1300 再推理,上传原图纯属浪费带宽。

**控制台一直报 `getPermissionsAsync has been rejected`?**  
这是 **Expo Go 的已知限制**,不是本项目的 bug:Android 上 Expo Go 不允许查询相册权限。代码里已完全不再调用 `getPermissionsAsync` / `usePermissions`,改为"直接写入,失败才申请"。

写入本身是可用的(实测能存进系统相册)。如果以后需要读相册、建相册等完整能力,必须做 development build——Expo Go 做不到。

**建议出得慢、或者总是退回"本地"?**  
DeepSeek 的 `deepseek-flash` **默认开启思考模式且 effort=high**,会让一次调用从 ~1s 涨到 4s+,很容易撞上超时。代码里已显式传 `thinking: { type: "disabled" }`——取景建议是短结构化输出,不需要思维链。

实测(局域网,`detail: low`):取景建议 **1.0~1.8s**,拍后点评 **1.3s**。

如果还是慢,在 `server/.env` 里放宽:

```
ANALYZE_TIMEOUT_MS=20000
ANALYZE_CAPTURE_TIMEOUT_MS=40000
```

## 直接在自己电脑上验接口

```bash
curl http://localhost:8787/health
```

## 下一步

见 REQUIREMENTS.md 的 P0 清单。按优先级:真实照片调优 → 建议质量 → 鸿蒙 POC。

## 设置项与依赖关系

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| 快速模式 | 开 | 开 → 思考 `disabled`(1.6~1.8 秒);关 → `high`(3~6 秒,更细致) |
| 自动分析 | 开 | 开 → 取景时定时给建议;关 → 只在按快门后点评 |
| 自动分析间隔 | 3 秒 | 3~10 秒 |

两条级联规则(界面上会把不可用的项置灰):

```
快速模式关  →  自动分析失效(高思考强度下 3 秒一轮永远滞后)
自动分析关  →  间隔配置失效
```

思考强度由客户端按请求传给代理(`POST /api/analyze` 的 `thinking` 字段),服务端也保留 `DEEPSEEK_THINKING` 环境变量作为兜底。
