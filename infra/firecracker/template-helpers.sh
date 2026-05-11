# Shared helpers for per-template setup.sh scripts.
#
# Setup scripts are invoked by build-template.sh with:
#   - $TEMPLATE_ROOT: absolute path to the mounted rootfs (writable)
#   - $SCRIPT_DIR:    infra/firecracker directory (where this file lives)
#
# A setup script `source`s this file and then calls the helpers below to
# populate $TEMPLATE_ROOT with whatever extra files the template needs.

# Copy a host binary (and its shared libraries + dynamic linker) into the
# mounted rootfs.
#
#   copy_binary_into <rootfs> <source-binary> [<target-path>]
#
# Defaults target-path to the same path as source-binary.
copy_binary_into() {
  local rootfs="$1"
  local source_path="$2"
  local target_path="${3:-$source_path}"

  if [ ! -f "$source_path" ]; then
    echo "ERROR: binary not found on host: $source_path" >&2
    return 1
  fi

  sudo mkdir -p "$rootfs$(dirname "$target_path")"
  sudo cp "$source_path" "$rootfs$target_path"

  if ldd "$source_path" &>/dev/null; then
    ldd "$source_path" 2>/dev/null | grep -oP '/\S+' | while read -r lib; do
      [ -f "$lib" ] || continue
      sudo mkdir -p "$rootfs$(dirname "$lib")"
      sudo cp -n "$lib" "$rootfs$lib" 2>/dev/null || true
    done

    local linker
    linker=$(ldd "$source_path" 2>/dev/null | grep -E 'ld-linux|ld-musl|ld64' | grep -oP '/\S+' | head -1 || true)
    if [ -n "$linker" ] && [ -f "$linker" ]; then
      sudo mkdir -p "$rootfs$(dirname "$linker")"
      sudo cp -n "$linker" "$rootfs$linker" 2>/dev/null || true
    fi
  fi
}
