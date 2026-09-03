import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VENV_PYTHON = path.resolve(__dirname, '../venv/bin/python3');
const TRANSCRIBE_PY = path.resolve(__dirname, 'transcribe.py');

/**
 * Transcribe un archivo de audio (.opus, .ogg, .m4a, .mp3) usando faster-whisper
 */
export async function transcribeAudio(audioPath, { model = 'base' } = {}) {
  const pythonBin = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Archivo de audio no encontrado: ${audioPath}`);
  }

  try {
    const { stdout } = await execFileAsync(pythonBin, [TRANSCRIBE_PY, audioPath, model], {
      timeout: 120000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });
    return stdout.trim();
  } catch (err) {
    if (err.code === 2) {
      // faster-whisper no instalado
      throw new Error('faster-whisper no instalado');
    }
    throw new Error(`Fallo de transcripción: ${err.message}`);
  }
}
