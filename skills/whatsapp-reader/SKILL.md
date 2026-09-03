---
name: whatsapp-reader
description: "Extraer, leer y consultar mensajes, audios y documentos de WhatsApp Web de forma pasiva y en modo solo lectura, mediante la CLI local `whatsapp-reader`. Úsalo cuando el usuario te pida revisar qué habló con alguien en WhatsApp, buscar datos o acuerdos en conversaciones, transcribir notas de voz recibidas, o extraer el contexto de un chat para fundamentar tareas posteriores. Keywords: whatsapp, chat, audio, notas de voz, mensajes, conversación, contacto, extract, corpus, transcript."
---

# WhatsApp Reader — extracción y consulta en solo lectura

Esta skill conduce la CLI local `whatsapp-reader` (kit `whatsapp-reader-kit`, instalado con su
`install.sh`) para consultar el historial, los archivos y las notas de voz de WhatsApp Web del
usuario. La CLI habla con un Chromium con perfil persistente; la skill no llama a ninguna API por su
cuenta.

## ⚠️ Seguridad y privacidad — innegociable

1. **Solo lectura, con un matiz honesto.** Ninguna orden de esta CLI envía, reacciona ni borra. Pero
   abrir WhatsApp Web **pone la cuenta en línea**, y eso lo ven los contactos; y la librería que la
   CLI inyecta en la página (`@wppconnect/wa-js`) sí expone funciones de escritura. No las invoques
   nunca por otra vía: «solo lectura» es una convención de esta CLI, no una barrera del motor.
2. **Automatizar WhatsApp incumple sus condiciones de servicio.** La sanción cae sobre el **número
   de teléfono** del usuario, que suele ser también su canal de doble factor y de banca. Trabaja a
   ritmo humano y no propongas extracciones masivas sin que el usuario las pida.
3. **Los chats son datos personales de terceros.** Extrae **solo** el chat que el usuario pidió, y
   solo el tramo que hace falta. Cita el `id` y la fecha del mensaje cuando uses su contenido.
4. **El corpus no va a un repositorio.** Por defecto se escribe en `~/.whatsapp-reader/corpus`,
   fuera de cualquier árbol de git, y así debe quedarse. Si el usuario pide otra ruta, comprueba que
   no esté dentro de un repo. No pegues mensajes de terceros en commits, issues ni informes.
5. **Transcribir crea datos nuevos.** `--transcribe` convierte la voz de otras personas en texto
   indexable. Úsalo solo si el usuario lo pide explícitamente.
6. **El código QR de `login` es una credencial viva.** Nunca lo muestres en una captura, ni lo
   canalices a un fichero, ni lo compartas.

---

## Flujo de trabajo

### Paso 1: comprobar la sesión

```bash
whatsapp-reader status
```

- `✓ Sesión activa` → sigue al paso 2 o 3.
- `✗ No hay sesión autenticada` → **es un paso humano**. Pide al usuario que ejecute
  `whatsapp-reader login` en su terminal y escanee el QR desde su teléfono (Ajustes → Dispositivos
  vinculados). La sesión queda persistente y no hay que repetirlo.

`status` **no** muestra el identificador del usuario, porque es su número de teléfono. Solo aparece
con `--show-id`, y no hay motivo para pedirlo.

### Paso 2: localizar el chat

```bash
whatsapp-reader chats --limit 20        # añade --json si vas a procesar con jq
```

### Paso 3: extraer al corpus

El destino por defecto es `~/.whatsapp-reader/corpus`. Omite `--out` salvo que el usuario pida otra
ruta.

```bash
# Últimos mensajes
whatsapp-reader extract --chat "Nombre o JID" --limit 50

# Con media y transcripción de las notas de voz
whatsapp-reader extract --chat "Nombre o JID" --limit 100 --media --transcribe

# Historial completo (pídelo solo si el usuario lo pide)
whatsapp-reader extract --chat "Nombre o JID" --all --media --transcribe
```

| Flag | Qué hace |
|---|---|
| `-c, --chat <nombre\|JID>` | Contacto, grupo o JID. Obligatorio. |
| `-l, --limit <n>` | Mensajes a extraer (por defecto 50). |
| `-a, --all` | Todo el historial, sin límite. |
| `-o, --out <dir>` | Destino del corpus. Por defecto `~/.whatsapp-reader/corpus`. |
| `-m, --media` | Descarga audios, fotos y documentos. |
| `-t, --transcribe` | Transcribe las notas de voz con faster-whisper. |

Empieza siempre por un límite razonable (50–100). Si hace falta más historial, amplía por pasos.

### Paso 4: consultar el corpus

```
chats/<slug>/chat.md          hilo legible en orden cronológico — para leer contexto continuo
chats/<slug>/messages.jsonl   una línea JSON por mensaje (id, ts, sender, text, media, transcript)
chats/<slug>/media/           ficheros descargados
index.md                      resumen: totales de mensajes, audios y fechas
```

```bash
# Buscar un término en todo el corpus
rg -i "termino1|termino2" ~/.whatsapp-reader/corpus/chats/ -g '*.jsonl'

# Filtrar por remitente
jq -c 'select(.sender=="Nombre")' ~/.whatsapp-reader/corpus/chats/<slug>/messages.jsonl

# Solo los audios transcritos
jq -r 'select(.transcript!=null) | "\(.ts) [\(.sender)]: \(.transcript)"' \
  ~/.whatsapp-reader/corpus/chats/<slug>/messages.jsonl
```

Usa `messages.jsonl` para buscar y contar; `chat.md` para leer.

### Alternativa: exportación nativa del teléfono

Si el usuario tiene un `.zip` o un `_chat.txt` exportado a mano desde el móvil, se ingesta al mismo
formato sin abrir el navegador y sin tocar la sesión:

```bash
whatsapp-reader ingest /ruta/a/_chat.txt --media --transcribe
```

Es la vía preferible cuando sirve: no toca la cuenta y no la pone en línea.

---

## Problemas frecuentes

- **«Chromium no encontrado»** — instala Chromium o define `PUPPETEER_EXECUTABLE_PATH`.
- **«Tiempo de espera agotado»** — WhatsApp Web tarda en sincronizar el historial. Reintenta con un
  `--limit` menor.
- **Audios sin transcribir** — falta la mitad Python: `python3 -m venv venv` y
  `./venv/bin/pip install -r requirements.txt` en la carpeta del kit. La primera transcripción
  descarga el modelo de Whisper desde huggingface.co.
- **«WA_SESSION_DIR no puede estar dentro del proyecto»** — es a propósito: el perfil del navegador
  contiene las claves del dispositivo vinculado. Déjalo en `~/.whatsapp-reader/session`.
