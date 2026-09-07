#!/bin/bash
# dsh-ultra-mode build: compile src/ → lib/.
# 依赖链接策略（兼容性优先）：
#   1. 运行时包 store（DSH profile node_modules，编译产物齐全）——默认路径
#      ~/.dsh/profiles/node_modules/@deepseek-ai/dsh/node_modules，可用
#      DSH_PROFILE_STORE 覆盖；
#   2. DSH_CHECKOUT（源码 checkout）回退——需要 checkout 已编译出 lib/。
# tsc 依次取自：DSH_CHECKOUT、store、本项目 devDependencies。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STORE="${DSH_PROFILE_STORE:-$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh/node_modules}"
if [ ! -d "$STORE" ]; then
  echo "build: runtime package store not found at $STORE (set DSH_PROFILE_STORE)" >&2
  exit 1
fi

CHECKOUT="${DSH_CHECKOUT:-}"
if [ -z "$CHECKOUT" ]; then
  for candidate in "$HOME/dsh-harness" "$HOME/dsh" "$HOME/.dsh/dsh-harness"; do
    if [ -d "$candidate/packages" ]; then CHECKOUT="$candidate"; break; fi
  done
fi

TSC=""
if [ -n "$CHECKOUT" ] && [ -x "$CHECKOUT/node_modules/.bin/tsc" ]; then TSC="$CHECKOUT/node_modules/.bin/tsc"
elif [ -n "$CHECKOUT" ] && [ -f "$CHECKOUT/node_modules/.bin/tsc.cmd" ]; then TSC="$CHECKOUT/node_modules/.bin/tsc.cmd"
elif [ -x "$STORE/.bin/tsc" ]; then TSC="$STORE/.bin/tsc"
elif [ -f "$STORE/.bin/tsc.cmd" ]; then TSC="$STORE/.bin/tsc.cmd"
fi
if [ -z "$TSC" ]; then echo "build: tsc not found (looked in checkout and store)" >&2; exit 1; fi

link_pkg() {
  local name="$1"
  local target="$2"
  local link="node_modules/$name"
  if [ ! -d "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "$link" "$target"
}

echo "=== Linking build dependencies (store: $STORE) ==="
mkdir -p node_modules/@deepseek-ai
link_pkg @deepseek-ai/cordis "$STORE/@deepseek-ai/cordis"
link_pkg @deepseek-ai/schemastery "$STORE/@deepseek-ai/schemastery"
link_pkg @deepseek-ai/dsh-tools "$STORE/@deepseek-ai/dsh-tools"
# @types/node（tsc 类型；store 顶层若有）
if [ -d "$STORE/@types/node" ]; then link_pkg @types/node "$STORE/@types/node"; fi

echo "=== Compiling src → lib ==="
"$TSC" -p tsconfig.json
echo "=== Build complete ==="
