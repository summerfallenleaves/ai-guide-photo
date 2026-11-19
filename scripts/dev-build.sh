#!/usr/bin/env bash
# 本地测试包:只构建,不碰版本号、不打 tag、不发 release。
#
# 用法:
#   scripts/dev-build.sh              # 用当前版本号构建
#   scripts/dev-build.sh assembleDebug
#
# 产物:assets/apk/ai-guide-photo-dev.apk(固定文件名,永远是最新一次构建)
#
# 为什么需要它:正式发版要 `scripts/release.sh <版本>` + 打 tag + 走 CI,
# 那是给外部用户的。自己验证一个改动不该消耗版本号,也不该在 Releases 里多一条记录。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./app.json').expo.version")"
echo "==> 本地测试构建(版本 $VERSION,不发版)"

"$ROOT/scripts/build.sh" "${@:-assembleRelease}"

SRC="$ROOT/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$SRC" ]; then
  SRC="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
fi
[ -f "$SRC" ] || { echo "找不到构建产物" >&2; exit 1; }

mkdir -p assets/apk
OUT="assets/apk/ai-guide-photo-dev.apk"
cp "$SRC" "$OUT"

echo
echo "==> $OUT  ($(du -h "$OUT" | cut -f1),版本 $VERSION)"
echo "    这个包仅供本机验证,不要上传到 Release"
