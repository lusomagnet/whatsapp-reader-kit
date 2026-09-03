import path from 'path';
import fs from 'fs';
import { slugify, writeCorpus } from './extractor.js';

const INVISIBLES_REGEX = /[\u200e\u200f\u2068\u2069\ufeff]/g;

function clean(str) {
  if (!str) return '';
  return str.replace(INVISIBLES_REGEX, '').replace(/\u202f/g, ' ').replace(/\xa0/g, ' ').trim();
}

const TIME = `\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[APap]\\.?\\s?[Mm]\\.?)?`;
const DATE = `\\d{1,4}[/.-]\\d{1,2}[/.-]\\d{2,4}`;

const RE_IOS = new RegExp(`^\\[(${DATE}),?\\s+(${TIME})\\]\\s(.*)$`);
const RE_ANDROID = new RegExp(`^(${DATE}),?\\s+(${TIME})\\s+[-\\u2013]\\s(.*)$`);

const RE_ATTACH_IOS = /<(?:adjunto|attached|anexado|allegato|angeh\w+ngt)\s*:\s*([^>]+)>/i;
const RE_ATTACH_AND = /^(\S+)\s+\((?:archivo adjunto|file attached|ficheiro anexado|arquivo anexado)\)/i;
const RE_OMITTED = /<(?:multimedia|media|imagen|audio|v[ií]deo|sticker)[^>]*(?:omitid[oa]|omitted|omitid[oa]s)>/i;

function parseTimestamp(dateStr, timeStr) {
  try {
    const parts = dateStr.split(/[/.-]/);
    let day, month, year;
    if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      day = parseInt(parts[2], 10);
    } else {
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
      if (year < 100) year += 2000;
    }

    const timeParts = timeStr.replace(/\./g, '').trim().split(/[:\s]/);
    let hour = parseInt(timeParts[0], 10);
    const minute = parseInt(timeParts[1], 10);
    const second = timeParts[2] && !isNaN(parseInt(timeParts[2], 10)) ? parseInt(timeParts[2], 10) : 0;
    const ampm = timeStr.toUpperCase().match(/[AP]M/);

    if (ampm) {
      if (ampm[0] === 'PM' && hour < 12) hour += 12;
      if (ampm[0] === 'AM' && hour === 12) hour = 0;
    }

    const d = new Date(year, month, day, hour, minute, second);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch (e) {
    return null;
  }
}

/**
 * Parsea un archivo .txt de exportación nativa de WhatsApp
 */
export function parseNativeExportTxt(txtContent) {
  const lines = txtContent.split(/\r?\n/);
  const messages = [];
  let current = null;

  for (let rawLine of lines) {
    const line = clean(rawLine);
    if (!line) {
      if (current) current.text += '\n';
      continue;
    }

    const mIos = line.match(RE_IOS);
    const mAnd = !mIos ? line.match(RE_ANDROID) : null;
    const match = mIos || mAnd;

    if (!match) {
      if (current) {
        current.text = (current.text + '\n' + line).trim();
      }
      continue;
    }

    if (current) {
      messages.push(current);
    }

    const dateStr = match[1];
    const timeStr = match[2];
    const rest = clean(match[3]);
    const ts = parseTimestamp(dateStr, timeStr);

    const sepIndex = rest.indexOf(': ');
    if (sepIndex === -1 || sepIndex > 60) {
      // Mensaje de sistema
      current = {
        ts,
        sender: null,
        text: rest,
        type: 'system',
        hasMedia: false,
        media: null,
        mediaKind: null
      };
      continue;
    }

    const sender = rest.substring(0, sepIndex).trim();
    let text = rest.substring(sepIndex + 2).trim();

    let isMedia = false;
    let mediaFile = null;
    let mediaKind = null;

    const attachIos = text.match(RE_ATTACH_IOS);
    const attachAnd = !attachIos ? text.match(RE_ATTACH_AND) : null;

    if (attachIos) {
      isMedia = true;
      mediaFile = clean(attachIos[1]);
      text = text.replace(RE_ATTACH_IOS, '').trim();
    } else if (attachAnd) {
      isMedia = true;
      mediaFile = clean(attachAnd[1]);
      text = '';
    } else if (RE_OMITTED.test(text)) {
      isMedia = true;
      mediaKind = 'omitido';
    }

    current = {
      ts,
      sender,
      text,
      type: isMedia ? 'media' : 'text',
      hasMedia: isMedia,
      media: mediaFile,
      mediaKind: mediaKind || (mediaFile ? path.extname(mediaFile).replace('.', '') : null)
    };
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

/**
 * Ingesta una carpeta o archivo .txt de exportación nativa
 */
export async function ingestNativeExport(inputPath, outDir, { copyMedia = true, transcriber = null } = {}) {
  const stat = fs.statSync(inputPath);
  let txtFiles = [];
  let baseDir = inputPath;

  if (stat.isFile() && inputPath.endsWith('.txt')) {
    txtFiles = [inputPath];
    baseDir = path.dirname(inputPath);
  } else if (stat.isDirectory()) {
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (entry.isFile() && entry.name.endsWith('.txt') && entry.name !== 'index.md' && entry.name !== 'CLAUDE.md') {
          txtFiles.push(full);
        }
      }
    };
    scan(inputPath);
  }

  if (txtFiles.length === 0) {
    throw new Error(`No se encontró ningún archivo .txt en ${inputPath}`);
  }

  const results = [];
  for (const txtFile of txtFiles) {
    const content = fs.readFileSync(txtFile, 'utf-8');
    const messages = parseNativeExportTxt(content);
    if (messages.length === 0) continue;

    let chatName = path.basename(txtFile, '.txt').replace('_chat', '').trim();
    if (!chatName || chatName === 'chat') {
      chatName = path.basename(path.dirname(txtFile));
    }

    // Copiar medias si existen en la carpeta de origen
    if (copyMedia) {
      const srcDir = path.dirname(txtFile);
      const slug = slugify(chatName);
      const targetMediaDir = path.join(outDir, 'chats', slug, 'media');
      fs.mkdirSync(targetMediaDir, { recursive: true });

      for (const msg of messages) {
        if (msg.media) {
          const possibleSrc = path.join(srcDir, msg.media);
          if (fs.existsSync(possibleSrc)) {
            const dst = path.join(targetMediaDir, path.basename(msg.media));
            if (!fs.existsSync(dst)) {
              fs.copyFileSync(possibleSrc, dst);
            }
            msg.media = `media/${path.basename(msg.media)}`;
          }
        }
      }
    }

    const res = await writeCorpus({
      chatName,
      messages,
      outDir,
      copyMedia: false, // Ya copiados manualmente arriba
      transcriber
    });
    results.push(res);
  }

  return results;
}
