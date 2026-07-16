#!/bin/bash
set -euo pipefail

APP="${1:?missing app bundle path}"
REWRITE_TEAM_ENTITLEMENTS="${2:-false}"
LABEL="${3:-macOS app}"
CONTENTS="$APP/Contents"

if [[ ! -d "$CONTENTS" ]]; then
  echo "$LABEL bundle is invalid: $APP" >&2
  exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/i18n-workbench-sign.XXXXXX")"
cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

extract_entitlements() {
  local target="$1"
  local output="$2"
  codesign -d --entitlements :- "$target" >"$output" 2>/dev/null || return 1
  [[ -s "$output" ]] || return 1
  plutil -lint "$output" >/dev/null 2>&1
}

remove_entitlement() {
  local file="$1"
  local key="$2"
  /usr/libexec/PlistBuddy -c "Delete :$key" "$file" >/dev/null 2>&1 || true
}

prepare_entitlements() {
  local file="$1"
  if [[ "$REWRITE_TEAM_ENTITLEMENTS" != "true" ]]; then
    return
  fi
  remove_entitlement "$file" "com.apple.application-identifier"
  remove_entitlement "$file" "com.apple.developer.team-identifier"
  remove_entitlement "$file" "keychain-access-groups"
  if /usr/libexec/PlistBuddy -c "Print :com.apple.security.cs.disable-library-validation" "$file" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :com.apple.security.cs.disable-library-validation true" "$file"
  else
    /usr/libexec/PlistBuddy -c "Add :com.apple.security.cs.disable-library-validation bool true" "$file"
  fi
}

counter=0
sign_path() {
  local target="$1"
  local entitlements
  local -a entitlement_args=()
  counter=$((counter + 1))
  entitlements="$WORK/entitlements-$counter.plist"
  if extract_entitlements "$target" "$entitlements"; then
    prepare_entitlements "$entitlements"
    entitlement_args=(--entitlements "$entitlements")
  else
    rm -f "$entitlements"
  fi

  if ! codesign --force --sign - --options runtime --preserve-metadata=identifier,flags \
    "${entitlement_args[@]}" "$target"; then
    codesign --force --sign - --options runtime "${entitlement_args[@]}" "$target"
  fi
}

original_entitlements="$WORK/original-app-entitlements.plist"
required_virtualization=false
if extract_entitlements "$APP" "$original_entitlements" && \
  /usr/libexec/PlistBuddy -c "Print :com.apple.security.virtualization" "$original_entitlements" 2>/dev/null | grep -qi '^true$'; then
  required_virtualization=true
fi

signed_files=0
while IFS= read -r -d '' target; do
  if file -b "$target" | grep -q 'Mach-O'; then
    sign_path "$target"
    signed_files=$((signed_files + 1))
  fi
done < <(find "$CONTENTS" -depth -type f -print0)

signed_bundles=0
while IFS= read -r -d '' target; do
  sign_path "$target"
  signed_bundles=$((signed_bundles + 1))
done < <(find "$CONTENTS" -depth -type d \( \
  -name '*.framework' -o -name '*.app' -o -name '*.xpc' -o -name '*.appex' \
\) -print0)

sign_path "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

if [[ "$required_virtualization" == "true" ]]; then
  verified_entitlements="$WORK/verified-app-entitlements.plist"
  if ! extract_entitlements "$APP" "$verified_entitlements" || \
    ! /usr/libexec/PlistBuddy -c "Print :com.apple.security.virtualization" "$verified_entitlements" 2>/dev/null | grep -qi '^true$'; then
    echo "$LABEL lost the com.apple.security.virtualization entitlement" >&2
    exit 1
  fi
fi

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
echo "$LABEL re-signed: $signed_files Mach-O files, $signed_bundles nested bundles"
