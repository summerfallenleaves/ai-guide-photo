# AI 拍照引导

举起手机取景时,实时告诉你"该往哪挪、该蹲多低、光在哪边",按下快门后再给一次复盘。

产品定义与决策记录见 [REQUIREMENTS.md](./REQUIREMENTS.md)。

## 现在是什么状态

这是一个跑在你**真实 Android 手机**上的 MVP,不是网页 demo:

- ✅ 相机实时预览 + 三分线 + **实时水平仪**(端侧加速度计,零延迟)
- ✅ 每 3 秒自动抓帧 → 本地代理分析 → 一条可执行建议
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

## 三步跑起来

### 1. 填 API Key

```bash
cp server/.env.example server/.env
# 编辑 server/.env,填入 DEEPSEEK_API_KEY
```

> 不填也能跑,只是所有建议都会变成"本地规则"版本(只能判断明暗、对比度)。

### 2. 启动本地代理

```bash
npm run server
```

看到 `✅ 已接入 DeepSeek` 就对了。默认端口 `8787`。

### 3. 启动 App

```bash
npm start
```

手机装 **Expo Go**(应用商店搜),和电脑连**同一个 Wi-Fi**,扫终端里的二维码。

App 会自动从 Expo 的 `hostUri` 推导出电脑的局域网 IP,不需要你手动填地址。

## 常见问题

**「连不上本地代理」**

- 手机和电脑必须在同一 Wi-Fi(公司网络常见 AP 隔离,会拦住)。
- 检查电脑防火墙是否放行 8787 端口。
- 兜底:在项目根目录建 `.env.local`,写入 `EXPO_PUBLIC_API_URL=http://<电脑IP>:8787`。

**为什么相机画面没有快门动画?**  
`animateShutter` 已关掉——因为每 3 秒要静默抓一次帧做分析,开着会一直响。

**为什么抓帧比实际画面慢半拍?**  
`expo-camera` 不提供预览帧流,只能"拍一张低质量快照"来拿数据。真正的逐帧实时需要 `react-native-vision-camera` + 自定义 dev client,留到下一阶段。

**拍的照只有 70% 画质?**  
MVP 为了同时拿到"存相册的文件"和"送去分析的 base64",用了一次拍摄、质量 0.7。后续拆成两次拍摄可恢复原画质。

## 直接在自己电脑上验接口

```bash
curl http://localhost:8787/health
```

## 下一步

见 REQUIREMENTS.md 的 P0 清单。按优先级:真实照片调优 → 建议质量 → 鸿蒙 POC。
