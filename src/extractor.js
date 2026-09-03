import path from 'path';
import fs from 'fs';

/**
 * Normaliza nombres para carpetas (slug kebab-case)
 */
export function slugify(name) {
  if (!name) return 'chat';
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
}

/**
 * Determina el tipo de media según el tipo de mensaje de WhatsApp
 */
export function getMediaKind(type, mimetype = '') {
  if (type === 'ptt' || type === 'audio' || mimetype.startsWith('audio/')) return 'audio';
  if (type === 'image' || mimetype.startsWith('image/')) return 'image';
  if (type === 'video' || mimetype.startsWith('video/')) return 'video';
  if (type === 'document' || mimetype.includes('pdf') || mimetype.includes('sheet') || mimetype.includes('word')) return 'document';
  return 'file';
}

/**
 * Lista chats recientes de WhatsApp Web
 */
export async function listChats(page, { limit = 30 } = {}) {
  return await page.evaluate(async (max) => {
    if (!window.WPP?.chat?.list) {
      throw new Error('WPP.chat.list no está disponible');
    }

    const chats = await window.WPP.chat.list({ count: max * 2 });
    return chats
      .slice(0, max)
      .map(c => ({
        id: c.id?._serialized || String(c.id),
        name: c.name || c.formattedTitle || c.contact?.pushname || c.contact?.name || c.id?.user || 'Sin nombre',
        isGroup: !!c.isGroup,
        unreadCount: c.unreadCount || 0,
        timestamp: c.t ? new Date(c.t * 1000).toISOString() : null
      }));
  }, limit);
}

/**
 * Busca un chat por nombre, teléfono o JID
 */
export async function findChat(page, query) {
  return await page.evaluate(async (q) => {
    const chats = await window.WPP.chat.list({ count: 100 });
    const cleanQ = q.trim().toLowerCase();

    // 1. Coincidencia exacta de ID/JID
    let found = chats.find(c => (c.id?._serialized || '').toLowerCase() === cleanQ);
    if (found) return { id: found.id._serialized, name: found.name || found.formattedTitle || found.id.user };

    // 2. Coincidencia exacta o parcial de nombre
    found = chats.find(c => {
      const name = (c.name || c.formattedTitle || c.contact?.pushname || c.contact?.name || '').toLowerCase();
      return name === cleanQ || name.includes(cleanQ);
    });

    if (found) {
      return {
        id: found.id._serialized,
        name: found.name || found.formattedTitle || found.contact?.pushname || found.contact?.name || found.id.user
      };
    }

    // 3. Buscar por número de teléfono
    found = chats.find(c => (c.id?.user || '').includes(cleanQ));
    if (found) {
      return {
        id: found.id._serialized,
        name: found.name || found.formattedTitle || found.id.user
      };
    }

    return null;
  }, query);
}

/**
 * Extrae mensajes de un chat
 */
export async function fetchMessages(page, chatId, { limit = 50 } = {}) {
  const rows = await page.evaluate(async (jid, maxLimit) => {
    if (!window.WPP?.chat?.getMessages) {
      throw new Error('WPP.chat.getMessages no está disponible');
    }

    const fetchAll = maxLimit === -1 || maxLimit === 'all' || maxLimit === Infinity;
    const targetCount = fetchAll ? Infinity : parseInt(maxLimit, 10);

    let allMsgs = [];
    const seenIds = new Set();
    let oldestId = null;

    // Obtener primer lote
    const initialBatch = await window.WPP.chat.getMessages(jid, { count: Math.min(targetCount, 100) });
    if (initialBatch && initialBatch.length > 0) {
      for (const m of initialBatch) {
        const id = m.id?._serialized || String(m.id);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allMsgs.push(m);
        }
      }
      allMsgs.sort((a, b) => (a.t || 0) - (b.t || 0));
      oldestId = allMsgs[0]?.id?._serialized || String(allMsgs[0]?.id);
    }

    // Paginación hacia atrás si se pide todo el historial o más mensajes
    while (allMsgs.length < targetCount) {
      if (!oldestId) break;

      const batchSize = Math.min(targetCount - allMsgs.length, 100);
      const batch = await window.WPP.chat.getMessages(jid, {
        count: batchSize,
        direction: 'before',
        id: oldestId
      });

      if (!batch || batch.length === 0) break;

      let newFound = 0;
      for (const m of batch) {
        const id = m.id?._serialized || String(m.id);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allMsgs.push(m);
          newFound++;
        }
      }

      allMsgs.sort((a, b) => (a.t || 0) - (b.t || 0));
      const nextOldest = allMsgs[0]?.id?._serialized || String(allMsgs[0]?.id);
      if (nextOldest === oldestId || newFound === 0) {
        break; // Se alcanzó el principio absoluto del chat
      }
      oldestId = nextOldest;
    }

    // Ordenar cronológicamente
    allMsgs.sort((a, b) => (a.t || 0) - (b.t || 0));

    return allMsgs.map(m => {
      const isMedia = !!m.isMedia || !!m.mimetype || m.type === 'image' || m.type === 'video' || m.type === 'audio' || m.type === 'ptt' || m.type === 'document';
      const fromMe = !!(m.fromMe ?? m.id?.fromMe); // WPP expone fromMe dentro de m.id
      const senderName = fromMe
        ? 'Tú'
        : (m.sender?.pushname || m.sender?.formattedName || m.sender?.name || m.sender?.id?.user || 'Contacto');

      return {
        id: m.id?._serialized || String(m.id),
        chatId: jid,
        ts: m.t ? new Date(m.t * 1000).toISOString() : null,
        sender: senderName,
        fromMe,
        type: isMedia ? 'media' : (m.type || 'text'),
        text: m.body || m.caption || '',
        rawType: m.type || null,
        mimetype: m.mimetype || null,
        filename: m.filename || (m.type === 'ptt' ? `${m.id?.id || 'audio'}.opus` : null),
        hasMedia: isMedia
      };
    });
  }, chatId, limit);
  // mediaKind se calcula en Node: getMediaKind no existe dentro del navegador (page.evaluate).
  return rows.map(({ rawType, ...r }) => ({ ...r, mediaKind: r.hasMedia ? getMediaKind(rawType, r.mimetype || '') : null }));
}

/**
 * Descarga el contenido multimedia descifrado de un mensaje
 */
export async function downloadMessageMedia(page, msgId) {
  return await page.evaluate(async (mid) => {
    if (!window.WPP?.chat?.downloadMedia) {
      return null;
    }
    try {
      const blob = await window.WPP.chat.downloadMedia(mid);
      if (!blob) return null;

      // Convertir Blob a Base64 dataURL
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }, msgId);
}

/**
 * Guarda los mensajes y la multimedia en el corpus estructurado
 */
export async function writeCorpus({ chatName, messages, outDir, page = null, copyMedia = false, transcriber = null }) {
  const slug = slugify(chatName);
  const chatDir = path.join(outDir, 'chats', slug);
  const mediaDir = path.join(chatDir, 'media');

  fs.mkdirSync(chatDir, { recursive: true });
  if (copyMedia) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const jsonl = [];
  const mdLines = [];
  let nAudio = 0;
  let nTranscribed = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const rec = {
      id: m.id || `${slug}-${String(i).padStart(6, '0')}`,
      chat: chatName,
      ts: m.ts,
      sender: m.sender,
      type: m.type,
      text: m.text,
      media: null,
      media_kind: m.mediaKind || (m.hasMedia ? getMediaKind(m.type, m.mimetype) : null),
      transcript: null
    };

    if (m.hasMedia && copyMedia && page) {
      try {
        const dataUrl = await downloadMessageMedia(page, m.id);
        if (dataUrl && dataUrl.startsWith('data:')) {
          const parts = dataUrl.split(',');
          const base64Data = parts[1];
          const ext = rec.media_kind === 'audio' ? '.opus' : (rec.media_kind === 'image' ? '.jpg' : '.bin');
          const safeFileName = m.filename || `media-${rec.id}${ext}`;
          const filePath = path.join(mediaDir, safeFileName);
          
          fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
          rec.media = `media/${safeFileName}`;

          if (rec.media_kind === 'audio') {
            nAudio++;
            if (transcriber) {
              process.stdout.write(`\r  [${nAudio}] Transcribiendo nota de voz (${safeFileName})...`);
              try {
                rec.transcript = await transcriber(filePath);
                nTranscribed++;
              } catch (err) {
                rec.transcript = `[error de transcripción: ${err.message}]`;
              }
            }
          }
        }
      } catch (err) {
        // Fallback silencioso si falla la descarga puntual
      }
    } else if (m.media) {
      rec.media = m.media;
      rec.media_kind = m.media_kind;
      if (m.transcript) rec.transcript = m.transcript;
    }

    jsonl.push(rec);

    const stamp = rec.ts ? rec.ts.substring(0, 16).replace('T', ' ') : '??';
    const who = rec.sender || 'SISTEMA';
    let body = rec.text || '';
    if (rec.media_kind) {
      const tag = `[${rec.media_kind}: ${rec.media || 'adjunto'}]`;
      body = (body ? body + ' ' : '') + tag;
    }
    if (rec.transcript) {
      body += `\n    > transcripción: ${rec.transcript}`;
    }
    mdLines.append ? mdLines.push(`- **${stamp}** — ${who}: ${body}`) : mdLines.push(`- **${stamp}** — ${who}: ${body}`);
  }

  // Guardar messages.jsonl
  fs.writeFileSync(
    path.join(chatDir, 'messages.jsonl'),
    jsonl.map(r => JSON.stringify(r)).join('\n') + '\n',
    'utf-8'
  );

  // Guardar chat.md
  const dated = jsonl.map(r => r.ts).filter(Boolean);
  const header = [
    `# ${chatName}`,
    '',
    dated.length > 0 ? `Periodo: ${dated[0].substring(0, 10)} → ${dated[dated.length - 1].substring(0, 10)}` : '',
    `Mensajes: ${jsonl.length} · audios: ${nAudio} (transcritos: ${nTranscribed})`,
    ''
  ].filter(l => l !== '');

  fs.writeFileSync(
    path.join(chatDir, 'chat.md'),
    header.concat(mdLines).join('\n') + '\n',
    'utf-8'
  );

  // Guardar / Actualizar index.md en outDir
  updateCorpusIndex(outDir, {
    name: chatName,
    slug,
    messages: jsonl.length,
    audios: nAudio,
    transcritos: nTranscribed,
    desde: dated.length > 0 ? dated[0].substring(0, 10) : null,
    hasta: dated.length > 0 ? dated[dated.length - 1].substring(0, 10) : null
  });

  // Guardar CLAUDE.md en outDir si no existe
  writeCorpusClaudeMd(outDir);

  return {
    slug,
    chatDir,
    totalMessages: jsonl.length,
    audios: nAudio,
    transcritos: nTranscribed
  };
}

/**
 * Actualiza el índice general index.md del corpus
 */
function updateCorpusIndex(outDir, summary) {
  const indexPath = path.join(outDir, 'index.md');
  let currentContent = '';
  if (fs.existsSync(indexPath)) {
    currentContent = fs.readFileSync(indexPath, 'utf-8');
  } else {
    currentContent = '# Índice de Chats de WhatsApp\n\nCorpus de conversaciones extraídas para contexto de IA.\n\n';
  }

  const chatEntryHeader = `## ${summary.name}`;
  const newEntry = [
    chatEntryHeader,
    `- Carpeta: \`chats/${summary.slug}/\``,
    `- Periodo: ${summary.desde || 'N/A'} → ${summary.hasta || 'N/A'}`,
    `- Mensajes: ${summary.messages} · audios: ${summary.audios} (transcritos: ${summary.transcritos})`,
    ''
  ].join('\n');

  if (currentContent.includes(chatEntryHeader)) {
    // Reemplazar la sección existente
    const regex = new RegExp(`## ${escapeRegex(summary.name)}[\\s\\S]*?(?=\\n## |$)`);
    currentContent = currentContent.replace(regex, newEntry.trim() + '\n\n');
  } else {
    currentContent += newEntry + '\n';
  }

  fs.writeFileSync(indexPath, currentContent.trim() + '\n', 'utf-8');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Crea las instrucciones para Claude Code dentro del directorio del corpus
 */
function writeCorpusClaudeMd(outDir) {
  const claudeMdPath = path.join(outDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) return;

  const content = `# Corpus de WhatsApp

Datos extraídos de WhatsApp en modo solo lectura.

> **Estos ficheros son datos personales de terceros.** Contienen mensajes, y puede que media y
> transcripciones, de personas que no han consentido este tratamiento. No los metas en un
> repositorio, no los subas a ningún servicio y bórralos cuando dejes de necesitarlos.
> La transcripción de audio **no** es local la primera vez: descarga el modelo de Whisper desde
> huggingface.co. El resto del procesamiento sí ocurre en esta máquina.

## Estructura

- \`index.md\` — resumen de cada chat: periodo, volumen y participantes.
- \`chats/<slug>/messages.jsonl\` — una línea JSON por mensaje. **Usa esto para filtrar y contar con jq/rg.**
- \`chats/<slug>/chat.md\` — el chat en texto legible. **Usa esto para leer contexto continuo.**
- \`chats/<slug>/media/\` — audios (.opus), imágenes y documentos asociados.

## Consultas útiles

1. **Buscar un término en todo el corpus:**
   \`rg -i "termino" chats/ -g '*.jsonl'\`
2. **Filtrar por remitente o fecha con jq:**
   \`jq -c 'select(.sender=="Nombre" and (.ts|startswith("YYYY-MM")))' chats/<slug>/messages.jsonl\`
3. **Audios transcritos:**
   \`jq -c 'select(.transcript!=null)' chats/<slug>/messages.jsonl\`
4. **Leer contexto cronológico:** Abre \`chats/<slug>/chat.md\` en el tramo de interés.

## Reglas

- Cita siempre el \`id\` y la fecha del mensaje del que tomas una afirmación.
- Si una información no aparece en los chats extraídos, indícalo claramente.
`;

  fs.writeFileSync(claudeMdPath, content, 'utf-8');
}
