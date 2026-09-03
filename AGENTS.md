# whatsapp-reader-kit — Instrucciones para agentes AI

**Audiencia:** Claude Code, la GitHub Action de auditoría de este repo, o cualquier agente que
trabaje sobre este código.

## Qué es este sistema

Una **CLI de solo lectura** que convierte una conversación de WhatsApp Web en un corpus estructurado
para que un agente lo consulte. Lanza un Chromium con perfil persistente vía `puppeteer-core`,
inyecta `@wppconnect/wa-js` en la página y pagina hacia atrás sobre el store de la propia web. No hay
servidor, ni API de terceros, ni backend.

Es **híbrido**: Node es el punto de entrada y Python solo entra para transcribir (`faster-whisper` en
un subproceso). Sin la mitad Python todo funciona menos `--transcribe`.

**Este kit no es un servidor MCP.** No lo conviertas en uno; se conduce desde la skill por Bash.

## Componentes

| Archivo | Propósito | Mantenimiento |
|---|---|---|
| `bin/whatsapp-reader.js` | CLI (Commander): `login`, `status`, `chats`, `extract`, `ingest` | Editar para cambiar flags o salida |
| `src/browser.js` | Chromium persistente, inyección de `wa-js`, lectura del QR y **guardia del directorio de sesión** | **Núcleo de seguridad** |
| `src/extractor.js` | `listChats`, `findChat`, `fetchMessages`, descarga de media y `writeCorpus` | Núcleo funcional |
| `src/ingest-native.js` | Parser de exportaciones `.txt` del móvil (formatos iOS y Android, multi-idioma) | Estable |
| `src/transcriber.js` | Puente Node → Python (`execFile`, timeout 120 s) | Estable |
| `src/transcribe.py` | `faster-whisper`, `compute_type=int8` para CPU | Estable |
| `skills/whatsapp-reader/SKILL.md` | Skill de Claude Code. **El repo es la fuente de verdad**; `install.sh` la despliega | Editar aquí, nunca en `~/.claude/skills/` |
| `install.sh` · `install.ps1` | Instaladores idempotentes: deps, venv opcional, skill y enlace en el PATH | Estable |
| `requirements.txt` | Solo `faster-whisper`; el resto entra transitivamente | Estable |

## Invariantes que NO son bugs

Lo siguiente parece un fallo y es una decisión tomada a propósito. Si vas a cambiarlo, di por qué.

1. **El corpus se escribe por defecto FUERA del árbol del repo**, en `~/.whatsapp-reader/corpus`.
   No lo devuelvas a una ruta relativa: el destino relativo se resuelve contra el directorio de
   trabajo, y con `npm start` ese directorio es la raíz del repo. Sería poner conversaciones de
   terceros al alcance de un `git add -A`.
2. **`assertSessionDirOutsideRepo()` rechaza cualquier `WA_SESSION_DIR` dentro del paquete.** El
   perfil de Chromium pesa unos 160 MB y contiene las claves del dispositivo vinculado. No relajes
   esta comprobación por comodidad.
3. **`status` oculta `myId`**, que es el número de teléfono del usuario, salvo `--show-id`. Es la
   salida que la gente pega en un informe de fallo.
4. **`--no-sandbox`, `--disable-setuid-sandbox` y `setBypassCSP(true)` son deliberados** y están
   documentados en el README como compromiso. Hacen falta en entornos con contenedor donde el
   sandbox de Chromium no arranca, y para poder inyectar la librería. Bajan las defensas del
   navegador: si tu sistema no los necesita, quítalos.
5. **`puppeteer-core`, no `puppeteer`.** No trae navegador a propósito: usa el Chromium del sistema.
   `PUPPETEER_EXECUTABLE_PATH` lo redefine.
6. **No hay tests automatizados.** Lo que puede romperse es el DOM y el store de WhatsApp Web, que
   cambian sin aviso y no se pueden simular con fidelidad. La verificación es manual.

## Reglas de seguridad y de privacidad

- **«Solo lectura» es una convención de esta CLI, no una barrera del motor.** Ninguna orden envía,
  reacciona ni borra, pero la librería inyectada **sí** expone escritura. No añadas rutas de código
  que la usen. Y abrir WhatsApp Web **pone la cuenta en línea**, cosa que los contactos ven; por eso
  `ingest` es preferible cuando sirve, porque no toca la cuenta.
- **El directorio de sesión es una credencial**, equivalente a un dispositivo vinculado. Vive en
  `~/.whatsapp-reader/session` con permisos `700` y nunca entra en el repo.
- **El corpus son datos personales de terceros.** Quien lo extrae es el responsable del tratamiento.
  No pegues su contenido en un issue, un commit ni un informe, y no lo uses como material de prueba.
- **El QR que imprime `login` es una credencial viva.** No lo canalices a un fichero ni lo muestres.
- **Automatizar WhatsApp incumple sus Condiciones de Servicio** y la sanción cae sobre el número de
  teléfono. Cualquier cambio que suba el ritmo de peticiones o automatice el envío agrava eso.
- El `.gitignore` es lo único que separa 494 MB de entorno y un corpus de conversaciones de un
  `git add -A`. **Revísalo antes de tocarlo.**

## Verificación

```bash
node --check bin/whatsapp-reader.js && node --check src/browser.js && node --check src/extractor.js
node bin/whatsapp-reader.js --help
whatsapp-reader status                       # necesita sesión vinculada
WA_SESSION_DIR=./session whatsapp-reader status   # DEBE fallar: guardia del directorio de sesión
```

La última **debe ser rechazada**. Si crea `./session`, la protección está rota.

## Troubleshooting

- **«Chromium no encontrado»** → instala Chromium o define `PUPPETEER_EXECUTABLE_PATH`.
- **«Tiempo de espera agotado»** → WhatsApp Web tarda en sincronizar el historial; baja `--limit`.
- **Audios sin transcribir** → falta el venv: `python3 -m venv venv` y
  `./venv/bin/pip install -r requirements.txt`. La primera transcripción descarga el modelo de
  Whisper desde huggingface.co.
- **Sesión perdida** → se desvincula desde el teléfono, no desde aquí: Ajustes → Dispositivos
  vinculados. Después, `whatsapp-reader login`.
