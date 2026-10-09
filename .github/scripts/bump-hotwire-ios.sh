#!/usr/bin/env bash
# Usage: .github/scripts/bump-hotwire-ios.sh [version]
#
# Bumps Hotwire Native iOS in packages/cli/templates/ios to <version> (default: the latest
# release): sets the minimum of the package requirement in project.pbxproj
# and lets Xcode re-resolve Package.resolved. Renovate bumps minor and patch
# versions in Package.resolved on its own; use this for a new major or to
# raise the minimum. Needs Xcode.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
project=$repo/packages/cli/templates/ios/App.xcodeproj
pbxproj=$project/project.pbxproj
resolved=$project/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
url=https://github.com/hotwired/hotwire-native-ios

version=${1:-$(git ls-remote --tags --refs "$url" | sed 's|.*refs/tags/||' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)}
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Not a version: $version" >&2
  exit 1
fi
if [[ $(grep -c 'minimumVersion = ' "$pbxproj") != 1 ]]; then
  echo "Expected exactly one package requirement in $pbxproj" >&2
  exit 1
fi

sed -i '' -E "s/(minimumVersion = )[^;]+;/\1$version;/" "$pbxproj"
rm -f "$resolved"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
xcodebuild -resolvePackageDependencies -project "$project" -scheme App \
  -derivedDataPath "$work/DerivedData" -clonedSourcePackagesDirPath "$work/spm" >/dev/null

if ! grep -q "\"version\" : \"$version\"" "$resolved"; then
  echo "Xcode resolved another version (the newest within the major):" >&2
  grep '"version"' "$resolved" >&2
fi
git -C "$repo" diff --stat -- packages/cli/templates/ios
