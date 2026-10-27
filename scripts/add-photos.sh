#!/bin/bash
# Resize every photo in photos-src/ for the frame (1600px long edge, JPEG) and upload it to the
# Worker's KV as photo:<hash>.jpg, then rebuild photos:manifest. Photos never go into git or the
# deployed assets, so deploys from GitHub can't remove them. They're served only with the dashboard key.
# Usage: scripts/add-photos.sh            (add --local to fill the local dev store instead)
set -euo pipefail
cd "$(dirname "$0")/.."
WHERE=--remote
[ "${1:-}" = "--local" ] && WHERE=--local
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

shopt -s nullglob nocaseglob
names=()
for f in photos-src/*.{jpg,jpeg,png,heic,heif}; do
  name=$(shasum -a 1 "$f" | cut -c1-12).jpg
  sips -s format jpeg -s formatOptions 82 -Z 1600 "$f" --out "$TMP/$name" >/dev/null
  npx wrangler kv key put "photo:$name" --path "$TMP/$name" --binding LISTS $WHERE >/dev/null
  names+=("$name")
  echo "uploaded $(basename "$f") -> $name"
done

# The manifest lists exactly the photos currently in photos-src/.
printf '%s\n' "${names[@]+"${names[@]}"}" | python3 -c '
import json, sys
print(json.dumps([{"src": "photos/" + n} for n in sys.stdin.read().split() if n]))' > "$TMP/manifest.json"
npx wrangler kv key put photos:manifest --path "$TMP/manifest.json" --binding LISTS $WHERE >/dev/null
echo "${#names[@]} photos in manifest"
