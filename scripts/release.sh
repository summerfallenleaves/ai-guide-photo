#!/usr/bin/env bash
# 一键发布:同步版本号 → 构建 → 产出命名好的 APK
#
# 用法: scripts/release.sh 0.0.2
#
# versionCode 规则: 主 * 10000 + 次 * 100 + 修  (1.0.0 -> 10000, 1.2.3 -> 10203)
set -eu

VERSION="${1:?用法: scripts/release.sh 0.0.2}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "版本号格式应为 X.Y.Z,收到:$VERSION" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IFS=. read -r MAJ MIN PATCH <<< "$VERSION"
CODE=$(( MAJ * 10000 + MIN * 100 + PATCH ))

echo "==> 版本 $VERSION  versionCode $CODE"

# 1. app.json(Expo 侧事实来源)
node -e "
const fs=require('fs');
const p='app.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.expo.version='${VERSION}';
d.expo.android=d.expo.android||{};
d.expo.android.versionCode=${CODE};
fs.writeFileSync(p, JSON.stringify(d,null,2)+'\n');
"

# 2. android/app/build.gradle(prebuild 之后 Gradle 只认这里)
GRADLE_FILE="android/app/build.gradle"
if [ ! -f "$GRADLE_FILE" ]; then
  echo "找不到 $GRADLE_FILE,先跑:npx expo prebuild -p android" >&2
  exit 1
fi
sed -i.bak -E "s/^([[:space:]]*versionCode[[:space:]]+)[0-9]+/\1${CODE}/" "$GRADLE_FILE"
sed -i.bak -E "s/^([[:space:]]*versionName[[:space:]]+)\"[^\"]*\"/\1\"${VERSION}\"/" "$GRADLE_FILE"
rm -f "$GRADLE_FILE.bak"

grep -qE "versionCode ${CODE}$" "$GRADLE_FILE" || { echo "versionCode 写入失败" >&2; exit 1; }
grep -qE "versionName \"${VERSION}\"$" "$GRADLE_FILE" || { echo "versionName 写入失败" >&2; exit 1; }

# 3. 构建
LOG="$ROOT/.release.log"
if ! "$ROOT/scripts/build.sh" assembleRelease > "$LOG" 2>&1; then
  echo "构建失败,错误摘要:" >&2
  grep -E "^e: |error:|What went wrong" "$LOG" | head -12 >&2
  echo "(完整日志:$LOG)" >&2
  exit 1
fi

# 4. 产出并校验
OUT="assets/apk/ai-guide-photo-v${VERSION}.apk"
mkdir -p assets/apk
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"

AAPT2=""
for candidate in \
  "${ANDROID_HOME:-}/build-tools/"*/aapt2 \
  "$ROOT/.toolchain/android-sdk/build-tools/"*/aapt2; do
  [ -x "$candidate" ] && AAPT2="$candidate"
done

echo
echo "==> $OUT"
if [ -n "$AAPT2" ]; then
  "$AAPT2" dump badging "$OUT" 2>/dev/null | head -1
else
  echo "    (未找到 aapt2,跳过版本校验)"
fi
