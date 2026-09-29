/**
 * WhatsApp notification module — supports two providers:
 *
 *   WHATSAPP_PROVIDER=baileys  (default) — Baileys unofficial API, session
 *                                          persisted in DB, scan QR once
 *   WHATSAPP_PROVIDER=meta               — Meta WhatsApp Cloud API (official)
 *
 * Env vars needed per provider:
 *   Baileys: (none beyond WHATSAPP_ENABLED=true)
 *   Meta:    WHATSAPP_META_TOKEN      — permanent token from Meta dashboard
 *            WHATSAPP_META_PHONE_ID   — phone number ID from Meta dashboard
 *
 * Public API (same regardless of provider):
 *   sendWhatsApp(phone, message) → Promise
 *   getQrDataUrl()               → Promise<string|null>  (Baileys only)
 *   getStatus()                  → string
 *   connect()                    → Promise  (Baileys: open socket; Meta: no-op)
 *   setPrisma(p)                 → void     (Baileys: needed for session store)
 */

// ══════════════════════════════════════════════════════════════════════════════
// ── META CLOUD API PROVIDER ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function normalizeE164(phone) {
  const digits = phone.replace(/\D/g, '');
  // Nigerian 0XXXXXXXXXX → 234XXXXXXXXXX
  return digits.startsWith('0') ? '234' + digits.slice(1) : digits;
}

const metaProvider = {
  getStatus() { return 'connected'; },

  async connect() { /* no-op for Meta — it's stateless HTTP */ },

  setPrisma() { /* no-op */ },

  async getQrDataUrl() { return null; },

  async sendWhatsApp(phone, message) {
    const token   = process.env.WHATSAPP_META_TOKEN;
    const phoneId = process.env.WHATSAPP_META_PHONE_ID;
    if (!token || !phoneId) throw new Error('WHATSAPP_META_TOKEN and WHATSAPP_META_PHONE_ID must be set.');

    const to = normalizeE164(phone);
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta WA API error ${res.status}: ${JSON.stringify(err)}`);
    }
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// ── BAILEYS PROVIDER ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  initAuthCreds,
  BufferJSON,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino   = require('pino');

const silentLogger = pino({ level: 'silent' });

// ── DB-backed auth state ───────────────────────────────────────────────────
const SESSION_CREDS_KEY = 'wa_session_creds';
const SESSION_KEYS_KEY  = 'wa_session_keys';

let _prisma = null;

async function readDbKey(key) {
  if (!_prisma) return null;
  try {
    const row = await _prisma.systemSetting.findUnique({ where: { key } });
    return row?.value || null;
  } catch { return null; }
}

async function writeDbKey(key, value) {
  if (!_prisma) return;
  try {
    await _prisma.systemSetting.upsert({
      where:  { key },
      create: { key, value },
      update: { value },
    });
  } catch (e) {
    silentLogger.error({ err: e.message }, '[WA] Failed to persist key: ' + key);
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
          else     delete keyStore[`${type}-${id}`];
        }
      }
      await saveKeys();
    },
  };

  return {
    state:     { creds, keys },
    saveCreds: async () => {
      await writeDbKey(SESSION_CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer));
    },
  };
}

// ── Baileys client state ───────────────────────────────────────────────────
let sock           = null;
let currentQr      = null;
let _baileysStatus = 'disconnected';
let reconnectTimer = null;
let _saveCreds     = null;

// Queue for batch anti-ban spacing
const queue = [];
let processingQueue = false;
const BATCH_DELAY_MS = 3 * 60 * 1000; // 3 min between batch messages

function normalizeToJid(phone) {
  return `${normalizeE164(phone)}@s.whatsapp.net`;
}

async function drainQueue() {
  if (processingQueue) return;
  processingQueue = true;
  while (queue.length > 0) {
    if (_baileysStatus !== 'connected') { processingQueue = false; return; }
    const item = queue.shift();
    try {
      await sock.sendMessage(normalizeToJid(item.phone), { text: item.message });
      item.resolve();
    } catch (e) {
      item.reject(e);
    }
    if (queue.length > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }
  processingQueue = false;
}

const baileysProvider = {
  getStatus() { return _baileysStatus; },

  setPrisma(p) { _prisma = p; },

  async getQrDataUrl() {
    if (!currentQr) return null;
    return QRCode.toDataURL(currentQr, { margin: 2, width: 300 });
  },

  async disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock) { try { sock.end(new Error('admin-disconnect')); } catch {} sock = null; }
    _baileysStatus = 'disconnected';
    currentQr = null;
    await writeDbKey(SESSION_CREDS_KEY, '');
    await writeDbKey(SESSION_KEYS_KEY,  '');
  },

  async connect() {
    // Tear down any existing socket (including a hung 'connecting' attempt)
    if (sock) { try { sock.end(new Error('reconnect')); } catch {} sock = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (_baileysStatus === 'connected') return;

    _baileysStatus = 'connecting';
    currentQr = null;

    // fetchLatestBaileysVersion makes an outbound HTTP call that can hang —
    // give it 8 s then fall back to a known-good version.
    let version;
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]);
      version = result.version;
    } catch {
      version = [2, 3000, 1023167840];
    }

    const { state, saveCreds } = await useDbAuthState();
    _saveCreds = saveCreds;

    sock = makeWASocket({
      version,
      logger: silentLogger,
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys:  makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
      browser: ['CSS RMS', 'Chrome', '10.0'],
    });

    sock.ev.on('creds.update', () => _saveCreds && _saveCreds());

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) { currentQr = qr; _baileysStatus = 'qr_ready'; }

      if (connection === 'open') {
        _baileysStatus = 'connected';
        currentQr = null;
        drainQueue();
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        _baileysStatus = 'disconnected';
        sock = null;

        if (code === DisconnectReason.loggedOut) {
          // Wipe session — user must scan QR again
          await writeDbKey(SESSION_CREDS_KEY, '');
          await writeDbKey(SESSION_KEYS_KEY,  '');
        }

        if (shouldReconnect) {
          const delay = reconnectTimer ? 30_000 : 5_000;
          reconnectTimer = setTimeout(() => { reconnectTimer = null; baileysProvider.connect(); }, delay);
        }
      }
    });
  },

  sendWhatsApp(phone, message) {
    return new Promise((resolve, reject) => {
      if (!phone) return reject(new Error('Phone number required'));
      queue.push({ phone, message, resolve, reject });
      if (_baileysStatus === 'connected') drainQueue();
    });
  },
};


// ══════════════════════════════════════════════════════════════════════════════
// ── DISPATCH: pick provider from env ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function getProvider() {
  const p = (process.env.WHATSAPP_PROVIDER || 'baileys').toLowerCase();
  return p === 'meta' ? metaProvider : baileysProvider;
}

module.exports = {
  setPrisma:    (p)             => getProvider().setPrisma(p),
  connect:      ()              => getProvider().connect(),
  disconnect:   ()              => getProvider().disconnect ? getProvider().disconnect() : Promise.resolve(),
  sendWhatsApp: (phone, msg)    => getProvider().sendWhatsApp(phone, msg),
  getQrDataUrl: ()              => getProvider().getQrDataUrl(),
  getStatus:    ()              => getProvider().getStatus(),
};
