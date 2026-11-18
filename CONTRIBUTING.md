# 参与开发

感谢关注。这个项目是**一个人对着真机调出来的**,所以对"改动怎么验证"的要求比一般项目更严:
相机行为、拍照方向、预览比例这些,**只有真机能验证**,CI 只能保证 JS 层不炸。

## 环境准备

见 [README 的「从源码构建 APK」](./README.md#从源码构建-apk)。

最短路径:

```bash
git clone https://github.com/summerfallenleaves/ai-guide-photo.git
cd ai-guide-photo
npm install
npx expo prebuild -p android
./scripts/build.sh assembleRelease
```

需要 **Node 20+ / JDK 17 / Android SDK 36+ / NDK 27.1.12297006**。
Expo Go 跑不了本项目(相机是自研原生模块)。

## 提交前必须通过

```bash
npx tsc --noEmit                        # 类型
npx eslint src __tests__ --ext .ts,.tsx # lint
npm test                                # 单元测试
```

动了 `modules/camera2/` 还要跑:

```bash
./scripts/build.sh :aiguide-camera2:test
```

## 分支与提交

| 分支 | 用途 |
| --- | --- |
| `main` | 始终可构建。**不直接提交**,走 PR |
| `feat/xxx` | 新功能 |
| `fix/xxx` | 修 bug |
| `docs/xxx` | 只改文档 |

```bash
git checkout -b fix/preview-aspect
# 改代码
git commit -m "fix(camera): 预览比例按可见区域计算"
git push -u origin fix/preview-aspect
# 然后在 GitHub 上开 PR
```

提交信息用 `类型(范围): 说明`,类型 = `feat` / `fix` / `docs` / `chore` / `refactor` / `test`。

## 改相机代码前必读

[AGENTS.md](./AGENTS.md) 第六节记录了**踩过的坑**,尤其:

- 预览**永远 `rotation = 0`**,任何"补偿"都会把画面转歪
- 照片靠 EXIF 转向,**裁切必须先按 `rotation` 换算坐标轴**
- App 退到后台系统会禁用相机,回前台要等相机服务恢复(重试 12 次 × 500ms)
- 拍照**永远不能**被 AI 请求阻塞

这些不是风格偏好,是实际调试出来的结论。改动前请先读完那一节。

## 相机改动的验收标准

1. **预览和照片一致** —— 取景框里看到什么,拍出来就是什么(上下左右都不能差)
2. **竖拍横拍方向都对**
3. **杀掉进程重开,相机能正常预览**(不黑屏、不报 `ERROR_CAMERA_DISABLED`)
4. 按 [docs/REGRESSION.md](./docs/REGRESSION.md) 走一遍相关小节

PR 里请注明**测试机型**——不同厂商的 Camera2 实现差异很大。

## 文档

- 改架构/约定 → 更新 [AGENTS.md](./AGENTS.md)
- 跳过了什么、有什么待验证 → 记到 [TODO.md](./TODO.md),别只留在 PR 描述里
