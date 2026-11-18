## 改了什么

<!-- 一两句话说明动机。如果是修 bug,贴一下现象或报错。 -->

## 怎么验证的

- [ ] `npx tsc --noEmit` 通过
- [ ] `npx eslint src __tests__ --ext .ts,.tsx` 通过
- [ ] `npm test` 通过

**动了相机相关代码(`modules/camera2/`、`src/app/index.tsx`)的话:**

- [ ] `scripts/build.sh :aiguide-camera2:test` 通过
- [ ] 真机装 APK 走过 [docs/REGRESSION.md](../docs/REGRESSION.md) 的相关小节
- [ ] 备注了机型(相机行为高度依赖硬件)

## 截图 / 录屏

<!-- UI 改动请附上,相机相关请附"预览"和"拍出来的照片"。 -->
