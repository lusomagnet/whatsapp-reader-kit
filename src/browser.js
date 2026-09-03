import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import puppeteer from 'puppeteer-core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_SESSION_DIR = process.env.WA_SESSION_DIR || path.join(os.homedir(), '.whatsapp-reader', 'session');

// La raíz del paquete: la sesión JAMÁS puede vivir dentro de ella. El perfil de Chromium pesa
// ~160 MB y contiene las claves del dispositivo vinculado — equivale a tu teléfono. Apuntar
// WA_SESSION_DIR al proyecto ("hacerlo autocontenido") lo metería en el índice de git.
const PKG_ROOT = path.resolve(__dirname, '..');
export function assertSessionDirOutsideRepo(dir) {
  const resolved = path.resolve(dir);
  const rel = path.relative(PKG_ROOT, resolved);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(
      `WA_SESSION_DIR no puede estar dentro del proyecto (${resolved}).\n` +
      'La sesión es una credencial equivalente a un dispositivo vinculado: guárdala fuera del repo, ' +
      `por ejemplo ${path.join(os.homedir(), '.whatsapp-reader', 'session')}.`
    );
  }
  return resolved;
}
export const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
export const WA_URL = 'https://web.whatsapp.com';
export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const WA_JS_PATH = path.resolve(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js');

/**
 * Launch Chromium with persistent context
 */
export async function launchBrowser({ headed = false, sessionDir = DEFAULT_SESSION_DIR } = {}) {
  sessionDir = assertSessionDirOutsideRepo(sessionDir);
  if (!fs.existsSync(CHROMIUM_PATH)) {
    throw new Error(`Chromium no encontrado en ${CHROMIUM_PATH}. Comprueba que chromium esté instalado.`);
  }

  fs.mkdirSync(sessionDir, { recursive: true });

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--window-size=1280,800',
    `--user-data-dir=${sessionDir}`
  ];

  const browser = await puppeteer.launch({
    headless: !headed,
    executablePath: CHROMIUM_PATH,
    userDataDir: sessionDir,
    defaultViewport: { width: 1280, height: 800 },
    args
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  await page.setUserAgent(USER_AGENT);
  await page.setBypassCSP(true);

  return { browser, page };
}

/**
 * Injects WPPConnect wa-js into WhatsApp Web
 */
export async function injectWAJS(page) {
  if (!fs.existsSync(WA_JS_PATH)) {
    throw new Error(`wa-js bundle no encontrado en ${WA_JS_PATH}`);
  }

  await page.addScriptTag({ path: WA_JS_PATH });

  // Esperar a que WPP esté expuesto en window
  await page.waitForFunction(() => typeof window.WPP !== 'undefined', { timeout: 15000 });
}

/**
 * Navega a WhatsApp Web y comprueba el estado de sesión
 */
export async function openWhatsApp(page, { timeout = 45000 } = {}) {
  const currentUrl = page.url();
  if (!currentUrl.includes('web.whatsapp.com')) {
    await page.goto(WA_URL, { waitUntil: 'domcontentloaded', timeout });
  }

  // Esperar a que aparezca o la pantalla principal o el QR
  try {
    await page.waitForSelector('canvas, div[data-ref], #pane-side, [data-testid="chat-list"]', { timeout });
  } catch (err) {
    // Continuar para comprobar el estado real
  }

  // Inyectar wa-js
  try {
    await injectWAJS(page);
  } catch (e) {
    // Si la página aún está cargando el bundle principal, reintentar tras unos segundos
    await new Promise(r => setTimeout(r, 3000));
    await injectWAJS(page);
  }
}

/**
 * Comprueba si la sesión está autenticada
 */
export async function checkAuthStatus(page) {
  return await page.evaluate(async () => {
    if (!window.WPP) return { ready: false, authenticated: false, reason: 'WPP not loaded' };
    
    const isReady = window.WPP.webpack?.isReady;
    const isLogged = window.WPP.conn?.isMainLoaded?.() || window.WPP.conn?.isRegistered?.() || false;
    const myId = window.WPP.conn?.getMyUserId?.() || null;
    const pushName = window.WPP.conn?.getPushname?.() || null;

    return {
      ready: !!isReady,
      authenticated: !!isLogged,
      myId,
      pushName
    };
  });
}

/**
 * Obtiene el código QR actual si no está autenticado
 */
export async function getQRCodeData(page) {
  return await page.evaluate(() => {
    // Buscar elemento con data-ref (código QR de WhatsApp Web)
    const qrContainer = document.querySelector('div[data-ref]');
    if (qrContainer) {
      return qrContainer.getAttribute('data-ref');
    }
    return null;
  });
}
