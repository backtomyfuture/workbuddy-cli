#!/usr/bin/env bash
set -e

# ==========================================
# WorkBuddy CLI Installer
# ==========================================

REPO_RAW_URL="https://raw.githubusercontent.com/backtomyfuture/workbuddy-cli/main"
TARGET_DIR="${HOME}/.local/bin"
TARGET_FILE="${TARGET_DIR}/workbuddy"

echo "🚀 Installing workbuddy-cli..."

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is not installed. Please install Node.js (>= 18) first." >&2
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "⚠️ Warning: Node.js version $(node -v) is lower than v18. Some features may not work as expected."
fi

# 2. Check WorkBuddy App
if [ "$(uname)" = "Darwin" ]; then
  if [ ! -d "/Applications/WorkBuddy.app" ] && [ ! -d "${HOME}/Applications/WorkBuddy.app" ]; then
    echo "ℹ️  Tip: WorkBuddy desktop app was not detected in /Applications."
    echo "   Please download and install it from https://www.workbuddy.cn"
  fi
fi

# 3. Create target directory
mkdir -p "${TARGET_DIR}"

# 4. Download script
if [ -f "$(dirname "$0")/bin/workbuddy.mjs" ]; then
  # Local install from cloned repository
  cp "$(dirname "$0")/bin/workbuddy.mjs" "${TARGET_FILE}"
else
  # Remote install via curl
  echo "📥 Downloading workbuddy executable..."
  curl -fsSL "${REPO_RAW_URL}/bin/workbuddy.mjs" -o "${TARGET_FILE}"
fi

chmod +x "${TARGET_FILE}"

# 5. Create 'wb' alias shortcut
ln -sf "${TARGET_FILE}" "${TARGET_DIR}/wb"

echo "✅ workbuddy installed successfully to ${TARGET_FILE}"
echo "✅ Shortcut 'wb' created in ${TARGET_DIR}/wb"

# 6. Check PATH
case ":$PATH:" in
  *":${TARGET_DIR}:"*) ;;
  *)
    echo ""
    echo "⚠️  ${TARGET_DIR} is not currently in your PATH."
    echo "   Add it by running:"
    echo "     echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
    echo "     source ~/.zshrc"
    echo ""
    ;;
esac

echo ""
echo "🎉 Installation complete!"
echo "   Make sure WorkBuddy.app is running, then try:"
echo "     workbuddy \"写一个快速排序算法\""
echo "     workbuddy -m hy4 \"介绍一下你自己\""
echo "     workbuddy --models"
echo ""
