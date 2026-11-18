#!/usr/bin/env python3
"""
CI 里给 expo prebuild 生成的 android/app/build.gradle 打 release 签名补丁。

为什么需要:prebuild 每次都会重新生成 build.gradle,默认让 release 用 debug 密钥签名。
CI 上通过 secrets 提供正式密钥时,用这个脚本把 signingConfigs.release 注入进去。

用法:
  python3 scripts/ci-signing.py android/app/build.gradle release.keystore

密码从环境变量读:KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD

注意:不能靠正则匹配 `buildTypes { release {`,因为 Expo 模板里 debug 在 release 前面,
正则容易匹配失败或匹配到 debug 块。这里用花括号配对精确定位。
"""
import os
import sys
from pathlib import Path

# 注意:插入点是已有 `signingConfigs {` 的内部,所以这里不带那一行
SIGNING_BLOCK = """release {
                storeFile file("__KEYSTORE__")
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            }"""


def block_body(text: str, keyword: str, search_from: int = 0) -> tuple[int, int] | None:
    """找到 `keyword {` 后返回其花括号内部的 (start, end)。配对失败返回 None。"""
    idx = text.find(keyword, search_from)
    if idx < 0:
        return None
    brace = text.find("{", idx + len(keyword))
    if brace < 0:
        return None
    depth = 0
    for i in range(brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return brace + 1, i
    return None


def main() -> int:
    if len(sys.argv) < 3:
        print("用法: ci-signing.py <build.gradle> <keystore 文件名>", file=sys.stderr)
        return 2

    gradle = Path(sys.argv[1])
    keystore = sys.argv[2]

    if not gradle.exists():
        print(f"找不到 {gradle}", file=sys.stderr)
        return 1

    for var in ("KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"):
        if not os.environ.get(var):
            print(f"缺少环境变量 {var}", file=sys.stderr)
            return 1

    text = gradle.read_text()

    if "signingConfigs.release" in text and "signingConfig signingConfigs.release" in text:
        print("已经配置过 release 签名,跳过")
        return 0

    signing = block_body(text, "signingConfigs")
    if signing is None:
        print("build.gradle 里没有 signingConfigs 块,prebuild 结构可能变了", file=sys.stderr)
        return 1

    # 1. 在 signingConfigs 块开头插入 release 配置
    if "signingConfigs.release" not in text:
        block = SIGNING_BLOCK.replace("__KEYSTORE__", keystore)
        text = text[: signing[0]] + "\n            " + block + "\n            " + text[signing[0]:]

    # 2. 让 buildTypes.release 使用它
    build_types = block_body(text, "buildTypes")
    if build_types is None:
        print("build.gradle 里没有 buildTypes 块", file=sys.stderr)
        return 1

    release = block_body(text, "release", build_types[0])
    if release is None or release[1] > build_types[1]:
        print("buildTypes 里找不到 release 块", file=sys.stderr)
        return 1

    body = text[release[0]: release[1]]
    if "signingConfig signingConfigs.release" in body:
        pass  # 已经有了
    elif "signingConfig signingConfigs.debug" in body:
        text = text[: release[0]] + body.replace(
            "signingConfig signingConfigs.debug", "signingConfig signingConfigs.release", 1
        ) + text[release[1]:]
    else:
        text = text[: release[0]] + "\n            signingConfig signingConfigs.release" + text[release[0]:]

    gradle.write_text(text)
    print(f"已注入 release 签名(keystore: {keystore})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
