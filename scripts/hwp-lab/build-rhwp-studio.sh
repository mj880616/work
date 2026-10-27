#!/usr/bin/env bash
# HWP-편집기 1단계: rhwp 편집기를 고정 버전으로 빌드해 app/hwp-lab/rhwp-<버전>/ 에 넣는다.
# @rhwp/editor(npm)는 iframe SDK만 담고 있어 편집기 본체(rhwp-studio)는 같은 버전 태그의 소스에서 빌드하고,
# WASM 엔진은 같은 버전의 npm @rhwp/core 빌드본을 쓴다. 외부 웹폰트는 빌드 스위치로 끈다.
# 사용법: bash scripts/hwp-lab/build-rhwp-studio.sh   (Node 20 이상, git, npm 필요. 운영 접속 없음)
set -euo pipefail

# 고정 버전은 rhwp-pin.json 한 곳에서 관리한다(올리는 방법: docs/hwp-editor.md).
PIN="$(cd "$(dirname "$0")" && pwd)/rhwp-pin.json"
pin() { node -p "require(process.argv[1]).$1" "$PIN"; }
RHWP_VERSION=$(pin version)
RHWP_TAG=$(pin tag)
RHWP_COMMIT=$(pin commit)
EDITOR_INTEGRITY=$(pin editorIntegrity)
CORE_INTEGRITY=$(pin coreIntegrity)

REPO_ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
OUT="$REPO_ROOT/app/hwp-lab/rhwp-$RHWP_VERSION"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fetch_package() { # name integrity dir
  local name=$1 integrity=$2 dir=$3 tarball actual
  mkdir -p "$dir"
  tarball=$(cd "$dir" && npm pack --silent "$name@$RHWP_VERSION")
  actual="sha512-$(openssl dgst -sha512 -binary "$dir/$tarball" | base64 -w0)"
  [ "$actual" = "$integrity" ] || { echo "$name 무결성 불일치: $actual" >&2; exit 1; }
  tar -xzf "$dir/$tarball" -C "$dir"
}

fetch_package @rhwp/editor "$EDITOR_INTEGRITY" "$WORK/editor"
fetch_package @rhwp/core "$CORE_INTEGRITY" "$WORK/core"

# 저장소 전체(시험 문서 포함 수 GB) 대신 편집기 빌드에 필요한 경로만 받는다.
git clone --quiet --depth 1 --filter=blob:none --sparse --branch "$RHWP_TAG" https://github.com/edwardkim/rhwp.git "$WORK/rhwp"
git -C "$WORK/rhwp" sparse-checkout set rhwp-studio assets/fonts npm
[ "$(git -C "$WORK/rhwp" rev-parse HEAD)" = "$RHWP_COMMIT" ] || { echo "rhwp 태그 커밋 불일치" >&2; exit 1; }

mkdir -p "$WORK/rhwp/pkg"
cp "$WORK/core/package/rhwp.js" "$WORK/core/package/rhwp_bg.wasm" "$WORK/core/package/rhwp.d.ts" "$WORK/core/package/rhwp_bg.wasm.d.ts" "$WORK/rhwp/pkg/"
(
  cd "$WORK/rhwp/rhwp-studio"
  npm ci --ignore-scripts --no-audit --no-fund --silent
  export RHWP_DISABLE_EXTERNAL_WEBFONTS=1 RHWP_WITHOUT_HWPCTRL=1
  npx tsc
  npx vite build --base=./ --logLevel warn
)

rm -rf "$OUT"
mkdir -p "$OUT/sdk"
cp -R "$WORK/rhwp/rhwp-studio/dist" "$OUT/studio"
cp "$WORK/editor/package/index.js" "$WORK/editor/package/transport.js" "$WORK/editor/package/document-agent-contract.js" "$OUT/sdk/"
cp "$WORK/rhwp/LICENSE" "$OUT/LICENSE"
cp "$WORK/rhwp/THIRD_PARTY_LICENSES.md" "$OUT/THIRD_PARTY_LICENSES.md"
node "$REPO_ROOT/scripts/hwp-lab/finalize-rhwp-studio.mjs" "$OUT" "$RHWP_VERSION" "$RHWP_COMMIT" "$EDITOR_INTEGRITY" "$CORE_INTEGRITY"
