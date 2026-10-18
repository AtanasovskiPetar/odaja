#!/bin/sh
# Installs Odaja's companion (the `odaja` program) on macOS or Linux:
#
#   curl -fsSL https://atanasovskipetar.github.io/odaja/install.sh | sh
#
# It downloads the program for this computer from the latest GitHub Release
# into ~/.local/bin (ODAJA_INSTALL_DIR for another folder). Downloaded with
# curl, it isn't marked as "from the internet", so macOS opens it without
# asking. Run it again to update.
set -eu

repo="AtanasovskiPetar/odaja"
base="${ODAJA_RELEASE_URL:-https://github.com/$repo/releases/latest/download}"
dir="${ODAJA_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) os=linux ;;
  *) echo "This installer is for macOS and Linux. On Windows, in PowerShell: irm https://atanasovskipetar.github.io/odaja/install.ps1 | iex" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "Odaja isn't built for $(uname -m) yet." >&2; exit 1 ;;
esac
# A terminal running under Rosetta reports x86_64 on Apple Silicon.
if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi

echo "Downloading Odaja for $os ($arch)…"
mkdir -p "$dir"
tmp="$dir/.odaja-download"
curl -fL --progress-bar "$base/odaja-$os-$arch" -o "$tmp"
chmod +x "$tmp"
mv -f "$tmp" "$dir/odaja"
if [ "$os" = macos ]; then xattr -d com.apple.quarantine "$dir/odaja" 2>/dev/null || true; fi

echo
echo "Odaja is installed: $dir/odaja"
case ":$PATH:" in
  *":$dir:"*) echo "Start it with:  odaja" ;;
  *)
    echo "Start it with:  $dir/odaja"
    echo "To start it with just 'odaja', add $dir to your PATH, e.g.:"
    echo "  echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zshrc"
    ;;
esac
