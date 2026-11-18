#!/usr/bin/env bash
# 构建 Android APK
#
# 用法:
#   scripts/build.sh                     # 等同 assembleRelease
#   scripts/build.sh assembleDebug       # 只验证能否编译
#   scripts/build.sh :aiguide-camera2:test   # 跑相机模块的 Kotlin 单测
#
# 工具链查找顺序:
#   1. 已导出的环境变量(JAVA_HOME / ANDROID_HOME / GRADLE_USER_HOME)
#   2. 项目内的 .toolchain/(仓库维护者用的离线工具链,不入库)
#   3. 系统已装的 JDK / Android SDK
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="$ROOT/.toolchain"

if [ -z "${JAVA_HOME:-}" ] && [ -d "$TC/jdk17/Contents/Home" ]; then
  export JAVA_HOME="$TC/jdk17/Contents/Home"
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$TC/android-sdk" ]; then
  export ANDROID_HOME="$TC/android-sdk"
fi
export ANDROID_SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "${GRADLE_USER_HOME:-}" ] && [ -d "$TC/gradle-home" ]; then
  export GRADLE_USER_HOME="$TC/gradle-home"
fi
# AGP 默认把分析数据写到 ~/.android;容器/沙箱里可能不可写,有本地目录就用本地
if [ -z "${ANDROID_USER_HOME:-}" ] && [ -d "$TC/android-user-home" ]; then
  export ANDROID_USER_HOME="$TC/android-user-home"
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}${ANDROID_HOME:+$ANDROID_HOME/platform-tools:}$PATH"

if [ -z "${JAVA_HOME:-}" ] && ! command -v java >/dev/null 2>&1; then
  echo "找不到 JDK。请安装 JDK 17,或设置 JAVA_HOME。" >&2
  exit 1
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  echo "找不到 Android SDK。请设置 ANDROID_HOME 指向 SDK 目录。" >&2
  exit 1
fi
if [ ! -d "$ROOT/android" ]; then
  echo "android/ 目录不存在。先跑:npx expo prebuild -p android" >&2
  exit 1
fi

echo "JAVA_HOME    ${JAVA_HOME:-<系统默认>}"
echo "ANDROID_HOME ${ANDROID_HOME:-${ANDROID_SDK_ROOT:-<未设置>}}"
echo "GRADLE_HOME  ${GRADLE_USER_HOME:-<默认>}"
echo

cd "$ROOT/android" || exit 1
exec ./gradlew "${@:-assembleRelease}"
