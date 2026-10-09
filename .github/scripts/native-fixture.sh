#!/usr/bin/env bash
# Usage: .github/scripts/native-fixture.sh <dir>
#
# Generates the native shells the way users get them: packs the CLI package
# (so the "files" list in packages/cli/package.json applies), creates a minimal Inertia app in
# <dir> and runs `inertia-native init both` there. Builds ios/ and android/
# are then run by the caller (see .github/workflows/native.yml).
set -euo pipefail

dir=${1:?usage: native-fixture.sh <dir>}
repo=$(cd "$(dirname "$0")/../.." && pwd)

rm -rf "$dir"
mkdir -p "$dir/resources/js"
dir=$(cd "$dir" && pwd)

pack=$(mktemp -d)
trap 'rm -rf "$pack"' EXIT
(cd "$repo" && npm pack -w @inertia-native/cli --silent --pack-destination "$pack" >/dev/null)
tar -xzf "$pack"/inertia-native-cli-*.tgz -C "$pack"

printf '{ "name": "fixture", "private": true }\n' >"$dir/package.json"
printf "import { createInertiaApp } from '@inertiajs/react'\ncreateInertiaApp({})\n" >"$dir/resources/js/app.js"

cd "$dir"
node "$pack/package/bin/inertia-native.mjs" init both --yes --skip-install
