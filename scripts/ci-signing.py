#!/usr/bin/env python3
"""
CI 里给 prebuild 生成的 android/app/build.gradle 打 release 签名补丁。

为什么需要:prebuild 每次都会重新生成 build.gradle,里面默认让 release 用 debug 密钥签名。
CI 上通过 secrets 提供正式密钥时,用这个脚本把 signingConfigs.release 注入进去。

用法:
  python3 scripts/ci-signing.py android/app/build.gradle release.keystore

密码从环境变量读:KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD
"""
import os
import re
import sys
from pathlib import Path

SIGNING_BLOCK = """signingConfigs {
            release {
                storeFile file("{keystore}")
                storePassword System.getenv("KEYSTORE_PASSWORD")
                keyAlias System.getenv("KEY_ALIAS")
                keyPassword System.getenv("KEY_PASSWORD")
            }"""


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

    if "signingConfigs.release" in text:
        print("已经配置过 release 签名,跳过")
        return 0

    if "signingConfigs {" not in text:
        print("build.gradle 里没有 signingConfigs 块,prebuild 结构可能变了", file=sys.stderr)
        return 1

    text = text.replace(
        "signingConfigs {",
        SIGNING_BLOCK.format(keystore=keystore),
        1,
    )

    # 让 release buildType 使用它
    text = re.sub(
        r"(buildTypes\s*\{\s*release\s*\{)",
        r"\1\n            signingConfig signingConfigs.release",
        text,
        count=1,
    )

    gradle.write_text(text)
    print(f"已注入 release 签名(keystore: {keystore})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
