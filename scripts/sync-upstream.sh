#!/usr/bin/env bash
# favibe upstream sync: 本家 Millivibe の差分を確認
set -e
UPSTREAM="https://milli-unishare-preview.onrender.com"
TMPDIR=$(mktemp -d)
echo "[favibe] fetching upstream..."
for f in millivibe.html millivibe.css video.css js/millivibe.js js/config.js js/storage.js js/icons.js; do
  echo " - $f"
  curl -sL "$UPSTREAM/$f" -o "$TMPDIR/$(echo $f|tr '/' '_')" || true
done
echo "[favibe] diff vs local:"
for f in millivibe.html millivibe.css video.css; do
  local=" $PWD/$f"
  remote="$TMPDIR/$(echo $f|tr '/' '_')"
  if [ -f "$local" ] && [ -f "$remote" ]; then
    if ! diff -q "$local" "$remote" > /dev/null 2>&1; then
      echo "  * $f changed upstream"
      diff -u "$local" "$remote" | head -n 80 || true
    else
      echo "  = $f no change"
    fi
  fi
done
for f in js/millivibe.js js/config.js js/storage.js; do
  # favibe uses favibe.js / config.js etc
  local="$PWD/$f"
  base=$(basename "$f")
  remote="$TMPDIR/$(echo $f|tr '/' '_')"
  # compare favibe.js to upstream millivibe.js
  if [[ "$f" == "js/millivibe.js" ]]; then
    local="$PWD/js/favibe.js"
  fi
  if [ -f "$local" ] && [ -f "$remote" ]; then
    if ! diff -q "$local" "$remote" > /dev/null 2>&1; then
      echo "  * $f (vs favibe) diff exists (favibe has customizations, manual merge needed)"
    fi
  fi
done
echo "[favibe] tmp at $TMPDIR"
echo "Done. If upstream changed, manually merge into favibe.*"
