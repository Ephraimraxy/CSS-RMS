/**
 * Baileys WhatsApp client — session persisted in SystemSetting (DB)
 * so it survives Railway redeploys without re-scanning the QR code.
 *
 * Usage:
 *   const { sendWhatsApp, getQrDataUrl, getStatus } = require('./lib/whatsapp');
 *
 * On first run: call getQrDataUrl() from the admin QR endpoint, scan with
 * the WhatsApp number you want to send from, and the session is saved to DB.
 * Subsequent restarts restore from DB — no re-scan needed.
 */

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  proto,
  BufferJSON,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

// ── DB-backed auth state ───────────────────────────────────────────────────
// Stores the entire Baileys auth state as two keys in SystemSetting:
//   wa_session_creds  →  JSON string of account credentials
//   wa_session_keys   →  JSON string of signal-protocol key store

let prismaClient = null;
const SESSION_CREDS_KEY = 'wa_session_creds';
const SESSION_KEYS_KEY  = 'wa_session_keys';

function setPrisma(p) { prismaClient = p; }

async function readDbKey(key) {
  if (!prismaClient) return null;
  try {
    const row = await prismaClient.systemSetting.findUnique({ where: { key } });
    return row ? row.value : null;
  } catch { return null; }
}

async function writeDbKey(key, value) {
  if (!prismaClient) return;
  try {
    await prismaClient.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  } catch (e) {
    silentLogger.error({ err: e.message }, '[WA] Failed to persist session key: ' + key);
  }
}

async function useDbAuthState() {
  let creds;
  const credsJson = await readDbKey(SESSION_CREDS_KEY);
  if (credsJson) {
    try { creds = JSON.parse(credsJson, BufferJSON.reviver); }
    catch { creds = initAuthCreds(); }
  } else {
    creds = initAuthCreds();
  }

  // In-memory key store, synced to DB on every write
  let keyStore = {};
  const keysJson = await readDbKey(SESSION_KEYS_KEY);
  if (keysJson) {
    try { keyStore = JSON.parse(keysJson, BufferJSON.reviver); }
    catch { keyStore = {}; }
  }

  const saveKeys = async () => {
    await writeDbKey(SESSION_KEYS_KEY, JSON.stringify(keyStore, BufferJSON.replacer));
  };

  const keys = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const val = keyStore[`${type}-${id}`];
        if (val !== undefined) data[id] = val;
      }
      return data;
    },
    set: async (data) => {
      for (const [type, ids] of Object.entries(data)) {
        for (const [id, val] of Object.entries(ids || {})) {
          if (val) keyStore[`${type}-${id}`] = val;
          else delete keyStore[`${type}-${id}`];
        }
      }
      await saveKeys();
    },
  };

  return {
    state:      { creds, keys },
    saveCreds:  async () => {
      await writeDbKey(SESSION_CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer));
    },
  };
}

// ── Client state ───────────────────────────────────────────────────────────
const silentLogger = pino({ level: 'silent' });

let sock           = null;
let currentQr      = null;  // raw QR string (for generating an image)
let status         = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let reconnectTimer = null;
let saveCreds      = null;

// Queue: { phone, message, resolve, reject }[]
const queue = [];
let processingQueue = false;
const BATCH_DELAY_MS = 3 * 60 * 1000; // 3 minutes between batch messages

// ── Send queue ─────────────────────────────────────────────────────────────
async function drainQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (queue.length > 0) {
    if (status !== 'connected') {
      // Re-queue the item and wait for reconnect
      processingQueue = false;
      return;
    }
    const item = queue.shift();
    try {
      const jid = normalizeToJid(item.phone);
      await sock.sendMessage(jid, { text: item.message });
      item.resolve();
    } catch (e) {
      item.reject(e);
    }
    // Only delay if there are more items left (batch anti-ban spacing)
    if (queue.length > 0) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  processingQueue = false;
}

function normalizeToJid(phone) {
  // Strip non-digits, ensure +234 → 234
  const digits = phone.replace(/\D/g, '');
  // Nigerian: 0XXXXXXXXXX → 234XXXXXXXXXX
  const normalized = digits.startsWith('0') ? '234' + digits.slice(1) : digits;
  return `${normalized}@s.whatsapp.net`;
}

// ── Connect ────────────────────────────────────────────────────────────────
async function connect() {
  if (status === 'connecting' || status === 'connected') return;
  status = 'connecting';
  currentQr = null;

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds: sc } = await useDbAuthState();
  saveCreds = sc;

  sock = makeWASocket({
    version,
    logger: silentLogger,
    printQRInTerminal: false, // we serve it via admin endpoint
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    generateHighQualityLinkPreview: false,
    // Mark all messages as read so we don't seem like a ghost account
    markOnlineOnConnect: false,
    // Minimal browser fingerprint
    browser: ['CSS RMS', 'Chrome', '10.0'],
  });

  sock.ev.on('creds.update', () => saveCreds && saveCreds());

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = qr;
      status = 'qr_ready';
    }

    if (connection === 'open') {
      status = 'connected';
      currentQr = null;
      silentLogger.info('[WA] Connected to WhatsApp');
      drainQueue();
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      status = 'disconnected';
      sock = null;

      if (code === DisconnectReason.loggedOut) {
        // Wipe session from DB — user must scan QR again
        await writeDbKey(SESSION_CREDS_KEY, '');
        await writeDbKey(SESSION_KEYS_KEY, '');
      }

      if (shouldReconnect) {
        // Exponential back-off: 5s first, then 30s
        const delay = reconnectTimer ? 30_000 : 5_000;
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
      }
    }
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message.
 * Non-blocking — resolves when the message is actually sent (may be delayed
 * if in batch mode or not yet connected).
 */
function sendWhatsApp(phone, message) {
  return new Promise((resolve, reject) => {
    if (!phone) return reject(new Error('Phone number required'));
    queue.push({ phone, message, resolve, reject });
    if (status === 'connected') drainQueue();
  });
}

/**
 * Returns a data: URI PNG of the current QR code, or null if not waiting.
 */
async function getQrDataUrl() {
  if (!currentQr) return null;
  return QRCode.toDataURL(currentQr, { margin: 2, width: 300 });
}

/** Returns 'disconnected' | 'connecting' | 'qr_ready' | 'connected' */
function getStatus() { return status; }

/** Disconnect cleanly (used in tests / graceful shutdown) */
async function disconnect() {
  if (sock) { await sock.logout(); sock = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  status = 'disconnected';
}

module.exports = { setPrisma, connect, sendWhatsApp, getQrDataUrl, getStatus, disconnect };
