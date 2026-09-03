#!/usr/bin/env python3
"""
transcribe.py - Helper para transcribir audios de WhatsApp (.opus / .ogg / .m4a / etc.)
Usa faster-whisper con compute_type int8 para rendimiento óptimo en CPU.
"""

import sys
import os
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Uso: transcribe.py <archivo_audio> [modelo]", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("WHISPER_MODEL", "base")

    if not Path(audio_path).is_file():
        print(f"Error: Archivo {audio_path} no existe", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Error: faster-whisper no está instalado en este entorno", file=sys.stderr)
        sys.exit(2)

    try:
        model = WhisperModel(model_size, device="auto", compute_type="int8")
        segments, info = model.transcribe(str(audio_path), vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
        print(text)
    except Exception as e:
        print(f"Error al transcribir: {e}", file=sys.stderr)
        sys.exit(3)

if __name__ == "__main__":
    main()
