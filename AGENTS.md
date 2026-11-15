This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

> ⚠️ **本项目不走 EAS**,没有配置 `eas.json`。Android 用本地构建,见下一节。

## 本地 Android 构建(已配好,直接用)

### 产物路径

| | 路径 |
| --- | --- |
| 原始产物 | `android/app/build/outputs/apk/release/app-release.apk` |
| 对外分发副本 | `assets/apk/ai-guide-photo-v<version>.apk`(该目录已 gitignore) |

包名 `com.aiguide.photograph`,arm64-v8a,APK Signature Scheme v2 签名。

### 重新打包

```bash
npx tsc --noEmit && npx eslint src --ext .ts,.tsx   # 先过类型和 lint
.toolchain/build.sh assembleRelease                 # 打包
```

- 首次构建约 12 分钟(C++ 要为 5 个原生模块各编一遍 arm64),**增量 2~4 分钟**
- 只想出 APK 不做 release 签名时可用 `assembleDebug`
- `build.sh` 会自动导出 `JAVA_HOME` / `ANDROID_HOME` / `GRADLE_USER_HOME` / `ANDROID_USER_HOME`,无需手动设置

### 工具链位置

工具链**全部在项目内**,不写系统目录(沙箱只允许写工作区,这也是当初不用系统 JDK/SDK 的原因):

```
.toolchain/
├── jdk17/                    OpenJDK 17
├── android-sdk/              compileSdk 36 / build-tools 37.0.0 / NDK 27.1.12297006 / CMake
├── gradle-home/              Gradle 9.4.1 缓存 + init.d/aliyun-mirrors.gradle(国内 Maven 镜像)
├── android-user-home/        替代 ~/.android
├── keys/aiguide.keystore     Release 签名密钥
├── downloads/                各组件压缩包(可删)
└── build.sh                  构建入口
```

`android/` 由 `npx expo prebuild` 生成,已在 gitignore 中。

### 构建时踩过的坑(改之前务必先读)

1. **`ANDROID_USER_HOME` 与 `ANDROID_PREFS_ROOT` 不能同时设置**,即使值相同 AGP 也会报
   `Several environment variables contain different paths`。只保留 `ANDROID_USER_HOME`。
2. **不要让它去写 `~/.android`**,会因沙箱 `Operation not permitted` 失败;`build.sh` 里已重定向。
3. **Gradle 依赖必须走阿里云镜像**(`maven.aliyun.com` 约 1.4MB/s,官方源仅 127KB/s),
   配置在 `.toolchain/gradle-home/init.d/aliyun-mirrors.gradle`。
4. **`android/` 若被 `prebuild --clean` 重建,以下手工修改会丢失,需要重新应用**:
   - `android/gradle.properties`:`jvmargs` 提到 4G、`reactNativeArchitectures=arm64-v8a`、
     `android.enableMinifyInReleaseBuilds=false`
   - `android/app/build.gradle`:新增 `signingConfigs.release` 并让 `release` buildType 使用它
     (默认模板用的是调试密钥,不能用于正式分发)
   - `android/gradle/wrapper/gradle-wrapper.properties`:`distributionUrl` 指向本地 zip
5. **签名密钥 `keys/aiguide.keystore` 丢失后无法覆盖升级已安装的 App**(只能卸载重装),
   密码写在 `android/app/build.gradle` 里。请勿删除 `.toolchain/keys/`。

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
  **本项目的例外**:`android/` 里有两处必须手改的构建配置(release 签名、gradle 参数),清单见上面「构建时踩过的坑」第 4 条。新增原生配置优先用 config plugin;只有签名这类无法用插件表达的才手改。
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
