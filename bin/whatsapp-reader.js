#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import os from 'os';
import fs from 'fs';
import qrcode from 'qrcode-terminal';

// El corpus contiene datos personales de terceros: por defecto NUNCA dentro del proyecto,
// para que un `git add -A` en el repo clonado no pueda recogerlo.
const DEFAULT_OUT = path.join(os.homedir(), '.whatsapp-reader', 'corpus');
import { launchBrowser, openWhatsApp, checkAuthStatus, getQRCodeData, DEFAULT_SESSION_DIR } from '../src/browser.js';
import { listChats, findChat, fetchMessages, writeCorpus } from '../src/extractor.js';
import { ingestNativeExport } from '../src/ingest-native.js';
import { transcribeAudio } from '../src/transcriber.js';

const program = new Command();

program
  .name('whatsapp-reader')
  .description('Extractor autónomo y corpus generator en modo solo lectura de WhatsApp Web para Claude Code y agentes de IA')
  .version('1.0.0');

/**
 * COMANDO: login
 */
program
  .command('login')
  .description('Inicia sesión vinculando el teléfono mediante código QR (una sola vez)')
  .option('--no-headed', 'Forzar modo headless con QR en terminal')
  .option('--timeout <seconds>', 'Tiempo máximo de espera en segundos', '180')
  .action(async (opts) => {
    console.log('Iniciando navegador para autenticación de WhatsApp Web...');
    console.log(`Directorio de sesión: ${DEFAULT_SESSION_DIR}`);

    const headed = opts.headed !== false && Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    const { browser, page } = await launchBrowser({ headed });

    try {
      console.log('Cargando web.whatsapp.com...');
      await openWhatsApp(page, { timeout: 60000 });

      const maxWait = parseInt(opts.timeout, 10) * 1000;
      const start = Date.now();
      let printedQR = false;

      console.log('\n--- Esperando autenticación ---');
      console.log('1. Abre WhatsApp en tu teléfono');
      console.log('2. Ve a Ajustes / Menú (⋮) → Dispositivos vinculados');
      console.log('3. Toca "Vincular un dispositivo" y escanea el código');

      while (Date.now() - start < maxWait) {
        const status = await checkAuthStatus(page);
        if (status.authenticated) {
          console.log('\n✓ ¡Autenticación exitosa en WhatsApp Web!');
          console.log(`Usuario: ${status.pushName || 'Conectado'}`);
          console.log(`Sesión persistente guardada en: ${DEFAULT_SESSION_DIR}`);
          console.log('Ya puedes usar whatsapp-reader de forma autónoma.');
          await browser.close();
          process.exit(0);
        }

        // Imprimir QR en terminal y además mantener ventana si está en headed
        if (!printedQR) {
          const qrData = await getQRCodeData(page);
          if (qrData) {
            console.log('\nCódigo QR detectado:');
            qrcode.generate(qrData, { small: true });
            printedQR = true;
          }
        }

        await new Promise(r => setTimeout(r, 2500));
      }

      console.error('\n✗ Tiempo de espera agotado sin detectar autenticación.');
      await browser.close();
      process.exit(1);
    } catch (err) {
      console.error(`\n✗ Error durante login: ${err.message}`);
      await browser.close();
      process.exit(1);
    }
  });

/**
 * COMANDO: status
 */
program
  .command('status')
  .description('Comprueba el estado de la sesión de WhatsApp Web')
  .option('--show-id', 'Mostrar tu propio identificador de WhatsApp (es tu número de teléfono)', false)
  .option('--json', 'Salida en formato JSON')
  .action(async (opts) => {
    try {
      const { browser, page } = await launchBrowser({ headed: false });
      await openWhatsApp(page, { timeout: 30000 });
      const status = await checkAuthStatus(page);
      await browser.close();

      if (opts.json) {
        const { myId, ...rest } = status;
        console.log(JSON.stringify({ ...rest, ...(opts.showId ? { myId } : {}), sessionDir: DEFAULT_SESSION_DIR }, null, 2));
      } else {
        if (status.authenticated) {
          console.log('✓ Sesión activa en WhatsApp Web');
          console.log(`- Usuario: ${status.pushName || 'N/A'}`);
          console.log(`- ID: ${opts.showId ? (status.myId || 'N/A') : '[oculto — usa --show-id]'}`);
          console.log(`- Directorio: ${DEFAULT_SESSION_DIR}`);
        } else {
          console.log('✗ No hay sesión autenticada.');
          console.log('Ejecuta "whatsapp-reader login" para vincular tu teléfono.');
        }
      }
      process.exit(status.authenticated ? 0 : 1);
    } catch (err) {
      if (opts.json) {
        console.log(JSON.stringify({ authenticated: false, error: err.message }, null, 2));
      } else {
        console.error(`✗ Error al comprobar estado: ${err.message}`);
      }
      process.exit(1);
    }
  });

/**
 * COMANDO: chats
 */
program
  .command('chats')
  .description('Lista las conversaciones recientes')
  .option('-l, --limit <n>', 'Número máximo de chats a listar', '25')
  .option('--json', 'Salida en formato JSON')
  .action(async (opts) => {
    let browser;
    try {
      const limit = parseInt(opts.limit, 10) || 25;
      const b = await launchBrowser({ headed: false });
      browser = b.browser;
      await openWhatsApp(b.page, { timeout: 35000 });

      const status = await checkAuthStatus(b.page);
      if (!status.authenticated) {
        console.error('✗ No estás autenticado en WhatsApp Web. Ejecuta "whatsapp-reader login".');
        await browser.close();
        process.exit(1);
      }

      const chats = await listChats(b.page, { limit });
      await browser.close();

      if (opts.json) {
        console.log(JSON.stringify(chats, null, 2));
      } else {
        console.log(`\nConversaciones recientes (${chats.length}):\n`);
        console.log('NOMBRE                              | MENSAJES NO LEÍDOS | JID');
        console.log('-----------------------------------------------------------------------------');
        for (const c of chats) {
          const name = (c.name || 'Sin nombre').padEnd(35).substring(0, 35);
          const unread = String(c.unreadCount).padStart(5);
          console.log(`${name} | ${unread}              | ${c.id}`);
        }
        console.log('');
      }
    } catch (err) {
      if (browser) await browser.close();
      console.error(`✗ Error listando chats: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * COMANDO: extract
 */
program
  .command('extract')
  .description('Extrae mensajes y contexto de un chat a un corpus estructurado (messages.jsonl + chat.md)')
  .requiredOption('-c, --chat <name_or_jid>', 'Nombre del contacto/grupo o JID de WhatsApp')
  .option('-l, --limit <n>', 'Número máximo de mensajes a extraer (o "all" para todo)', '50')
  .option('-a, --all', 'Extraer TODO el historial completo de la conversación', false)
  .option('-o, --out <dir>', 'Carpeta de destino para el corpus', DEFAULT_OUT)
  .option('-m, --media', 'Descargar archivos multimedia (audios, fotos, docs)', false)
  .option('-t, --transcribe', 'Transcribir audios y notas de voz con faster-whisper', false)
  .option('--whisper-model <model>', 'Modelo de Whisper (tiny, base, small)', 'base')
  .action(async (opts) => {
    let browser;
    try {
      const outDir = path.resolve(process.cwd(), opts.out);
      const isAll = opts.all || opts.limit === 'all' || opts.limit === '-1';
      const limit = isAll ? -1 : (parseInt(opts.limit, 10) || 50);

      console.log(`Buscando chat "${opts.chat}" en WhatsApp Web...`);
      const b = await launchBrowser({ headed: false });
      browser = b.browser;
      await openWhatsApp(b.page, { timeout: 35000 });

      const status = await checkAuthStatus(b.page);
      if (!status.authenticated) {
        console.error('✗ No estás autenticado en WhatsApp Web. Ejecuta "whatsapp-reader login".');
        await browser.close();
        process.exit(1);
      }

      const target = await findChat(b.page, opts.chat);
      if (!target) {
        console.error(`✗ No se encontró ningún chat que coincida con "${opts.chat}".`);
        console.log('Tip: Ejecuta "whatsapp-reader chats" para ver la lista de conversaciones.');
        await browser.close();
        process.exit(1);
      }

      console.log(`✓ Chat localizado: "${target.name}" (${target.id})`);
      if (isAll) {
        console.log('Extrayendo TODO el historial de la conversación (paginando hacia atrás)...');
      } else {
        console.log(`Extrayendo los últimos ${limit} mensajes...`);
      }

      const messages = await fetchMessages(b.page, target.id, { limit });
      console.log(`Se obtuvieron ${messages.length} mensajes.`);

      let transcriber = null;
      if (opts.transcribe) {
        transcriber = (filePath) => transcribeAudio(filePath, { model: opts.whisperModel });
      }

      console.log(`Generando corpus estructurado en: ${outDir}...`);
      const result = await writeCorpus({
        chatName: target.name,
        messages,
        outDir,
        page: b.page,
        copyMedia: opts.media,
        transcriber
      });

      await browser.close();

      console.log('\n✓ Extracción completada con éxito:');
      console.log(`- Carpeta: ${result.chatDir}`);
      console.log(`- Mensajes: ${result.totalMessages}`);
      console.log(`- Audios: ${result.audios} (transcritos: ${result.transcritos})`);
      console.log(`- Formatos: messages.jsonl (filtros jq) · chat.md (lectura) · index.md\n`);
    } catch (err) {
      if (browser) await browser.close();
      console.error(`✗ Error durante la extracción: ${err.message}`);
      process.exit(1);
    }
  });

/**
 * COMANDO: ingest
 */
program
  .command('ingest <path>')
  .description('Ingesta archivos de exportación nativa (.txt o carpeta con .zip extraído) al corpus estructurado')
  .option('-o, --out <dir>', 'Carpeta de destino para el corpus', DEFAULT_OUT)
  .option('-m, --media', 'Copiar archivos multimedia asociados', false)
  .option('-t, --transcribe', 'Transcribir audios con faster-whisper', false)
  .option('--whisper-model <model>', 'Modelo de Whisper (tiny, base, small)', 'base')
  .action(async (inputPath, opts) => {
    try {
      const resolvedInput = path.resolve(process.cwd(), inputPath);
      const outDir = path.resolve(process.cwd(), opts.out);

      let transcriber = null;
      if (opts.transcribe) {
        transcriber = (filePath) => transcribeAudio(filePath, { model: opts.whisperModel });
      }

      console.log(`Ingestando exportación nativa desde: ${resolvedInput}...`);
      const results = await ingestNativeExport(resolvedInput, outDir, {
        copyMedia: opts.media,
        transcriber
      });

      console.log(`\n✓ Ingesta finalizada (${results.length} chats procesados):`);
      for (const r of results) {
        console.log(`- ${r.slug}: ${r.totalMessages} mensajes`);
      }
      console.log(`Corpus disponible en: ${outDir}\n`);
    } catch (err) {
      console.error(`✗ Error durante ingesta: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
