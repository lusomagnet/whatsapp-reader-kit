# install.ps1 — instala whatsapp-reader-kit en Windows.
$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'Node no está instalado. Instala Node >= 18.' }
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 18) { Write-Error "Se requiere Node >= 18 (tienes $(node -v))." }
Write-Host "==> node: $(node -v)"

if (-not $env:PUPPETEER_EXECUTABLE_PATH) {
  Write-Warning 'Define PUPPETEER_EXECUTABLE_PATH con la ruta a Chrome/Chromium (puppeteer-core no trae navegador).'
}

Write-Host '==> Instalando dependencias npm...'
Push-Location $RepoDir; npm install --no-audit --no-fund | Out-Null; Pop-Location

if ((Get-Command python -ErrorAction SilentlyContinue) -and (-not (Test-Path (Join-Path $RepoDir 'venv')))) {
  Write-Host '==> Creando venv para la transcripcion...'
  python -m venv (Join-Path $RepoDir 'venv')
  & (Join-Path $RepoDir 'venv\Scripts\pip.exe') install -q -r (Join-Path $RepoDir 'requirements.txt')
}

$SkillDst = Join-Path $HOME '.claude\skills\whatsapp-reader'
New-Item -ItemType Directory -Force -Path (Split-Path $SkillDst) | Out-Null
if (Test-Path $SkillDst) { Remove-Item -Recurse -Force $SkillDst }
Copy-Item -Recurse (Join-Path $RepoDir 'skills\whatsapp-reader') $SkillDst
Write-Host "==> Skill instalada en $SkillDst"

New-Item -ItemType Directory -Force -Path (Join-Path $HOME '.whatsapp-reader') | Out-Null
Write-Host ''
Write-Host '==> Falta el paso humano: node bin\whatsapp-reader.js login  (escanea el QR)'
Write-Warning 'Automatizar WhatsApp incumple su ToS y el riesgo cae sobre TU numero.'
Write-Warning 'El corpus contiene datos de terceros: no lo metas en un repositorio.'
