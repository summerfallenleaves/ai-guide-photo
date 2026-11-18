#!/usr/bin/env bash
# 调整 prebuild 生成的 android/gradle.properties。
#
# ⚠️ 不能用 echo >> 直接追加:prebuild 生成的文件末尾**没有换行符**,
# 追加会把属性拼到最后一行上(例如 `...=falsereactNativeArchitectures=arm64-v8a`),
# 导致 expo-modules-autolinking 解析配置时报 JSON 语法错误。
# 这里统一处理:先补换行,再按 key 覆盖。
set -eu

GP="${1:-android/gradle.properties}"
[ -f "$GP" ] || { echo "找不到 $GP" >&2; exit 1; }

# 1. 保证文件以换行结尾
if [ -n "$(tail -c 1 "$GP")" ]; then
  echo >> "$GP"
fi

# 2. 有就改,没有就追加
set_prop() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$GP"; then
    # 用 | 做分隔符,值里含 / 和 : 也不会出错
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "$GP"
    rm -f "${GP}.bak"
  else
    echo "${key}=${value}" >> "$GP"
  fi
}

set_prop reactNativeArchitectures arm64-v8a
set_prop org.gradle.jvmargs "-Xmx4096m -XX:MaxMetaspaceSize=1024m"
set_prop android.enableMinifyInReleaseBuilds false

echo "已调整 $GP:"
grep -E "^(reactNativeArchitectures|org\.gradle\.jvmargs|android\.enableMinifyInReleaseBuilds)=" "$GP"
