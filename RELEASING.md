# 发布流程

版本号规则:`主.次.修`(SemVer),对应 `versionCode = 主×10000 + 次×100 + 修`。
例:`0.0.1` → `1`,`0.1.0` → `100`,`1.2.3` → `10203`。**只增不减**。

`versionCode` 决定能不能覆盖升级已安装的 App,所以它绝不能回退。

---

## 一、正常发布(三步)

### 1. 定版本号并提交

```bash
# 本地改三处:app.json / package.json / android/app/build.gradle
# 用脚本一次改完并构建出 APK
./scripts/release.sh 0.0.2

# 产物:assets/apk/ai-guide-photo-v0.0.2.apk
```

### 2. 打 tag 并推送

```bash
git add -A
git commit -m "chore: 发布 v0.0.2"
git push

git tag -a v0.0.2 -m "v0.0.2"
git push origin v0.0.2
```

> ⚠️ `main` 有保护规则,直接推需要管理员绕过。**更规范的做法**:开分支 → PR → CI 绿 →
> squash 合并 → 在合并后的提交上打 tag。

### 3. CI 自动构建并挂到 Release

推 `v*` tag 会触发 `.github/workflows/android.yml`:

```
checkout → Node 22 → JDK 17 → Android SDK/NDK → npm ci
  → expo prebuild → 对齐版本号 → (可选)正式签名 → gradle assembleRelease
  → 上传 artifact → 挂到同名 Release
```

跑完在 **Releases** 页面就能看到 `ai-guide-photo-v0.0.2.apk`。

如果 tag 对应的 Release 还不存在,workflow 会自动创建一个。

---

## 二、签名

CI 默认用 **debug 密钥**签名 —— 能安装、能自用,**不能上架,也不能给已安装用户做覆盖升级**。

要正式签名,在仓库 **Settings → Secrets and variables → Actions** 里配 4 个 secret:

| Secret | 内容 |
| --- | --- |
| `KEYSTORE_BASE64` | keystore 文件的 base64:`base64 -i my-release.keystore \| pbcopy` |
| `KEYSTORE_PASSWORD` | store password |
| `KEY_ALIAS` | key alias |
| `KEY_PASSWORD` | key password |

配好后 `scripts/ci-signing.py` 会往 `build.gradle` 里注入 `signingConfigs.release`,
并把 release buildType 指过去。**四个都配齐才会生效**,缺一个就退回 debug 签名。

生成密钥:

```bash
keytool -genkeypair -v -keystore my-release.keystore \
  -alias mykey -keyalg RSA -keysize 2048 -validity 10000
```

> ⚠️ 密钥丢了就无法覆盖升级已安装的 App(只能卸载重装,用户数据全丢)。**多处备份。**

---

## 三、发布前检查清单

```bash
npx tsc --noEmit                        # 类型
npx eslint src __tests__ --ext .ts,.tsx # lint
npm test                                # 单元测试
./scripts/build.sh :aiguide-camera2:test  # Kotlin(动了相机模块时)
```

- [ ] CI 绿
- [ ] 真机装一次,走 [docs/REGRESSION.md](./docs/REGRESSION.md)
- [ ] `TODO.md` 更新(新跳过的项、已验证的项)
- [ ] 版本号比上一个 tag 大
- [ ] **确认没有把密钥/隐私信息提交进仓库**

---

## 四、构建产物里不该有的东西

CI 的构建路径是 `/home/runner/work/...`,不含个人信息,可以放心分发。

**本地构建的 APK 不是** —— 编译时会把本机绝对路径写进 `libappmodules.so`
(例如 `/Users/<你的用户名>/...`,来自 CMake/prefab)。所以:

- ❌ 不要把本地 `assets/apk/*.apk` 直接上传到 Release
- ✅ 用 CI 构建的产物对外分发
- 本地 APK 只用于自己调试测试

检查方法:

```bash
unzip -p assets/apk/xxx.apk lib/arm64-v8a/libappmodules.so | strings | grep "/Users/"
```

---

## 五、出问题时

| 现象 | 排查 |
| --- | --- |
| CI 卡在 `expo prebuild` | 看是不是 `app.json` 有语法错误 |
| NDK 版本不匹配 | 改 `.github/workflows/android.yml` 里的 `ndk;版本`,和 `android/build.gradle` 的 `ndkVersion` 对齐 |
| Release 里没看到 APK | 看 workflow 最后一步的日志;tag 必须形如 `v0.0.2` |
| 装的时候提示 `INSTALL_FAILED_VERSION_DOWNGRADE` | `versionCode` 比已装的小,升版本号 |
| 构建超时 | 首次构建约 12 分钟(C++ 要为每个原生模块编一遍),属正常 |

---

## 六、本地发布脚本做了什么

`scripts/release.sh <版本>`:

1. 改 `app.json` 的 `expo.version` 与 `android.versionCode`
2. 改 `android/app/build.gradle` 的 `versionCode` / `versionName`
3. 调 `scripts/build.sh assembleRelease` 构建
4. 复制成 `assets/apk/ai-guide-photo-v<版本>.apk`
5. 用 `aapt2` 校验包内版本号是否真的对

> 只改 `app.json` 没用 —— prebuild 之后 Gradle 只认 `android/app/build.gradle`。
