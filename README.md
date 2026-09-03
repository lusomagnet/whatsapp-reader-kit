# whatsapp-reader-kit

CLI de **solo lectura** que convierte una conversación de **WhatsApp Web** en un corpus estructurado
—`messages.jsonl`, `chat.md`, media descargada y transcripción de las notas de voz— pensado para que
un agente de IA lo consulte. Incluye una **skill de Claude Code**. Node + Python (la mitad Python
solo hace falta para transcribir).

> ## ⚠️ Léelo antes de instalar
>
> - **Automatizar WhatsApp incumple sus Condiciones de Servicio, y la sanción cae sobre tu número de
>   teléfono**, que probablemente es también tu canal de doble factor y de banca. Asumes ese riesgo
>   tú. Úsalo solo con **tu** cuenta y a ritmo humano.
> - **No afiliado a WhatsApp ni a Meta.** Usa `@wppconnect/wa-js`, una librería de ingeniería inversa
>   de WhatsApp Web.
> - **El directorio de sesión es una credencial**, equivalente a tener tu teléfono vinculado. Vive en
>   `~/.whatsapp-reader/session` y nunca debe entrar en un repositorio, un backup compartido ni una
>   captura de pantalla.
> - **El corpus contiene datos personales de terceros.** Quien lo extrae es el responsable del
>   tratamiento a efectos del RGPD. Las personas de esos chats no han consentido nada.
> - **`--transcribe` crea datos personales nuevos**: convierte la voz de otras personas en texto
>   indexable y buscable.
> - **El QR que imprime `login` es una credencial viva.** No lo compartas, no lo canalices a un
>   fichero, no lo enseñes en un directo.

## Qué significa «solo lectura» aquí

Ninguna orden de esta CLI envía, reacciona, borra ni marca como leído. Dicho eso, con precisión:

- Abrir WhatsApp Web **pone tu cuenta en línea**, y tus contactos lo ven. La ingesta de exportaciones
  nativas (`ingest`) no tiene ese efecto: si te sirve, es la vía preferible.
- La librería que se inyecta en la página **sí expone** funciones de escritura (enviar, borrar,
  marcar leído). Este kit no las llama, pero están ahí: «solo lectura» es una **convención de esta
  CLI**, no una barrera del motor.

## Arquitectura

- **Navegador:** `puppeteer-core` contra un Chromium del sistema con **contexto persistente** en
  `~/.whatsapp-reader/session` (`WA_SESSION_DIR` lo cambia; se rechaza cualquier ruta dentro del
  propio proyecto). `PUPPETEER_EXECUTABLE_PATH` apunta al binario si no está en `/usr/bin/chromium`.
- **Extracción:** se inyecta `@wppconnect/wa-js` en la página y se pagina hacia atrás sobre el store
  de la propia web. No hay servidor intermedio ni API de terceros.
- **Transcripción:** `faster-whisper` en un subproceso Python (`compute_type=int8`, CPU). La primera
  vez descarga el modelo desde huggingface.co a `~/.cache/huggingface`.
- **Salida:** el corpus se escribe por defecto en `~/.whatsapp-reader/corpus`, **fuera** de cualquier
  árbol de git, para que un `git add -A` no pueda recogerlo.

## Instalación

```bash
git clone https://github.com/lusomagnet/whatsapp-reader-kit.git && cd whatsapp-reader-kit
bash install.sh          # deps npm + venv opcional + skill + enlace en PATH
whatsapp-reader login    # paso humano: escanea el QR desde tu teléfono (una vez)
whatsapp-reader status
```

Requisitos: **Node ≥ 18**, un **Chromium** del sistema y, solo para `--transcribe`, **Python 3** con
`venv`.

## Uso

```bash
whatsapp-reader status                    # ¿hay sesión?
whatsapp-reader chats --limit 20          # listar conversaciones (--json para procesar con jq)

# Extraer al corpus (destino por defecto: ~/.whatsapp-reader/corpus)
whatsapp-reader extract --chat "Nombre o JID" --limit 50
whatsapp-reader extract --chat "Nombre o JID" --limit 100 --media --transcribe
whatsapp-reader extract --chat "Nombre o JID" --all --media --transcribe

# Ingesta de una exportación nativa del móvil (no abre el navegador, no toca la cuenta)
whatsapp-reader ingest /ruta/a/_chat.txt --media --transcribe
```

Estructura generada:

```
index.md                      resumen: totales de mensajes, audios y fechas
chats/<slug>/chat.md          hilo legible en orden cronológico
chats/<slug>/messages.jsonl   una línea JSON por mensaje (id, ts, sender, text, media, transcript)
chats/<slug>/media/           ficheros descargados (.opus, .jpg, .pdf…)
```

`status` **no** imprime tu identificador de WhatsApp, porque es tu número de teléfono. Si lo
necesitas de verdad, `--show-id`.

## Skill de Claude Code

`install.sh` copia `skills/whatsapp-reader/` a `~/.claude/skills/whatsapp-reader/`. La skill conduce
la CLI y lleva los guardarraíles de privacidad escritos, para que el agente no extraiga de más ni
vuelque conversaciones ajenas en un informe. **El repositorio es la fuente de verdad**: edita la
skill aquí y re-ejecuta el instalador, no al revés.

## Compromisos de seguridad que conviene conocer

- El navegador se lanza con `--no-sandbox` y `--disable-setuid-sandbox`, y se hace
  `setBypassCSP(true)` para poder inyectar la librería. Es un apaño para entornos con contenedor
  (Crostini y similares) donde el sandbox de Chromium no arranca: **baja las defensas del navegador**.
  Si tu sistema no lo necesita, quítalos en `src/browser.js`.
- El perfil persistente de Chromium ocupa ~160 MB e incluye las claves del dispositivo vinculado.
  `chmod 700 ~/.whatsapp-reader` y trátalo como tratarías tu teléfono.
- Para desvincular: en tu teléfono, Ajustes → Dispositivos vinculados → cerrar la sesión, y borra
  `~/.whatsapp-reader/session`.

## Desinstalar

```bash
rm -rf ~/.claude/skills/whatsapp-reader
rm -f  ~/.local/bin/whatsapp-reader
rm -rf ~/.whatsapp-reader          # sesión Y corpus: revisa antes qué hay dentro
# y desvincula el dispositivo desde tu teléfono
```

## Créditos

De [Jesús Manuel Ferreira Andara](https://github.com/elchamoluso). Mismo patrón de kit que
[`skool-mcp-kit`](https://github.com/elchamoluso/skool-mcp-kit) y
[`linkedin-mcp-kit`](https://github.com/elchamoluso/linkedin-mcp-kit).
Usa [`@wppconnect/wa-js`](https://github.com/wppconnect-team/wa-js) (Apache-2.0) y
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (MIT). Licencia MIT.
