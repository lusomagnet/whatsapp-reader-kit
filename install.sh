#!/usr/bin/env bash
# install.sh — instala whatsapp-reader-kit en macOS/Linux.
# Idempotente: re-ejecutar actualiza la skill y no duplica nada.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mAVISO:\033[0m %s\n' "$*"; }

# 1) Node >= 18
command -v node >/dev/null 2>&1 || { warn "Node no está instalado. Instala Node >= 18."; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { warn "Se requiere Node >= 18 (tienes $(node -v))."; exit 1; }
info "node: $(node -v)"

# 2) Chromium del sistema (puppeteer-core NO trae navegador)
CHROMIUM="${PUPPETEER_EXECUTABLE_PATH:-}"
if [ -z "$CHROMIUM" ]; then
  for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome \
           "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    [ -x "$c" ] && { CHROMIUM="$c"; break; }
  done
fi
if [ -n "$CHROMIUM" ]; then
  info "chromium: $CHROMIUM"
else
  warn "No encuentro Chromium. Instálalo o exporta PUPPETEER_EXECUTABLE_PATH antes de usar la CLI."
fi

# 3) Dependencias npm
info "Instalando dependencias npm…"
( cd "$REPO_DIR" && npm install --no-audit --no-fund >/dev/null )

# 4) Mitad Python (opcional, solo para --transcribe)
if [ "${SKIP_PYTHON:-0}" != "1" ] && command -v python3 >/dev/null 2>&1; then
  if [ ! -x "$REPO_DIR/venv/bin/python3" ]; then
    info "Creando venv para la transcripción (SKIP_PYTHON=1 para omitirlo)…"
    python3 -m venv "$REPO_DIR/venv" 2>/dev/null \
      && "$REPO_DIR/venv/bin/pip" install -q -r "$REPO_DIR/requirements.txt" \
      && info "faster-whisper instalado." \
      || warn "No pude preparar el venv. --transcribe no funcionará hasta que lo hagas a mano."
  else
    info "venv ya presente."
  fi
else
  warn "Sin python3 (o SKIP_PYTHON=1): --transcribe quedará deshabilitado."
fi

# 5) Skill de Claude Code. ~/.claude/skills puede ser un symlink: se escribe a través de él.
SKILL_DST="$HOME/.claude/skills/whatsapp-reader"
mkdir -p "$HOME/.claude/skills"
rm -rf "$SKILL_DST"
cp -r "$REPO_DIR/skills/whatsapp-reader" "$SKILL_DST"
info "Skill instalada en $SKILL_DST"

# 6) CLI en el PATH
mkdir -p "$HOME/.local/bin"
ln -sf "$REPO_DIR/bin/whatsapp-reader.js" "$HOME/.local/bin/whatsapp-reader"
chmod +x "$REPO_DIR/bin/whatsapp-reader.js"
info "CLI enlazada en ~/.local/bin/whatsapp-reader"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "~/.local/bin no está en tu PATH; añádelo a tu perfil." ;; esac

# 7) Sesión (paso HUMANO). Nunca se copia al repo.
mkdir -p "$HOME/.whatsapp-reader"
chmod 700 "$HOME/.whatsapp-reader"
echo
info "Instalación completada. Falta el paso humano (una vez por máquina):"
echo "    whatsapp-reader login     # escanea el QR desde tu teléfono (Dispositivos vinculados)"
echo "    whatsapp-reader status    # verifica"
echo
warn "Recuerda: automatizar WhatsApp incumple su ToS y el riesgo cae sobre TU número."
warn "El corpus que extraigas contiene datos de terceros: no lo metas en un repositorio."
