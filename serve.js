const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, degrees, radians } = require('pdf-lib');
const xss = require('xss');
const pino = require('pino');
const pinoHttp = require('pino-http');
const OpenAI = require('openai');
const fs = require('fs');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
});

const multer = require('multer');
const XLSX = require('xlsx');
const {
  putObject,
  deleteObject,
  getObjectStream,
  getObjectBuffer,
  generateStorageKey,
  useS3
} = require('./lib/storage');
const {
  getKeyPair,
  getMasterKey,
  encryptPrivateKey,
  decryptPrivateKey,
  generateKeyPair,
  sha256Hex,
  signHashHex,
  verifyHashHex,
  generateVerificationCode
} = require('./lib/signing');
const { sendEmail } = require('./lib/mailer');
const webpush = require('web-push');


const app = express();
const prisma = new PrismaClient();
let isSystemReady = false; // Flag for database/seed readiness

const BRAND_LOGO_CANDIDATES = [
  path.join(__dirname, 'samples', 'logo.png'),
  path.join(__dirname, 'rms_frontend', 'public', 'logo.png'),
  path.join(__dirname, 'rms_frontend', 'public', 'logo.jpg'),
  path.join(__dirname, 'samples', 'logo.jpg')
];

function findBrandLogoPath() {
  return BRAND_LOGO_CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}

// ── Server-Sent Events (real-time updates) ────────────────────────────────────
const sseClients = new Map(); // clientId → res
// Short-lived single-use tickets for SSE (avoids JWT in query string)
const sseTickets = new Map(); // uuid → { user, expiresAt }
// Prune expired tickets every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sseTickets) { if (now > v.expiresAt) sseTickets.delete(k); }
}, 120_000);

async function broadcastUpdate(reqId, meta = {}) {
  const involvedDeptIds = await getInvolvedDeptIds(reqId).catch(() => new Set());
  const payload = `event: requisition_updated\ndata: ${JSON.stringify({ id: reqId, ts: Date.now(), ...meta })}\n\n`;
  for (const [, { res, user }] of sseClients) {
    const role = normalizeRole(user?.role);
    const oversightIds = await getOversightDeptIds().catch(() => []);
    const isOversightDept = role === 'department' && oversightIds.includes(toIntOrNull(user?.deptId));
    const ownDeptInvolved = involvedDeptIds.has(toIntOrNull(user?.deptId));
    // Sub-accounts often carry their own deptId (different from the parent's) —
    // also match on parentDeptId so they get real-time updates for parent-routed requests.
    const parentDeptInvolved = user?.isSubAccount && involvedDeptIds.has(toIntOrNull(user?.parentDeptId));
    if (role !== 'department' || isOversightDept || ownDeptInvolved || parentDeptInvolved) {
      try { res.write(payload); } catch (_) {}
    }
  }
}

// ── Web Push (PWA phone notifications) ───────────────────────────────────────
// PERMANENT KEYS: Never rotate VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in production.
// Every subscribed browser stores the public key; rotating it silently kills push
// notifications on every device until users manually re-enable them.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:admin@cssgroup.local';
  webpush.setVapidDetails(vapidEmail, VAPID_PUBLIC, VAPID_PRIVATE);
}

async function sendPushNotification(deptIds, { title, body, url }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  try {
    const rows = await prisma.$queryRaw`
      SELECT endpoint, p256dh, auth FROM "PushSubscription"
      WHERE "deptId" = ANY(${deptIds}::int[])
    `;
    for (const row of rows) {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify({ title, body, url: url || '/' })
        );
      } catch (err) {
        if (err.statusCode === 410) {
          await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${row.endpoint}`;
        }
      }
    }
  } catch (_) {}
}

// Auto-migrate: add new columns if they don't exist yet (idempotent)
// Note: Database schema is now managed centrally in schema.prisma.
// Redundant raw migrations have been removed to prevent race conditions.

// ── Final Approval Authority ──────────────────────────────────────────────────
// Returns: 'hr' | 'gm' | 'chairman' | null (no authority)
// Bands:
//   HR        → ≤ 50,000
//   GM        → 50,001 – 100,000
//   Chairman  → > 100,000 (full authority at any amount)
// Extracted to rms_backend/lib/businessRules.js (with checkFinalApproveAuthority,
// getEffectiveReqAmount, isIccDept, subPrivilegeCoversCash) so these pure rules are
// unit-testable without starting the server or touching a database — see businessRules.test.js.
const { checkFinalApproveAuthority, requiredAuthorityTier, getEffectiveReqAmount, isIccDept, subPrivilegeCoversCash, getFixedDefaultAccessCode } = require('./rms_backend/lib/businessRules');
const { normalizeRole, toIntOrNull, getNumericUserId } = require('./rms_backend/lib/utils');

// ── Re-approval escalation ──────────────────────────────────────────────────────
// Called whenever Audit or ICC saves/changes a verified-amount override. If the new
// effective amount no longer falls within the band of whoever already gave final
// approval, the original sign-off no longer covers it — flag the request and block
// treatment until the correct higher tier (GM/Chairman) confirms. If a later revision
// brings it back within the original approver's band, the flag clears automatically.
async function checkAndApplyReapprovalEscalation(requisitionId, newAmount, isMaterial, triggeredByLabel) {
  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: { finalApprovedByDept: { select: { name: true } } }
  });
  if (!requisition?.finalApprovedByDeptId || !requisition.finalApprovedByDept) return null;
  if (['treated', 'published'].includes(requisition.finalApprovalStatus)) return null; // already settled

  // Already reapproved at this EXACT amount — don't re-flag it. The original approver's
  // band never covers this figure (that's why it escalated in the first place), so
  // re-deriving authority from them every time would immediately undo a confirmed
  // re-approval the next time anyone simply views the request. Only a genuinely NEW
  // revision (a different amount) should trigger a fresh escalation.
  if (requisition.reapprovedAt && requisition.reapprovedAmount === newAmount) return null;

  const stillAuthorized = checkFinalApproveAuthority(requisition.finalApprovedByDept.name, newAmount, isMaterial);
  if (stillAuthorized) {
    if (requisition.needsReapproval) {
      await prisma.requisition.update({
        where: { id: requisitionId },
        data: { needsReapproval: false, reapprovalAuthority: null, reapprovalReason: null }
      });
    }
    return null;
  }

  const requiredTier = requiredAuthorityTier(newAmount, isMaterial);
  const reason = `Revised to ₦${Number(newAmount).toLocaleString()} by ${triggeredByLabel} — exceeds ${requisition.finalApprovedByDept.name}'s approval ceiling. Requires ${requiredTier.toUpperCase()} re-approval before treatment.`;
  await prisma.requisition.update({
    where: { id: requisitionId },
    data: { needsReapproval: true, reapprovalAuthority: requiredTier, reapprovalReason: reason }
  });
  return { requiredTier, reason };
}

// ── Sub-account privilege helpers ─────────────────────────────────────────────
// getEffectiveReqAmount now lives in rms_backend/lib/businessRules.js (required above).

// Fetch a sub-account's privilege settings from DB (raw SQL — columns may predate Prisma client regen)
async function getSubPrivilege(deptId) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT "privilegeAmount", "approvalLimit", "cashPrivilege", "memoPrivilege", "materialPrivilege",
             "directRoute", "allowedRouteDeptIds"
      FROM "Department" WHERE id = ${parseInt(deptId)} LIMIT 1
    `;
    const d = rows?.[0];
    let allowedRouteDeptIds = [];
    try { allowedRouteDeptIds = JSON.parse(d?.allowedRouteDeptIds || 'null') || []; } catch { allowedRouteDeptIds = []; }
    return {
      privilegeAmount:     d?.privilegeAmount   ?? null,
      approvalLimit:       d?.approvalLimit     ?? null,
      cashPrivilege:       d?.cashPrivilege     ?? false,
      memoPrivilege:       d?.memoPrivilege     ?? false,
      materialPrivilege:   d?.materialPrivilege ?? false,
      directRoute:         d?.directRoute       ?? false,
      allowedRouteDeptIds,
    };
  } catch { return { privilegeAmount: null, approvalLimit: null, cashPrivilege: false, memoPrivilege: false, materialPrivilege: false, directRoute: false, allowedRouteDeptIds: [] }; }
}
// Legacy compat — returns just the amount
async function getSubPrivilegeAmount(deptId) {
  return (await getSubPrivilege(deptId)).privilegeAmount;
}

// ── ICC helpers ───────────────────────────────────────────────────────────────
// subPrivilegeCoversCash and isIccDept now live in rms_backend/lib/businessRules.js (required above).

// Resolves the department that actually holds a given authority tier — used to route a
// request to whoever needs to clear a re-approval. Chairman/CEO satisfies any tier.
async function resolveAuthorityDept(tier) {
  const allDepts = await prisma.department.findMany({ where: { isSubAccount: false }, select: { id: true, name: true } });
  if (tier === 'gm') return allDepts.find(d => /general\s*manager|\bgm\b/i.test(d.name)) || allDepts.find(d => /ceo|chairman/i.test(d.name)) || null;
  return allDepts.find(d => /ceo|chairman/i.test(d.name)) || null;
}

// ICC is a global observer — it must be notified of every request and every
// movement/routing event system-wide, not just ones it's directly involved in.
// Cached briefly since the ICC department record rarely changes.
let _iccDeptIdCache = null;
let _iccDeptIdCacheAt = 0;
async function getIccDeptId() {
  if (_iccDeptIdCache != null && Date.now() - _iccDeptIdCacheAt < 5 * 60_000) return _iccDeptIdCache;
  try {
    const depts = await prisma.department.findMany({ where: { isSubAccount: false }, select: { id: true, name: true } });
    const icc = depts.find(d => isIccDept(d.name));
    _iccDeptIdCache = icc?.id ?? null;
    _iccDeptIdCacheAt = Date.now();
  } catch (_) { _iccDeptIdCache = null; }
  return _iccDeptIdCache;
}

// Oversight departments — admin-configured list of dept IDs that get global observer
// access (same as ICC). Cached for 2 minutes since this setting rarely changes.
let _oversightDeptIdsCache = null;
let _oversightDeptIdsCacheAt = 0;
async function getOversightDeptIds() {
  if (_oversightDeptIdsCache !== null && Date.now() - _oversightDeptIdsCacheAt < 2 * 60_000) return _oversightDeptIdsCache;
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'oversight_departments' } });
    const raw = setting?.value || '[]';
    const parsed = JSON.parse(raw);
    _oversightDeptIdsCache = Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch (_) { _oversightDeptIdsCache = []; }
  _oversightDeptIdsCacheAt = Date.now();
  return _oversightDeptIdsCache;
}
function invalidateOversightCache() { _oversightDeptIdsCache = null; }

// ── Reference Code Generator ──────────────────────────────────────────────────
const deriveCode = (name) => {
  const words = (name || '').trim().split(/[\s&\/,\-]+/).filter(w => w.length > 1);
  if (!words.length) return (name || 'UNK').slice(0, 4).toUpperCase();
  return words.map(w => w[0]).join('').toUpperCase().slice(0, 6);
};

const buildRefCode = async (type, deptId, isDraft) => {
  if (isDraft) return null;
  try {
    const [orgRow, cashRow, matRow, memoRow] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'ref_org_prefix' } }),
      prisma.systemSetting.findUnique({ where: { key: 'ref_type_cash' } }),
      prisma.systemSetting.findUnique({ where: { key: 'ref_type_material' } }),
      prisma.systemSetting.findUnique({ where: { key: 'ref_type_memo' } }),
    ]);
    const orgPrefix    = orgRow?.value  || 'CSSG';
    const typeCash     = cashRow?.value || 'FR';
    const typeMaterial = matRow?.value  || 'MR';
    const typeMemo     = memoRow?.value || 'MO';
    const t = (type || '').toLowerCase();
    const typeCode = (t.includes('memo') || t.includes('memorandum')) ? typeMemo
                   : t.includes('material') ? typeMaterial
                   : typeCash;
    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { name: true, code: true, parentId: true, type: true } });
    let deptCode;
    if (dept?.type === 'Sub-Account' && dept?.parentId) {
      const parentDept = await prisma.department.findUnique({ where: { id: dept.parentId }, select: { name: true, code: true } });
      const parentCode = parentDept?.code || deriveCode(parentDept?.name || '');
      const subCode    = dept?.code || deriveCode(dept?.name || '');
      deptCode = `${parentCode}[${subCode}]`;
    } else {
      deptCode = dept?.code || deriveCode(dept?.name || '');
    }
    const now = new Date();
    const dd   = String(now.getDate()).padStart(2, '0');
    const mm   = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const datePart = `${dd}${mm}${yyyy}`;
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const countToday = await prisma.requisition.count({
      where: { createdAt: { gte: startOfDay, lte: endOfDay }, refCode: { not: null } }
    });
    const seq = String(countToday + 1).padStart(2, '0');
    return `${orgPrefix}/${deptCode}/${typeCode}/${datePart}/${seq}`;
  } catch (e) {
    console.error('[REF CODE]', e.message);
    return null;
  }
};

// Blocks any mutating action on a frozen request. Returns true (and sends 403) if frozen.
async function blockIfIccFrozen(reqId, res) {
  try {
    const rows = await prisma.$queryRaw`SELECT "iccFrozen", "iccFreezeBy", "iccFreezeNote" FROM "Requisition" WHERE id = ${reqId} LIMIT 1`;
    const r = rows?.[0];
    if (r?.iccFrozen) {
      res.status(403).json({
        error: `This request has been frozen by ICC (Internal Control & Compliance). No actions are permitted until ICC lifts the freeze.`,
        iccFrozen: true,
        iccFreezeBy: r.iccFreezeBy || 'ICC',
        iccFreezeNote: r.iccFreezeNote || ''
      });
      return true;
    }
  } catch (_) { /* columns not yet migrated — allow through */ }
  return false;
}

// Post-approval vetting chain: Account only (Audit is now pre-approval reviewer, ICC removed)
const VETTING_CHAIN = ['account'];
const getVettingChainIndex = (deptName) => {
  const n = (deptName || '').toLowerCase();
  if (/account/i.test(n)) return 0;
  return -1;
};

const normalizeTrustProxy = (value) => {
  if (value == null) return undefined;
  const raw = String(value).trim();
  if (raw === '') return undefined;
  const lower = raw.toLowerCase();
  if (lower === 'true') return 1;
  if (lower === 'false') return false;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber)) return asNumber;
  return raw;
};

// Configure Multer for File Uploads (memory storage for object storage)
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error(`File type not allowed: ${file.mimetype}`), { status: 415 }));
  }
});

// Batch-upload multer: CSV/Excel files only, small size cap (a few thousand rows max)
const BATCH_UPLOAD_MIME_TYPES = new Set([
  'text/csv', 'application/csv', 'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (BATCH_UPLOAD_MIME_TYPES.has(file.mimetype) || /\.(csv|xlsx|xls)$/i.test(file.originalname || '')) return cb(null, true);
    cb(Object.assign(new Error(`File type not allowed: ${file.mimetype}. Please upload a .csv, .xlsx, or .xls file.`), { status: 415 }));
  }
});

// Chat-specific multer: allows audio + higher size limit
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/webm')) return cb(null, true);
    cb(Object.assign(new Error(`File type not allowed: ${file.mimetype}`), { status: 415 }));
  }
});

// Middleware
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const trustProxy = normalizeTrustProxy(process.env.TRUST_PROXY);
if (trustProxy !== undefined) {
  app.set('trust proxy', trustProxy);
} else if (isProd) {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com", "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.b-cdn.net"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com", "https://cloudflareinsights.com"],
      frameSrc: ["'self'", "blob:", "https://challenges.cloudflare.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      workerSrc: ["'self'", "blob:"]
    }
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'deny' },
  noSniff: true
}));
app.use(cors((req, cb) => {
  const origin = req.get('Origin');
  if (!origin) return cb(null, { origin: true, credentials: true });
  if (!isProd && allowedOrigins.length === 0) return cb(null, { origin: true, credentials: true });

  let isSameHost = false;
  try {
    const requestHost = req.get('Host');
    isSameHost = Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch (_) {}

  if (isSameHost || allowedOrigins.includes(origin)) {
    return cb(null, { origin: true, credentials: true });
  }

  logger.debug({ origin, host: req.get('Host'), path: req.originalUrl }, '[CORS] Request origin not allowed.');
  return cb(null, { origin: false, credentials: false });
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
// ZKTeco MB160 sends attendance as raw text/plain — capture as string for ADMS handler
app.use(express.text({ type: ['text/plain', 'application/octet-stream'], limit: '2mb' }));
app.use(cookieParser());

app.use(pinoHttp({
  logger,
  // Silence 2xx/3xx — only surface warnings and errors
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'silent';
  },
  // One-line format: METHOD /path → status (Xms)
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} → ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} → ${res.statusCode}${err ? ` | ${err.message}` : ''}`,
  // Strip headers — only keep method, url, status, response time
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// ── BOOTING PROTECTOR MIDDLEWARE ───────────────────────────────────────────
app.use((req, res, next) => {
  if (!isSystemReady && req.path.startsWith('/api') && !req.path.startsWith('/api/health')) {
    return res.status(503).json({
      error: 'System Initializing',
      message: 'The RMS core is currently synchronizing with the database and seeding authority records. Please wait 10 seconds.'
    });
  }
  next();
});

// ── SSE — real-time push to connected clients ─────────────────────────────────
// EventSource does not support custom headers, so we accept a short-lived SSE
// ticket (issued by POST /api/events/ticket) instead of the main JWT in the URL.
app.get('/api/events', (req, res) => {
  const ticket = req.query.ticket;
  if (!ticket) return res.status(401).end();
  const entry = sseTickets.get(ticket);
  if (!entry || Date.now() > entry.expiresAt) {
    sseTickets.delete(ticket);
    return res.status(401).end();
  }
  sseTickets.delete(ticket); // single-use
  const user = entry.user;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(':connected\n\n');

  const clientId = `${user.id || user.deptId || 'anon'}-${Date.now()}`;
  sseClients.set(clientId, { res, user });

  const heartbeat = setInterval(() => {
    try { res.write(':ping\n\n'); } catch (_) { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(clientId); });
});

// ── Push subscription endpoints ───────────────────────────────────────────────
app.get('/api/push/vapid-public', (req, res) => {
  res.json({ key: VAPID_PUBLIC || null });
});

// ── INPUT SANITIZATION (XSS PROTECTION) ─────────────────────────────────────
const sanitizeObject = (obj) => {
  if (typeof obj === 'string') return xss(obj);
  if (Array.isArray(obj)) return obj.map(item => sanitizeObject(item));
  if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
      // Don't modify keys, just values
      newObj[key] = sanitizeObject(value);
    }
    return newObj;
  }
  return obj;
};

const sanitizePayload = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  next();
};

app.use(sanitizePayload);

// ── Maintenance Mode ──────────────────────────────────────────────────────────
// Set MAINTENANCE_MODE=true in Railway env to activate. The Railway-assigned URL
// bypasses this gate so the super-admin can still reach the system.
// Only the production domain (APP_BASE_URL) is blocked.
app.use((req, res, next) => {
  if (process.env.MAINTENANCE_MODE !== 'true') return next();
  // Always allow the status endpoint (frontend polls this to detect maintenance)
  if (req.path === '/api/public/app-status') return next();
  // Allow Railway's own domain — prod domain (from APP_BASE_URL) is the gated one
  let prodHost = null;
  try { prodHost = new URL(process.env.APP_BASE_URL || '').hostname; } catch {}
  const reqHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (prodHost && reqHost !== prodHost) return next();
  // Block all API calls with a machine-readable code the frontend can act on
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ code: 'MAINTENANCE', error: 'System is currently under maintenance.' });
  }
  // Non-API requests (SPA page loads) pass through — React renders the maintenance UI
  next();
});

// Apply mutation limiter to all state-changing API requests
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return mutationLimiter(req, res, next);
  }
  next();
});

// ── BACKEND API ROUTES ──
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in environment variables.');
}
const JWT_SECRET = process.env.JWT_SECRET;
const APP_BASE_URL = (process.env.APP_BASE_URL || '').trim();
const SUPER_ADMIN_ACCESS_CODE = (process.env.SUPER_ADMIN_ACCESS_CODE || '').trim();
const SUPER_ADMIN_MFA_PIN = (process.env.SUPER_ADMIN_MFA_PIN || '').trim();
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || '').trim();
const MASTER_KEY = getMasterKey();
let ACTIVE_PUBLIC_KEY = null;
let ACTIVE_PRIVATE_KEY = null;
let ACTIVE_KID = null;
if (process.env.SIGNING_PRIVATE_KEY && process.env.SIGNING_PUBLIC_KEY) {
  const keypair = getKeyPair();
  ACTIVE_PUBLIC_KEY = keypair.publicKey;
  ACTIVE_PRIVATE_KEY = keypair.privateKey;
  ACTIVE_KID = keypair.kid;
} else if (!MASTER_KEY) {
  throw new Error('Signing keys missing. Set SIGNING_PRIVATE_KEY/SIGNING_PUBLIC_KEY or SIGNING_MASTER_KEY for per-department keys.');
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

const approvalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

const publicVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// Desktop clients poll /api/sync/heartbeat on a short interval by design
// (near-real-time activation/lockout — see main_window.py's _init_sync_check).
// publicVerifyLimiter's 30-per-15-min budget is tuned for a human-facing,
// abuse-prone endpoint and was getting exhausted by legitimate polling
// within the first couple of minutes, so every desktop client saw
// permanent 429s and the activation check never actually succeeded.
// Generous enough for several desktop installs sharing one office IP.
const desktopSyncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

// Mutation limiter — applied to all state-changing endpoints (POST/PUT/DELETE)
const mutationLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' }
});

// ── Token Blacklist (for logout) ──────────────────────────────────────────────
const tokenBlacklist = new Set();

// Prune expired tokens from blacklist every 30 minutes
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const entry of tokenBlacklist) {
    try {
      const decoded = jwt.decode(entry);
      if (decoded && decoded.exp && decoded.exp < now) tokenBlacklist.delete(entry);
    } catch { tokenBlacklist.delete(entry); }
  }
}, 30 * 60 * 1000);

// ── Login Lockout Tracking ───────────────────────────────────────────────────
const loginAttempts = new Map(); // key => { count, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured — skip silently
  if (!token) return false;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const data = await resp.json();
    return data.success === true;
  } catch (e) {
    logger.error('[TURNSTILE] Verification error:', e.message);
    return false;
  }
}

function checkLockout(key) {
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

function recordFailedLogin(key) {
  const record = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  record.count += 1;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`[AUTH] Account locked: ${key} (${MAX_LOGIN_ATTEMPTS} failed attempts)`);
  }
  loginAttempts.set(key, record);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

// Cookie options for the auth token — HttpOnly prevents JS access; Secure in prod
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  maxAge: 12 * 60 * 60 * 1000, // 12 h — matches JWT expiry
  path: '/'
};

const authenticateToken = async (req, res, next) => {
  // Prefer HttpOnly cookie; fall back to Authorization header (offline / API clients)
  const token = req.cookies?.rms_token
    || (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : null);
  if (!token) return res.status(401).json({ error: 'You must be logged in to access this. Please sign in and try again.' });

  // Check blacklist
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: 'Token has been revoked. Please log in again.' });
  }

  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Your session is invalid or has expired. Please log in again.' });
  }

  // Department/sub-account JWTs carry a tokenVersion snapshot from login time. A security
  // reset bumps that department's tokenVersion in the DB, which instantly invalidates every
  // JWT issued before that point — on every device — without needing to track individual
  // tokens. Fail OPEN on a transient DB error here so a brief connectivity blip doesn't lock
  // out every department session at once; this is a defense-in-depth check, not the primary
  // auth guarantee (the JWT signature itself still has to be valid to get this far).
  if (user.role === 'department' && user.deptId) {
    try {
      const dept = await prisma.department.findUnique({ where: { id: user.deptId }, select: { tokenVersion: true } });
      if (dept && (user.tokenVersion || 0) !== (dept.tokenVersion || 0)) {
        return res.status(401).json({ error: 'Your session was ended by an administrator for security reasons. Please log in again.' });
      }
    } catch (_) { /* fail open on transient DB errors */ }
  }

  req.user = user;
  req.token = token; // Stash for logout
  next();
};

// Issue a short-lived (30 s) single-use SSE ticket so the JWT never appears in
// query strings / server logs. The client POSTs here with the normal Bearer
// token, gets back a ticket, and opens EventSource with ?ticket=<value>.
app.post('/api/events/ticket', authenticateToken, (req, res) => {
  const ticket = crypto.randomUUID();
  sseTickets.set(ticket, { user: req.user, expiresAt: Date.now() + 30_000 });
  res.json({ ticket });
});

// ── Push subscription endpoints (placed here: after authenticateToken) ────────
app.post('/api/push/subscribe', authenticateToken, async (req, res) => {
  const { endpoint, p256dh, auth } = req.body || {};
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Missing subscription fields' });
  const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
  const userId = getNumericUserId(req.user) || null;
  try {
    await prisma.$executeRaw`
      INSERT INTO "PushSubscription" (endpoint, p256dh, auth, "deptId", "userId", "createdAt")
      VALUES (${endpoint}, ${p256dh}, ${auth}, ${deptId}, ${userId}, NOW())
      ON CONFLICT (endpoint) DO UPDATE SET p256dh=${p256dh}, auth=${auth}, "deptId"=${deptId}, "userId"=${userId}
    `;
    res.json({ ok: true });
  } catch (err) { sendError(res, 500, err.message); }
});

app.delete('/api/push/subscribe', authenticateToken, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${endpoint}`;
    res.json({ ok: true });
  } catch (err) { sendError(res, 500, err.message); }
});

async function getDepartmentLinkedRequisitionIds(deptId) {
  const departmentId = toIntOrNull(deptId);
  if (!departmentId) return [];

  const ids = new Set();
  const addId = (value) => {
    const id = toIntOrNull(value);
    if (id) ids.add(id);
  };

  try {
    const rows = await prisma.$queryRaw`
      SELECT id FROM "Requisition"
      WHERE "currentVettingDeptId" = ${departmentId}
         OR "finalApprovedByDeptId" = ${departmentId}
         OR "treatedByDeptId" = ${departmentId}
    `;
    for (const row of rows || []) addId(row.id);
  } catch (_) {}

  try {
    const rows = await prisma.forwardEvent.findMany({
      where: { OR: [{ fromDeptId: departmentId }, { toDeptId: departmentId }] },
      select: { requisitionId: true }
    });
    for (const row of rows || []) addId(row.requisitionId);
  } catch (_) {}

  try {
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT "requisitionId" FROM "VettingEvent"
      WHERE "deptId" = ${departmentId}
    `;
    for (const row of rows || []) addId(row.requisitionId);
  } catch (_) {}

  try {
    const rows = await prisma.requisitionTag.findMany({
      where: { deptId: departmentId },
      select: { requisitionId: true }
    });
    for (const row of rows || []) addId(row.requisitionId);
  } catch (_) {}

  return [...ids];
}

async function getInvolvedDeptIds(reqId) {
  const deptIds = new Set();
  try {
    const r = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { departmentId: true, targetDepartmentId: true }
    });
    if (r?.departmentId) deptIds.add(r.departmentId);
    if (r?.targetDepartmentId) deptIds.add(r.targetDepartmentId);
  } catch (_) {}
  try {
    const ext = await prisma.$queryRaw`
      SELECT "currentVettingDeptId", "finalApprovedByDeptId", "treatedByDeptId"
      FROM "Requisition" WHERE id = ${reqId} LIMIT 1
    `;
    const e = ext?.[0] || {};
    if (e.currentVettingDeptId) deptIds.add(parseInt(e.currentVettingDeptId));
    if (e.finalApprovedByDeptId) deptIds.add(parseInt(e.finalApprovedByDeptId));
    if (e.treatedByDeptId) deptIds.add(parseInt(e.treatedByDeptId));
  } catch (_) {}
  try {
    const fwds = await prisma.forwardEvent.findMany({
      where: { requisitionId: reqId },
      select: { fromDeptId: true, toDeptId: true }
    });
    for (const f of fwds) {
      if (f.fromDeptId) deptIds.add(f.fromDeptId);
      if (f.toDeptId) deptIds.add(f.toDeptId);
    }
  } catch (_) {}
  try {
    const vrows = await prisma.$queryRaw`SELECT DISTINCT "deptId" FROM "VettingEvent" WHERE "requisitionId" = ${reqId}`;
    for (const v of (vrows || [])) if (v.deptId) deptIds.add(parseInt(v.deptId));
  } catch (_) {}
  try {
    const tags = await prisma.requisitionTag.findMany({ where: { requisitionId: reqId }, select: { deptId: true } });
    for (const t of tags) deptIds.add(t.deptId);
  } catch (_) {}
  return deptIds;
}

async function canReadRequisition(requisition, user) {
  const userRole = normalizeRole(user?.role);
  if (userRole === 'global_admin' || userRole !== 'department') return true;

  // Departments granted oversight access (configured by Super Admin) can read every request
  const oversightIds = await getOversightDeptIds().catch(() => []);
  if (oversightIds.includes(toIntOrNull(user?.deptId))) return true;

  const deptId = toIntOrNull(user?.deptId);
  const reqId = toIntOrNull(requisition?.id);
  if (!deptId || !reqId) return false;

  // Privileged sub-account: can read requests at parent dept based on type-specific privilege
  if (user?.isSubAccount && user?.parentDeptId) {
    const parentDeptId = toIntOrNull(user.parentDeptId);
    if (toIntOrNull(requisition.targetDepartmentId) === parentDeptId) {
      const reqType = (requisition.type || '').toLowerCase();
      const isCash     = !reqType.startsWith('memo') && !reqType.startsWith('material');
      const isMemo     = reqType.startsWith('memo');
      const isMaterial = reqType.startsWith('material');

      const subPriv = await getSubPrivilege(deptId);

      if (isCash) {
        const effectiveAmount = getEffectiveReqAmount(requisition);
        const cashEnabled = user.cashPrivilege || subPriv.cashPrivilege || user.privilegeAmount != null || subPriv.privilegeAmount != null;
        if (cashEnabled) {
          const privilege = user.privilegeAmount != null ? parseFloat(user.privilegeAmount) : subPriv.privilegeAmount;
          if (privilege == null || effectiveAmount <= privilege) return true;
        }
      } else if (isMemo && (user.memoPrivilege || subPriv.memoPrivilege)) {
        return true;
      } else if (isMaterial && (user.materialPrivilege || subPriv.materialPrivilege)) {
        return true;
      }
    }
  }

  const directDeptIds = [
    requisition.departmentId,
    requisition.targetDepartmentId,
    requisition.currentVettingDeptId,
    requisition.finalApprovedByDeptId,
    requisition.treatedByDeptId
  ].map(toIntOrNull);

  if (directDeptIds.includes(deptId)) return true;

  // Parent dept head can always read requests created by their sub-accounts,
  // even after the sub-account has been deleted (parentId is preserved on soft-delete).
  if (!user?.isSubAccount) {
    try {
      const creatorDept = await prisma.department.findFirst({
        where: { id: toIntOrNull(requisition.departmentId), isSubAccount: true },
        select: { parentId: true }
      });
      if (creatorDept?.parentId && toIntOrNull(creatorDept.parentId) === deptId) return true;
    } catch (_) {}
  }

  try {
    const forwardEvent = await prisma.forwardEvent.findFirst({
      where: { requisitionId: reqId, OR: [{ fromDeptId: deptId }, { toDeptId: deptId }] },
      select: { id: true }
    });
    if (forwardEvent) return true;
  } catch (_) {}

  try {
    const vettingRows = await prisma.$queryRaw`
      SELECT 1 FROM "VettingEvent"
      WHERE "requisitionId" = ${reqId} AND "deptId" = ${deptId}
      LIMIT 1
    `;
    if (Array.isArray(vettingRows) && vettingRows.length > 0) return true;
  } catch (_) {}

  try {
    const tag = await prisma.requisitionTag.findFirst({
      where: { requisitionId: reqId, deptId },
      select: { id: true }
    });
    if (tag) return true;
  } catch (_) {}

  // Sub-account visibility: parent dept head shared this request with all or specific sub-accounts
  if (user?.isSubAccount && user?.parentDeptId) {
    const parentDeptId = toIntOrNull(user.parentDeptId);
    if (toIntOrNull(requisition.departmentId) === parentDeptId) {
      if (requisition.visibleToSubAccounts) return true;
      try {
        const specificVis = await prisma.requisitionSubVisibility.findFirst({
          where: { requisitionId: reqId, subAccountId: deptId },
          select: { requisitionId: true }
        });
        if (specificVis) return true;
      } catch (_) {}
    }
  }

  return false;
}

// ── Broadcast push + in-app to ALL departments involved in a requisition ──────
// Covers: creator dept, target dept, forward chain, vetting chain, tagged depts.
// This is the single function to call after any mutation — replaces pushToTaggedDepts.
async function broadcastPushToInvolved(reqId, payload) {
  try {
    const deptIds = await getInvolvedDeptIds(reqId);
    // ICC is a global observer — always notified, even when not otherwise involved
    const iccDeptId = await getIccDeptId();
    if (iccDeptId != null) deptIds.add(iccDeptId);
    const ids = [...deptIds];
    if (ids.length === 0) return;

    for (const deptId of ids) {
      await prisma.notification.create({
        data: { departmentId: deptId, content: payload.body || payload.title, link: payload.url || '/' }
      }).catch(() => {});
    }

    await sendPushNotification(ids, payload);
  } catch (_) {}
}

// Keep backward-compatible alias for tagged-only pushes
async function pushToTaggedDepts(reqId, payload) {
  return broadcastPushToInvolved(reqId, payload);
}

// ── Tag endpoints ─────────────────────────────────────────────────────────────
app.get('/api/requisitions/:id/tags', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const tags = await prisma.requisitionTag.findMany({
      where: { requisitionId: reqId },
      include: { requisition: { select: { departmentId: true } } }
    });
    const depts = await prisma.department.findMany({
      where: { id: { in: tags.map(t => t.deptId) } },
      select: { id: true, name: true }
    });
    const deptMap = new Map(depts.map(d => [d.id, d.name]));
    res.json(tags.map(t => ({ ...t, deptName: deptMap.get(t.deptId) || '' })));
  } catch (err) { sendError(res, 500, err.message); }
});

app.post('/api/requisitions/:id/tag', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const { deptIds } = req.body || {};
    if (!Array.isArray(deptIds) || deptIds.length === 0) return res.status(400).json({ error: 'No departments selected' });

    const requisition = await prisma.requisition.findUnique({ where: { id: reqId }, select: { id: true, departmentId: true, title: true } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    if (!isAdmin) {
      let isInChain = userDeptId === requisition.departmentId || userDeptId === requisition.targetDepartmentId;
      if (!isInChain) {
        try {
          const extRow = await prisma.$queryRaw`
            SELECT "currentVettingDeptId", "finalApprovedByDeptId", "treatedByDeptId"
            FROM "Requisition" WHERE id = ${reqId} LIMIT 1
          `;
          const ext = extRow?.[0] || {};
          const cvId = ext.currentVettingDeptId ? parseInt(ext.currentVettingDeptId) : null;
          const faId = ext.finalApprovedByDeptId ? parseInt(ext.finalApprovedByDeptId) : null;
          const tbId = ext.treatedByDeptId ? parseInt(ext.treatedByDeptId) : null;
          if (userDeptId === cvId || userDeptId === faId || userDeptId === tbId) isInChain = true;
        } catch (_) {}
      }
      if (!isInChain) {
        const fwdRow = await prisma.forwardEvent.findFirst({
          where: { requisitionId: reqId, OR: [{ fromDeptId: userDeptId }, { toDeptId: userDeptId }] }
        });
        if (fwdRow) isInChain = true;
      }
      if (!isInChain) {
        try {
          const vRows = await prisma.$queryRaw`
            SELECT 1 FROM "VettingEvent" WHERE "requisitionId" = ${reqId} AND "deptId" = ${userDeptId} LIMIT 1
          `;
          if (Array.isArray(vRows) && vRows.length > 0) isInChain = true;
        } catch (_) {}
      }
      if (!isInChain) {
        return res.status(403).json({ error: 'Only departments in the processing chain can tag observers.' });
      }
    }

    const newlyTagged = [];
    for (const deptId of deptIds) {
      const id = parseInt(deptId);
      if (!id) continue;
      try {
        await prisma.requisitionTag.create({
          data: { requisitionId: reqId, deptId: id, taggedByDeptId: userDeptId }
        });
        newlyTagged.push(id);
      } catch { /* duplicate — already tagged */ }
    }

    // In-app notifications for newly tagged depts
    for (const deptId of newlyTagged) {
      await prisma.notification.create({
        data: {
          departmentId: deptId,
          content: `📎 You have been tagged as an observer on Requisition #${reqId}: "${requisition.title || 'Untitled'}"`,
          link: `/requisitions/${reqId}`
        }
      }).catch(() => {});
    }

    // PWA push to newly tagged depts
    if (newlyTagged.length > 0) {
      await sendPushNotification(newlyTagged, {
        title: 'Tagged as Observer',
        body: `You can now follow Requisition #${reqId}: ${requisition.title || ''}`,
        url: `/?req=${reqId}`
      });
    }

    broadcastUpdate(reqId);
    res.json({ ok: true, tagged: newlyTagged.length });
  } catch (err) { sendError(res, 500, err.message); }
});

// ── Central friendly error responder ─────────────────────────────────────────
// 4xx errors: pass the message through (already human-readable).
// 5xx errors: never expose raw DB / system internals — use a safe fallback.
const sendError = (res, status, message) => {
  if (status >= 500) {
    logger.error(`[API ${status}] ${message}`);
    return res.status(status).json({ error: 'Something went wrong on our end. Please try again, or contact support if the problem persists.' });
  }
  return res.status(status).json({ error: message });
};
const maskSecret = (value) => {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 2) return '*'.repeat(raw.length);
  return `${'*'.repeat(raw.length - 2)}${raw.slice(-2)}`;
};

const requireRoles = (roles) => (req, res, next) => {
  const userRole = normalizeRole(req.user?.role);
  const allowed = roles.map(r => r.toLowerCase());
  if (allowed.includes(userRole) || userRole === 'global_admin') return next();
  return res.status(403).json({ error: 'You do not have permission to perform this action.' });
};

const ensureActivePublicKey = async () => {
  if (!ACTIVE_PUBLIC_KEY || !ACTIVE_KID) return;
  await prisma.publicKey.upsert({
    where: { kid: ACTIVE_KID },
    update: { publicKey: ACTIVE_PUBLIC_KEY, algorithm: 'Ed25519', active: true },
    create: { kid: ACTIVE_KID, publicKey: ACTIVE_PUBLIC_KEY, algorithm: 'Ed25519', active: true }
  });
};

const getEligibleStages = async (amount = 0) => {
  const stages = await prisma.workflowStage.findMany({ orderBy: { sequence: 'asc' } });
  return stages.filter(s => Number(amount || 0) >= Number(s.threshold || 0));
};

const findNextStage = (eligibleStages, currentStageId) => {
  if (!eligibleStages.length) return null;
  const idx = eligibleStages.findIndex(s => s.id === currentStageId);
  if (idx === -1) return eligibleStages[0];
  return eligibleStages[idx + 1] || null;
};

const computeContentHash = (requisition) => {
  const content = requisition.content || requisition.description || '';
  return crypto.createHash('sha256').update(content).digest('hex');
};

const checkDeptReadiness = async (deptId) => {
  if (!deptId) return { ready: false, reason: 'Department ID missing' };
  const dept = await prisma.department.findUnique({ where: { id: deptId } });
  if (!dept) return { ready: false, reason: 'Department not found' };
  // Super Admin and Chairman/CEO depts are always ready
  if (dept.name === 'Super Admin' || /ceo|chairman/i.test(dept.name)) return { ready: true };

  // Respect the require_governance_setup system setting — if disabled, skip profile checks
  const govSetting = await prisma.systemSetting.findUnique({ where: { key: 'require_governance_setup' } });
  const governanceRequired = (govSetting?.value ?? 'true') !== 'false';
  if (!governanceRequired) return { ready: true };

  // Only block if the department has never filled in ANY profile info at all
  if (!dept.headName) {
    return {
      ready: false,
      reason: `Your department profile is incomplete. Please go to Dept Profile and fill in your Head Official's name before submitting.`
    };
  }

  return { ready: true };
};

const computeAttachmentsHash = (attachments = []) => {
  const normalized = attachments
    .map(a => `${a.storageKey || ''}:${a.size || 0}:${a.mimeType || ''}`)
    .sort()
    .join('|');
  return sha256Hex(normalized);
};

const getGlobalPublicKeyRecord = async () => {
  if (!ACTIVE_PUBLIC_KEY || !ACTIVE_KID) return null;
  return prisma.publicKey.upsert({
    where: { kid: ACTIVE_KID },
    update: { publicKey: ACTIVE_PUBLIC_KEY, algorithm: 'Ed25519', active: true },
    create: { kid: ACTIVE_KID, publicKey: ACTIVE_PUBLIC_KEY, algorithm: 'Ed25519', active: true }
  });
};

const getDepartmentSigningKey = async (departmentId) => {
  if (MASTER_KEY) {
    if (MASTER_KEY.length !== 32) {
      throw new Error('SIGNING_MASTER_KEY must be 32 bytes (hex or base64 for 256-bit key)');
    }
    let deptKey = await prisma.departmentKey.findUnique({
      where: { departmentId },
      include: { publicKey: true }
    });
    if (!deptKey) {
      const { publicKeyPem, privateKeyPem } = generateKeyPair();
      const kid = sha256Hex(publicKeyPem).slice(0, 16);
      const publicKeyRecord = await prisma.publicKey.create({
        data: { kid, algorithm: 'Ed25519', publicKey: publicKeyPem, active: true }
      });
      const privateKeyEnc = encryptPrivateKey(privateKeyPem, MASTER_KEY);
      deptKey = await prisma.departmentKey.create({
        data: {
          departmentId,
          publicKeyId: publicKeyRecord.id,
          privateKeyEnc,
          algorithm: 'Ed25519',
          active: true
        },
        include: { publicKey: true }
      });
      return { privateKey: privateKeyPem, publicKey: publicKeyRecord.publicKey, kid: publicKeyRecord.kid, publicKeyId: publicKeyRecord.id };
    }
    const privateKeyPem = decryptPrivateKey(deptKey.privateKeyEnc, MASTER_KEY);
    return { privateKey: privateKeyPem, publicKey: deptKey.publicKey.publicKey, kid: deptKey.publicKey.kid, publicKeyId: deptKey.publicKeyId };
  }

  const globalRecord = await getGlobalPublicKeyRecord();
  if (!globalRecord) {
    throw new Error('Global signing key not configured.');
  }
  return { privateKey: ACTIVE_PRIVATE_KEY, publicKey: globalRecord.publicKey, kid: globalRecord.kid, publicKeyId: globalRecord.id };
};

const embedImageIfAvailable = async (pdfDoc, bytes) => {
  if (!bytes) return null;
  try {
    return await pdfDoc.embedPng(bytes);
  } catch (err) {
    return await pdfDoc.embedJpg(bytes);
  }
};

const generateSignedPdf = async ({ requisition, approvals, departmentName, approverName, stampBytes, signatureBytes, verificationCode, payloadHash }) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  let y = 800;

  page.drawText('REQUISITION VOUCHER', { x: margin, y, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  y -= 24;
  page.drawText(`Department: ${departmentName}`, { x: margin, y, size: 11, font });
  y -= 16;
  page.drawText(`Title: ${requisition.title}`, { x: margin, y, size: 11, font });
  y -= 16;
  y -= 16;
  page.drawText(`Type: ${requisition.type}    Amount: NGN ${Number(requisition.amount || 0).toLocaleString()}`, { x: margin, y, size: 11, font });
  y -= 16;
  page.drawText(`Urgency: ${requisition.urgency || 'normal'}`, { x: margin, y, size: 11, font });
  y -= 22;

  page.drawText('Description:', { x: margin, y, size: 11, font: boldFont });
  y -= 16;
  const desc = requisition.description || '';
  const descLines = desc.match(/.{1,90}/g) || [''];
  for (const line of descLines.slice(0, 6)) {
    page.drawText(line, { x: margin, y, size: 10, font });
    y -= 14;
  }

  y -= 10;
  page.drawText('Approval Trail:', { x: margin, y, size: 11, font: boldFont });
  y -= 16;
  approvals.forEach((a) => {
    const stamp = new Date(a.createdAt).toLocaleString();
    const line = `${a.stage?.name || 'Stage'} - ${a.action.toUpperCase()} by ${a.user?.name || 'User'} @ ${stamp}`;
    page.drawText(line.slice(0, 100), { x: margin, y, size: 9, font });
    y -= 12;
  });

  const stampImage = await embedImageIfAvailable(pdfDoc, stampBytes);
  const signatureImage = await embedImageIfAvailable(pdfDoc, signatureBytes);

  if (stampImage) {
    const stampDims = stampImage.scale(0.3);
    page.drawImage(stampImage, { x: margin, y: 120, width: stampDims.width, height: stampDims.height, opacity: 0.9 });
  }

  if (signatureImage) {
    const sigDims = signatureImage.scale(0.3);
    page.drawImage(signatureImage, { x: 360, y: 120, width: sigDims.width, height: sigDims.height, opacity: 0.9 });
    page.drawText(`Signed by ${approverName}`, { x: 360, y: 105, size: 9, font });
  }

  page.drawText(`Verification Code: ${verificationCode}`, { x: margin, y: 60, size: 9, font: boldFont });
  page.drawText(`Payload Hash: ${payloadHash.slice(0, 20)}...`, { x: margin, y: 46, size: 8, font });

  return pdfDoc.save();
};

const processApprovalAction = async ({ requisitionId, action, remarks, user }) => {
  const userId = getNumericUserId(user);
  if (!userId) {
    const err = new Error('Department accounts cannot approve requisitions');
    err.status = 403;
    throw err;
  }

  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: { attachments: true, department: true, currentStage: true }
  });
  if (!requisition) {
    const err = new Error('Requisition not found');
    err.status = 404;
    throw err;
  }
  if (requisition.status !== 'pending') {
    const err = new Error('Requisition is not pending');
    err.status = 400;
    throw err;
  }

  const eligibleStages = await getEligibleStages(requisition.amount || 0);
  const currentStage = requisition.currentStageId
    ? eligibleStages.find(s => s.id === requisition.currentStageId)
    : eligibleStages[0];

  if (!currentStage) {
    const err = new Error('No workflow stage configured');
    err.status = 400;
    throw err;
  }

  const userRole = normalizeRole(user.role);
  if (userRole !== 'global_admin' && !userRole.includes(currentStage.role.toLowerCase())) {
    const err = new Error('User role not authorized for this stage');
    err.status = 403;
    throw err;
  }

  const approval = await prisma.approval.create({
    data: {
      requisitionId: requisition.id,
      stageId: currentStage.id,
      action,
      remarks: remarks || null,
      userId
    }
  });

  const payload = {
    requisitionId: requisition.id,
    stageId: currentStage.id,
    departmentId: requisition.departmentId,
    approverId: userId,
    action,
    timestamp: new Date().toISOString(),
    contentHash: computeContentHash(requisition),
    attachmentsHash: computeAttachmentsHash(requisition.attachments)
  };
  const payloadString = JSON.stringify(payload);
  const payloadHash = sha256Hex(payloadString);
  const signingKey = await getDepartmentSigningKey(requisition.departmentId);
  const signature = signHashHex(payloadHash, signingKey.privateKey);

  let verificationCode = generateVerificationCode('VER');
  let attempts = 0;
  while (attempts < 5) {
    const exists = await prisma.signatureRecord.findUnique({ where: { verificationCode } });
    if (!exists) break;
    verificationCode = generateVerificationCode('VER');
    attempts += 1;
  }

  await prisma.signatureRecord.create({
    data: {
      approvalId: approval.id,
      payloadHash,
      signature,
      verificationCode,
      publicKeyId: signingKey.publicKeyId
    }
  });

  let updated;
  if (action === 'approved') {
    const nextStage = findNextStage(eligibleStages, currentStage.id);
    if (nextStage) {
      updated = await prisma.requisition.update({
        where: { id: requisition.id },
        data: {
          currentStageId: nextStage.id,
          lastActionById: userId,
          lastActionAt: new Date()
        }
      });
      await notifyRole(nextStage.role, `Pending Approval: ${requisition.title}`, requisition.id, requisition.departmentId);
      await notifyDepartmentHead({
        departmentId: requisition.departmentId,
        requisition,
        subject: `Requisition Stage Approved: ${requisition.title}`,
        lines: [
          `Status: Pending next approval`,
          `Stage Approved: ${currentStage.name} (${currentStage.role})`,
          `Approved By: ${user.name || 'Approver'}`,
          `Next Stage: ${nextStage.name} (${nextStage.role})`,
          amountLine(requisition.type, requisition.amount),
          `Verification Code: ${verificationCode}`
        ]
      });
    } else {
      const stamp = await prisma.departmentStamp.findUnique({ where: { departmentId: requisition.departmentId } });
      const signatureRecord = await prisma.userSignature.findUnique({ where: { userId } });

      const stampBytes = stamp ? await getObjectBuffer(stamp.imageKey) : null;
      const signatureBytes = signatureRecord ? await getObjectBuffer(signatureRecord.imageKey) : null;

      const approvals = await prisma.approval.findMany({
        where: { requisitionId: requisition.id },
        include: { stage: true, user: true },
        orderBy: { createdAt: 'asc' }
      });

      const pdfBytes = await generateSignedPdf({
        requisition,
        approvals,
        departmentName: requisition.department?.name || 'Department',
        approverName: user.name || 'Approver',
        stampBytes,
        signatureBytes,
        verificationCode,
        payloadHash
      });

      const pdfKey = generateStorageKey(`signed/${requisition.id}`, `requisition-${requisition.id}.pdf`);
      await putObject({ key: pdfKey, body: pdfBytes, contentType: 'application/pdf' });
      const pdfHash = sha256Hex(pdfBytes);

      updated = await prisma.requisition.update({
        where: { id: requisition.id },
        data: {
          status: 'approved',
          approvedAt: new Date(),
          currentStageId: null,
          lastActionById: userId,
          lastActionAt: new Date(),
          signedPdfKey: pdfKey,
          signedPdfHash: pdfHash
        }
      });
      await notifyRole('creator', `Requisition Fully Approved: ${requisition.title}`, requisition.id, requisition.departmentId);
      await notifyRole('department', `Requisition Fully Approved: ${requisition.title}`, requisition.id, requisition.departmentId);
      await notifyDepartmentHead({
        departmentId: requisition.departmentId,
        requisition,
        subject: `Requisition Fully Approved: ${requisition.title}`,
        lines: [
          `Status: Approved`,
          `Approved By: ${user.name || 'Approver'}`,
          amountLine(requisition.type, requisition.amount),
          `Verification Code: ${verificationCode}`
        ]
      });
    }
  } else {
    updated = await prisma.requisition.update({
      where: { id: requisition.id },
      data: {
        status: 'rejected',
        rejectedAt: new Date(),
        currentStageId: null,
        lastActionById: userId,
        lastActionAt: new Date()
      }
    });
    await notifyRole('creator', `Requisition Rejected: ${requisition.title}`, requisition.id, requisition.departmentId);
    await notifyRole('department', `Requisition Rejected: ${requisition.title}`, requisition.id, requisition.departmentId);
    await notifyDepartmentHead({
      departmentId: requisition.departmentId,
      requisition,
      subject: `Requisition Rejected: ${requisition.title}`,
      lines: [
        `Status: Rejected`,
        `Rejected By: ${user.name || 'Approver'}`,
        `Stage: ${currentStage.name} (${currentStage.role})`,
        remarks ? `Remarks: ${remarks}` : null,
        `Verification Code: ${verificationCode}`
      ]
    });
  }

  await prisma.activityLog.create({
    data: {
      userId,
      action: `Requisition ${action}`,
      details: `Requisition #${requisition.id} ${action}. ${remarks ? `Remarks: ${remarks}` : ''}`.trim()
    }
  });

  return updated;
};

// Auth
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const parsed = z.object({
      email: z.string().email(),
      password: z.string().min(8)
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Login details are missing or invalid. Please check your credentials and try again.' });
    }
    const { email, password } = parsed.data;

    // Account lockout check
    if (checkLockout(email)) {
      return res.status(429).json({ error: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.' });
    }

    const user = await prisma.user.findUnique({ where: { email }, include: { department: true } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      recordFailedLogin(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearLoginAttempts(email);
    const userData = { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department?.name || 'General' };
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
    await prisma.activityLog.create({ data: { action: 'Logged In', details: `${user.name} (Admin) authenticated`, userId: user.id } });
    res.cookie('rms_token', token, cookieOptions);
    res.json({ token, user: userData });
  } catch (error) { sendError(res, 500, error.message); }
});

// Logout (revoke token)
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  if (req.token) tokenBlacklist.add(req.token);
  res.clearCookie('rms_token', { path: '/' });
  res.json({ ok: true, message: 'Token revoked successfully.' });
});

// Refresh Token
app.post('/api/auth/refresh', authenticateToken, (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    // Revoke old token
    if (req.token) tokenBlacklist.add(req.token);

    // Issue new 12h token — carry tokenVersion forward unchanged (it's only ever bumped by
    // a security reset, which should invalidate refreshes too, not just direct logins).
    const userData = { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department, deptId: user.deptId, ...(user.tokenVersion != null ? { tokenVersion: user.tokenVersion } : {}) };
    const newToken = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
    res.cookie('rms_token', newToken, cookieOptions);
    res.json({ token: newToken, user: userData });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/auth/dept-login', authLimiter, async (req, res) => {
  try {
    const parsed = z.object({
      departmentName: z.string().min(1),
      accessCode: z.string().min(1),
      mfaCode: z.string().optional().nullable()
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Login details are missing or invalid. Please check your credentials and try again.' });
    }
    const { departmentName, accessCode, mfaCode } = parsed.data;
    const { turnstileToken } = req.body;

    const deptKey = `dept:${(departmentName || '').trim().toLowerCase()}`;
    logger.info(`[AUTH] Unified login attempt: "${departmentName?.trim()}"`);

    // Turnstile human verification — skipped when TURNSTILE_ENABLED=false in env
    if (process.env.TURNSTILE_ENABLED !== 'false') {
      try {
        const tsRows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'turnstile_required_depts' LIMIT 1`;
        const requiredDepts = tsRows?.[0]?.value ? JSON.parse(tsRows[0].value).map(n => n.toLowerCase()) : [];
        if (requiredDepts.includes((departmentName || '').trim().toLowerCase())) {
          const turnstileOk = await verifyTurnstile(turnstileToken, req.ip);
          if (!turnstileOk) {
            return res.status(400).json({ error: 'Human verification failed. Please complete the security check and try again.' });
          }
        }
      } catch (tsErr) {
        logger.warn('[TURNSTILE] Config read error, skipping check:', tsErr.message);
      }
    }

    // Account lockout check for department
    if (checkLockout(deptKey)) {
      return res.status(429).json({ error: 'Department temporarily locked due to too many failed attempts. Try again in 15 minutes.' });
    }

    // Look up the selected department (must be a main/parent dept — sub-accounts are not listed)
    const dept = await prisma.department.findFirst({
      where: { name: { equals: departmentName?.trim(), mode: 'insensitive' } }
    });

    if (!dept) {
      recordFailedLogin(deptKey);
      console.warn(`[AUTH] Failed: ${departmentName} / ${maskSecret(accessCode)}`);
      return res.status(401).json({ error: 'Invalid Department or Password' });
    }

    const isSuperAdmin = dept.name.toLowerCase() === 'super admin';
    const trimmedAccess = accessCode.trim();

    // ── Step 1: verify access code ───────────────────────────────────────────
    // Super Admin MUST use SUPER_ADMIN_ACCESS_CODE env var — no DB fallback.
    let codeMatch = false;
    if (isSuperAdmin) {
      if (!SUPER_ADMIN_ACCESS_CODE) {
        return res.status(500).json({ error: 'Super Admin access code not configured. Set SUPER_ADMIN_ACCESS_CODE in Railway environment variables.' });
      }
      const provided = Buffer.from(trimmedAccess);
      const expected = Buffer.from(SUPER_ADMIN_ACCESS_CODE);
      codeMatch = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    } else {
      codeMatch = dept.accessCodeHash
        ? await bcrypt.compare(trimmedAccess, dept.accessCodeHash)
        : dept.accessCode === trimmedAccess;
    }

    // ── Step 2: if no match, check sub-accounts of this dept ─────────────────
    let matchedSubAccount = null;
    if (!codeMatch && !isSuperAdmin) {
      const subAccounts = await prisma.department.findMany({
        where: { parentId: dept.id, isSubAccount: true, isDeleted: false }
      });
      for (const sub of subAccounts) {
        const subMatch = sub.accessCodeHash
          ? await bcrypt.compare(trimmedAccess, sub.accessCodeHash)
          : sub.accessCode === trimmedAccess;
        if (subMatch) { matchedSubAccount = sub; break; }
      }
    }

    if (!codeMatch && !matchedSubAccount) {
      recordFailedLogin(deptKey);
      console.warn(`[AUTH] Failed: ${departmentName} / ${maskSecret(accessCode)}`);
      return res.status(401).json({ error: 'Invalid Department or Password' });
    }

    // The resolved entity is either the dept head or the matched sub-account
    const resolved = matchedSubAccount || dept;

    if (resolved.isDeleted) {
      return res.status(403).json({ error: 'This sub-account has been deleted. Please contact your department head or system administrator.' });
    }
    if (resolved.isDisabled) {
      const msg = matchedSubAccount
        ? 'This account has been disabled. Please contact your department head.'
        : 'This department has been suspended by the Super Admin. Please contact the system administrator.';
      return res.status(403).json({ error: msg });
    }

    if (isSuperAdmin) {
      if (!SUPER_ADMIN_MFA_PIN) {
        return res.status(500).json({ error: 'Super Admin MFA PIN not configured' });
      }
      if (String(mfaCode || '').trim() !== SUPER_ADMIN_MFA_PIN) {
        return res.status(401).json({ error: 'Invalid MFA PIN' });
      }
    }

    // ── First-time activation gate — dept head ────────────────────────────────
    if (!isSuperAdmin && !matchedSubAccount && !resolved.codeChangedByDept) {
      clearLoginAttempts(deptKey);
      const activationToken = jwt.sign(
        { purpose: 'activation', deptId: resolved.id, deptName: resolved.name },
        JWT_SECRET,
        { expiresIn: '30m' }
      );
      return res.json({
        requiresActivation: true,
        activationToken,
        deptName: resolved.name,
        headName:  resolved.headName  || '',
        headTitle: resolved.headTitle || '',
        headEmail: resolved.headEmail || '',
      });
    }

    // ── First-time activation gate — sub-account ──────────────────────────────
    if (!isSuperAdmin && matchedSubAccount && !matchedSubAccount.codeChangedByDept) {
      clearLoginAttempts(deptKey);
      const activationToken = jwt.sign(
        { purpose: 'activation', deptId: matchedSubAccount.id, deptName: matchedSubAccount.name, isSubAccount: true, parentDeptId: dept.id, parentDeptName: dept.name },
        JWT_SECRET,
        { expiresIn: '30m' }
      );
      return res.json({ requiresActivation: true, activationToken, deptName: matchedSubAccount.name, isSubAccount: true });
    }

    // Unified Role Logic: "Super Admin" department gets 'global_admin' role
    const adminUser = isSuperAdmin
      ? await prisma.user.findFirst({ where: { role: 'global_admin' } })
      : null;
    const userData = {
      id: isSuperAdmin ? (adminUser?.id || 1) : `dept_${resolved.id}`,
      name: resolved.name,
      role: isSuperAdmin ? 'global_admin' : 'department',
      deptId: resolved.id,
      tokenVersion: resolved.tokenVersion || 0,
      email: `${resolved.name.toLowerCase().replace(/\s/g, '')}@cssgroup.local`,
      ...(matchedSubAccount ? {
        isSubAccount: true,
        parentDeptId: dept.id,
        parentDeptName: dept.name,
        directRoute: resolved.directRoute ?? false,
        allowedRouteDeptIds: (() => { try { return JSON.parse(resolved.allowedRouteDeptIds || 'null') || []; } catch { return []; } })(),
      } : {}),
      ...(resolved.privilegeAmount != null ? { privilegeAmount: resolved.privilegeAmount } : {}),
      ...(resolved.approvalLimit   != null ? { approvalLimit: resolved.approvalLimit }     : {}),
      ...(resolved.memoPrivilege           ? { memoPrivilege: true }                       : {}),
      ...(resolved.materialPrivilege       ? { materialPrivilege: true }                   : {})
    };

    clearLoginAttempts(deptKey);
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
    const logLabel = matchedSubAccount ? `${matchedSubAccount.name} (sub-account of ${dept.name})` : dept.name;
    await prisma.activityLog.create({ data: { action: 'Login', details: `${logLabel} authenticated via unified portal` } });
    res.cookie('rms_token', token, cookieOptions);
    res.json({ token, user: userData });
  } catch (error) { sendError(res, 500, error.message); }
});

// First-time department activation — called after first login with admin-given access code
app.post('/api/departments/activate', async (req, res) => {
  try {
    const { activationToken, headName, headTitle, headEmail, newPassword, confirmPassword } = req.body;
    if (!activationToken) return res.status(400).json({ error: 'Activation token missing.' });
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

    let payload;
    try { payload = jwt.verify(activationToken, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'Activation session expired. Please log in again.' }); }
    if (payload.purpose !== 'activation') return res.status(401).json({ error: 'Invalid activation token.' });

    const isSub = !!payload.isSubAccount;

    // Dept head requires a name; sub-accounts already have their name set by the head
    if (!isSub && !headName?.trim()) return res.status(400).json({ error: 'Name is required.' });

    const dept = await prisma.department.findUnique({ where: { id: payload.deptId } });
    if (!dept) return res.status(404).json({ error: 'Department not found.' });

    // Block reusing the access code as the permanent password — the code is admin-visible
    // and is meant to be one-time only. Check plain label first, then fall back to bcrypt.
    const originalLabel = dept.accessCodeLabel;
    if (originalLabel && newPassword === originalLabel) {
      return res.status(400).json({ error: 'Your new password cannot be the same as your access code. Please choose a different password.' });
    }
    if (!originalLabel && dept.accessCodeHash && !dept.codeChangedByDept) {
      const sameAsCode = await bcrypt.compare(newPassword, dept.accessCodeHash);
      if (sameAsCode) return res.status(400).json({ error: 'Your new password cannot be the same as your access code. Please choose a different password.' });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    if (isSub) {
      // Sub-account activation: set new password only, store plain-text in accessCodeLabel so admin can always see it
      const updated = await prisma.department.update({
        where: { id: dept.id },
        data: { accessCodeHash: hash, accessCodeLabel: newPassword, codeChangedByDept: true }
      });
      const userData = {
        id: `dept_${updated.id}`,
        name: updated.name,
        role: 'department',
        deptId: updated.id,
        tokenVersion: updated.tokenVersion || 0,
        email: updated.headEmail || `${updated.name.toLowerCase().replace(/\s/g, '')}@cssgroup.local`,
        isSubAccount: true,
        parentDeptId: payload.parentDeptId,
        parentDeptName: payload.parentDeptName,
        directRoute: updated.directRoute ?? false,
        allowedRouteDeptIds: (() => { try { return JSON.parse(updated.allowedRouteDeptIds || 'null') || []; } catch { return []; } })(),
        ...(updated.privilegeAmount != null ? { privilegeAmount: updated.privilegeAmount } : {}),
        ...(updated.approvalLimit   != null ? { approvalLimit: updated.approvalLimit }     : {}),
        ...(updated.memoPrivilege           ? { memoPrivilege: true }                      : {}),
        ...(updated.materialPrivilege       ? { materialPrivilege: true }                  : {}),
      };
      const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
      await prisma.activityLog.create({ data: { action: 'Sub-Account Activation', details: `${updated.name} completed first-time password setup` } });
      res.cookie('rms_token', token, cookieOptions);
      return res.json({ token, user: userData });
    }

    // Dept head activation — email is required
    if (!headEmail?.trim()) return res.status(400).json({ error: 'Email address is required.' });

    const updated = await prisma.department.update({
      where: { id: dept.id },
      data: {
        headName:          headName.trim(),
        headTitle:         headTitle?.trim() || dept.headTitle || null,
        headEmail:         headEmail.trim(),
        accessCodeHash:    hash,
        // Keep accessCodeLabel (the original admin-set code) so hard-reset can restore it
        codeChangedByDept: true,
      }
    });
    const userData = {
      id: `dept_${updated.id}`,
      name: updated.name,
      role: 'department',
      deptId: updated.id,
      tokenVersion: updated.tokenVersion || 0,
      email: updated.headEmail,
    };
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
    await prisma.activityLog.create({ data: { action: 'Activation', details: `${updated.name} completed first-time account activation` } });

    // Welcome email to the newly activated dept head
    const activatedDate = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
    const { text: wText, html: wHtml } = buildEmailContent({
      title: `Welcome to CSS Group RMS — ${updated.name}`,
      lines: [
        `Your department account has been successfully activated on the CSS Group Requisition Management System (RMS).`,
        ``,
        `Department: ${updated.name}`,
        `Name: ${updated.headName}`,
        ...(updated.headTitle ? [`Position / Title: ${updated.headTitle}`] : []),
        `Email: ${updated.headEmail}`,
        `Activated: ${activatedDate}`,
        ``,
        `You can now log in to the RMS portal with your newly created password at any time. Keep your password secure and do not share it.`,
        ``,
        `If you did not perform this activation or need assistance, contact the ICT Department immediately.`
      ],
      actionLabel: 'Open RMS Portal'
    });
    sendEmail({ to: updated.headEmail, subject: `[RMS] Welcome — ${updated.name} Account Activated`, text: wText, html: wHtml }).catch(() => {});

    res.cookie('rms_token', token, cookieOptions);
    res.json({ token, user: userData });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/auth/me', authenticateToken, (req, res) => res.json({ user: req.user }));

// Full profile — includes createdAt, last activity
app.get('/api/auth/me/full', authenticateToken, async (req, res) => {
  try {
    const userId = getNumericUserId(req.user);
    if (!userId) return res.json({ user: req.user, lastActivity: null });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, createdAt: true, department: { select: { id: true, name: true } } }
    });
    if (!user) return res.json({ user: req.user, lastActivity: null });
    const lastActivity = await prisma.activityLog.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    res.json({ user, lastActivity });
  } catch (error) { sendError(res, 500, error.message); }
});

// Update own name / email (admin users only — dept accounts have no userId)
app.put('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userId = getNumericUserId(req.user);
    if (!userId) return sendError(res, 403, 'Profile editing is not available for department accounts. Use the Dept Profile page instead.');
    const { name, email } = req.body;
    if (!name?.trim()) return sendError(res, 400, 'Name cannot be empty.');
    if (email && email !== req.user.email) {
      const clash = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (clash && clash.id !== userId) return sendError(res, 409, 'That email address is already used by another account.');
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { name: name.trim(), ...(email ? { email: email.trim().toLowerCase() } : {}) },
      select: { id: true, name: true, email: true, role: true }
    });
    const userData = { ...req.user, name: updated.name, email: updated.email };
    if (req.token) tokenBlacklist.add(req.token);
    const newToken = jwt.sign(userData, JWT_SECRET, { expiresIn: '12h' });
    await prisma.activityLog.create({ data: { userId, action: 'Profile Updated', details: `${updated.name} updated their profile` } });
    res.cookie('rms_token', newToken, cookieOptions);
    res.json({ user: updated, token: newToken });
  } catch (error) { sendError(res, 500, error.message); }
});

// Change own password (admin users only)
app.put('/api/auth/me/password', authenticateToken, async (req, res) => {
  try {
    const userId = getNumericUserId(req.user);
    if (!userId) return sendError(res, 403, 'Password change is not available for department accounts.');
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return sendError(res, 400, 'Both current and new passwords are required.');
    if (newPassword.length < 8) return sendError(res, 400, 'New password must be at least 8 characters long.');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(res, 404, 'Account not found.');
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return sendError(res, 401, 'The current password you entered is incorrect.');
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    await prisma.activityLog.create({ data: { userId, action: 'Password Changed', details: `${user.name} changed their account password` } });
    res.json({ ok: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// Data
app.get('/api/departments', async (req, res) => {
  try {
    // Check optional auth — authenticated users get full data, public gets minimal fields
    const token = req.cookies?.rms_token
      || (req.headers['authorization']?.split(' ')[1]);
    let isAuthenticated = false;
    let isGlobalAdmin = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        isAuthenticated = true;
        isGlobalAdmin = normalizeRole(decoded.role) === 'global_admin';
      } catch (_) { }
    }

    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: isGlobalAdmin
        ? { id: true, name: true, type: true, code: true, staffId: true, headName: true, headTitle: true, headEmail: true, phone: true, address: true, parentId: true, stamp: true, accessCode: true, accessCodeLabel: true, codeChangedByDept: true, isSubAccount: true }
        : isAuthenticated
          ? { id: true, name: true, type: true, code: true, staffId: true, headName: true, headTitle: true, headEmail: true, phone: true, address: true, parentId: true, stamp: true, directRoute: true, allowedRouteDeptIds: true, privilegeAmount: true, approvalLimit: true, isSubAccount: true }
          : { id: true, name: true, type: true, code: true, isSubAccount: true }
    });
    res.json(departments);
  } catch (error) { sendError(res, 500, error.message); }
});

// Public: whether a department has self-activated its password (drives login label)
app.get('/api/departments/login-status', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const dept = await prisma.department.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, isDeleted: false },
      select: { codeChangedByDept: true, isSubAccount: true }
    });
    if (!dept) return res.status(404).json({ error: 'Not found' });
    res.json({ activated: dept.codeChangedByDept === true, isSubAccount: dept.isSubAccount === true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/departments/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const department = await prisma.department.findUnique({
      where: { id: parseInt(id) },
      select: { id: true, name: true, type: true, code: true, staffId: true, headName: true, headTitle: true, headEmail: true, phone: true, address: true, parentId: true, stamp: true }
    });
    if (!department) return res.status(404).json({ error: 'Department not found' });
    if (req.user.role === 'department' && req.user.deptId && department.id !== req.user.deptId) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    res.json(department);
  } catch (error) { sendError(res, 500, error.message); }
});

// Dynamic Requisition Types
app.get('/api/requisition-types', async (req, res) => {
  try {
    const types = await prisma.requisitionType.findMany({ orderBy: { name: 'asc' } });
    res.json(types);
  } catch (error) { sendError(res, 500, error.message); }
});

// Dynamic Workflow Stages
app.get('/api/workflow-stages', async (req, res) => {
  try {
    const stages = await prisma.workflowStage.findMany({ orderBy: { sequence: 'asc' } });
    res.json(stages);
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/workflow-stages', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const parsed = z.array(z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      threshold: z.union([z.number(), z.string()]).optional()
    })).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid workflow payload' });
    const stages = parsed.data; // Expects full array

    await prisma.$transaction([
      prisma.workflowStage.deleteMany(),
      ...stages.map((stage, idx) => prisma.workflowStage.create({
        data: {
          sequence: idx + 1,
          name: stage.name,
          role: stage.role,
          threshold: parseFloat(stage.threshold) || 0
        }
      }))
    ]);

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// Notifications
// Notifications Helper
const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));

const formatCurrency = (amount) => {
  const num = Number(amount || 0);
  if (Number.isNaN(num)) return '₦0.00';
  return `₦${num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Returns true for financial/procurement requests (Cash, Purchase, etc.)
// Memo type is purely administrative and should never show monetary amounts
const isMonetaryType = (type) => {
  if (!type) return false;
  const t = type.toLowerCase();
  return t !== 'memo' && t !== 'material';
};

// Returns an Amount line string for emails, or null if the request is non-monetary
const amountLine = (type, amount) => {
  if (!isMonetaryType(type)) return null;
  return `Amount: ${formatCurrency(amount)}`;
};

const buildEmailContent = ({ title, lines = [], actionUrl, actionLabel }) => {
  const portalUrl = APP_BASE_URL ? APP_BASE_URL.replace(/\/$/, '') : '';
  const logoUrl   = portalUrl ? `${portalUrl}/CSS_Group.png` : '';
  const finalActionUrl = actionUrl || portalUrl || '';

  const safeLines = lines.filter(Boolean).map((line) => String(line));
  const text = [title, '', ...safeLines, finalActionUrl ? `\nOpen Portal: ${finalActionUrl}` : ''].filter(Boolean).join('\n');

  // Split lines into key:value pairs vs plain sentences
  const rows = safeLines.map((line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 40) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      return `
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#6b7280;font-weight:600;white-space:nowrap;width:40%;vertical-align:top;">${escapeHtml(key)}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#111827;font-weight:500;vertical-align:top;">${escapeHtml(val)}</td>
        </tr>`;
    }
    return `
      <tr>
        <td colspan="2" style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#374151;">${escapeHtml(line)}</td>
      </tr>`;
  }).join('');

  const button = finalActionUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td align="center">
          <a href="${finalActionUrl}" style="display:inline-block;background-color:#1a7a3c;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:8px;letter-spacing:0.3px;">
            ${escapeHtml(actionLabel || 'Open RMS Portal')} &rarr;
          </a>
        </td>
      </tr>
    </table>` : '';

  const logoImg = logoUrl
    ? `<img src="${logoUrl}" alt="CSS Group" style="height:36px;max-width:160px;object-fit:contain;display:block;" />`
    : `<p style="margin:0;font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">CSS RMS</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

        <!-- Header with logo -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a7a3c 0%,#0f5124 100%);padding:24px 32px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="vertical-align:middle;">
                  ${logoImg}
                </td>
                <td align="right" style="vertical-align:middle;">
                  <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:5px 14px;display:inline-block;">
                    <span style="font-size:11px;font-weight:800;color:rgba(255,255,255,0.95);letter-spacing:2.5px;text-transform:uppercase;">RMS Portal</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding-top:10px;">
                  <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.5px;text-transform:uppercase;">CSS Group of Companies — Requisition Management System</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Title bar -->
        <tr>
          <td style="background:#f8fffe;border-bottom:2px solid #d1fae5;padding:20px 32px;">
            <p style="margin:0;font-size:18px;font-weight:800;color:#111827;letter-spacing:-0.3px;">${escapeHtml(title)}</p>
            <p style="margin:6px 0 0;font-size:11px;color:#6b7280;">Automated notification &bull; ${new Date().toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Africa/Lagos' })}</p>
          </td>
        </tr>

        <!-- Details table -->
        <tr>
          <td style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          </td>
        </tr>

        <!-- Action button -->
        <tr><td style="padding:8px 32px 32px;">${button}</td></tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:18px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:11px;color:#9ca3af;">This is an automated message from <strong style="color:#6b7280;">CSS RMS</strong>. Please do not reply directly to this email.</p>
                  ${portalUrl ? `<p style="margin:4px 0 0;font-size:11px;"><a href="${portalUrl}" style="color:#1a7a3c;text-decoration:none;font-weight:600;">Visit Portal &rarr;</a></p>` : ''}
                  <p style="margin:4px 0 0;font-size:10px;color:#d1d5db;">&copy; ${new Date().getFullYear()} CSS Group of Companies. All rights reserved.</p>
                </td>
                <td align="right" style="vertical-align:middle;padding-left:16px;">
                  ${logoUrl
                    ? `<img src="${logoUrl}" alt="CSS" style="height:28px;opacity:0.35;display:block;" />`
                    : `<div style="width:32px;height:32px;background:#1a7a3c;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;"><span style="color:#fff;font-size:13px;font-weight:900;">R</span></div>`
                  }
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html };
};

// ── Termii SMS ──────────────────────────────────────────────────────────────
// Nigerian numbers must be sent to Termii in "234XXXXXXXXXX" form — no leading
// 0 or +. Strips formatting (spaces/dashes/parens) from whatever was typed in.
function normalizeNgPhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[^\d+]/g, '');
  p = p.replace(/^\+/, '');
  if (p.startsWith('0')) p = '234' + p.slice(1);
  else if (!p.startsWith('234')) p = '234' + p;
  return p;
}

async function sendTermiiSms({ to, message }) {
  // Termii's classic REST API (get-balance, sms/send) authenticates with the long
  // "API Key" from the dashboard — NOT the "tsk_"-prefixed Secret Key, which is for
  // their newer Bearer-token API and doesn't work as the `api_key` query param here.
  const apiKey   = process.env.TERMII_API_KEY || process.env.TERMII_SECRET_KEY;
  const senderId = process.env.TERMII_SENDER_ID || 'TVET';
  const channel  = process.env.TERMII_SMS_CHANNEL || 'generic';
  if (!apiKey || !to) {
    logger.warn(`[SMS] Skipped — ${!apiKey ? 'TERMII_API_KEY missing' : 'no phone number'}.`);
    return { skipped: true };
  }
  const phone = normalizeNgPhone(to);
  try {
    const resp = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: phone, from: senderId, sms: message, type: 'plain', channel, api_key: apiKey }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn('[SMS] Termii send failed:', JSON.stringify(data));
      return { error: data };
    }
    logger.info(`[SMS] Sent via Termii to ${phone}`);
    return data;
  } catch (e) {
    logger.warn('[SMS] Termii request error:', e.message);
    return { error: e.message };
  }
}

// Twilio requires full E.164 format (leading +). Reuses the same digit-cleanup as
// Termii's normalizer, then re-adds the +.
function normalizeE164Phone(raw) {
  const digits = normalizeNgPhone(raw);
  return digits ? `+${digits}` : null;
}

async function sendTwilioSms({ to, message }) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from || !to) {
    logger.warn(`[SMS] Skipped — Twilio not fully configured or no phone number.`);
    return { skipped: true };
  }
  const phone = normalizeE164Phone(to);
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      },
      body: new URLSearchParams({ To: phone, From: from, Body: message }).toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn('[SMS] Twilio send failed:', JSON.stringify(data));
      return { error: data };
    }
    logger.info(`[SMS] Sent via Twilio to ${phone}`);
    return data;
  } catch (e) {
    logger.warn('[SMS] Twilio request error:', e.message);
    return { error: e.message };
  }
}

// ── TextFlow SMS ─────────────────────────────────────────────────────────────
async function sendTextflowSms({ to, message }) {
  const apiKey = process.env.TEXTFLOW_API_KEY;
  const sender = process.env.TEXTFLOW_SENDER_ID || 'BBConcepts';
  if (!apiKey || !to) {
    logger.warn(`[SMS] Skipped — ${!apiKey ? 'TEXTFLOW_API_KEY missing' : 'no phone number'}.`);
    return { skipped: true };
  }
  const phone = normalizeNgPhone(to);
  try {
    // TextFlow requires local NG format (08012345678), not international (2348...)
    const localPhone = phone.startsWith('234') ? '0' + phone.slice(3) : phone;
    const payload = { sender_id: sender, recipients: localPhone, message };

    // TextFlow's send endpoint sits behind Laravel web middleware (CSRF-protected).
    // We must fetch a CSRF token + session cookie from the homepage first.
    const csrfPage = await fetch('https://textflow.ng', { headers: { 'Accept': 'text/html' } });
    const csrfHtml = await csrfPage.text().catch(() => '');
    const csrfMatch = csrfHtml.match(/<meta name="csrf-token" content="([^"]+)"/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    const sessionCookies = (csrfPage.headers.get('set-cookie') || '')
      .split(/,(?=[^;]+?=)/).map(c => c.split(';')[0]).join('; ');
    logger.info(`[SMS] TextFlow CSRF token obtained: ${csrfToken ? 'yes' : 'NO'}`);

    logger.info(`[SMS] TextFlow send request — recipients=${localPhone} sender_id=${sender}`);
    const resp = await fetch('https://textflow.ng/api/v1/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-CSRF-TOKEN': csrfToken,
        'Cookie': sessionCookies,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(payload),
    });
    const rawText = await resp.text().catch(() => '');
    logger.info(`[SMS] TextFlow send response — status ${resp.status}, raw: ${rawText.slice(0, 300)}`);
    let data = {};
    try { data = JSON.parse(rawText); } catch { data = { _raw: rawText.slice(0, 100) }; }
    if (!resp.ok) {
      logger.warn('[SMS] TextFlow send failed:', JSON.stringify(data));
      return { error: data };
    }
    if (data?.status !== 'success') {
      logger.warn('[SMS] TextFlow send non-success:', JSON.stringify(data));
      return { error: data?.message || rawText.slice(0, 100) || JSON.stringify(data) };
    }
    logger.info(`[SMS] Sent via TextFlow to ${phone} (local: ${localPhone})`);
    return data;
  } catch (e) {
    logger.warn('[SMS] TextFlow request error:', e.message);
    return { error: e.message };
  }
}

// Reads the Super-Admin-selected provider (default 'termii' if never set).
async function getSmsProvider() {
  try {
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'sms_provider' LIMIT 1`;
    const v = rows?.[0]?.value;
    if (v === 'twilio') return 'twilio';
    if (v === 'textflow') return 'textflow';
    return 'termii';
  } catch { return 'termii'; }
}

// Single entry point used everywhere else in the app — dispatches to whichever
// provider Super Admin has selected in System Settings.
async function sendSms({ to, message }) {
  const provider = await getSmsProvider();
  if (provider === 'twilio') return sendTwilioSms({ to, message });
  if (provider === 'textflow') return sendTextflowSms({ to, message });
  return sendTermiiSms({ to, message });
}

async function notifyDepartmentHead({ departmentId, requisition, subject, lines }) {
  try {
    // Always fetch by departmentId when provided — do NOT use requisition.department
    // as a shortcut, because that object is the CREATOR's department and would cause
    // every notification to go to the wrong recipient.
    const dept = departmentId
      ? await prisma.department.findUnique({ where: { id: departmentId } })
      : requisition?.department;
    const isMemoNotice = /memo/i.test(requisition?.type || '') || /memorandum/i.test(requisition?.type || '');
    const recordPath = requisition?.id ? (isMemoNotice ? `/memos/${requisition.id}` : `/requisitions/${requisition.id}`) : null;

    // 1. Create Platform Notification (for Dashboard bell icon)
    if (departmentId) {
      await prisma.notification.create({
        data: {
          departmentId: departmentId,
          content: subject,
          link: recordPath
        }
      });
    }

    // 2. Send Email if address exists
    if (!dept?.headEmail) {
      logger.info(`[MAIL] Skipping head notify for ${dept?.name || departmentId} - no email set.`);
      return;
    }

    const actionUrl = APP_BASE_URL && recordPath ? `${APP_BASE_URL.replace(/\/$/, '')}${recordPath}` : '';
    const { text, html } = buildEmailContent({
      title: subject,
      lines,
      actionUrl,
      actionLabel: 'Open Requisition'
    });

    logger.info(`[MAIL] Attempting to send email to: ${dept.headEmail} | Subject: ${subject}`);
    const result = await sendEmail({ to: dept.headEmail, subject, text, html });
    if (result && result.skipped) {
      logger.warn(`[MAIL] Send SKIPPED for ${dept.headEmail} — RESEND_API_KEY is not configured.`);
    } else {
      logger.info(`[MAIL] ✅ Email sent successfully to: ${dept.headEmail}`);
    }
  } catch (err) {
    logger.error(`[MAIL] Department head notify FAILED for dept ${departmentId}:`, err.message, err.stack);
  }
}

async function notifyRole(roleName, message, requisitionId, departmentId = null) {
  try {
    // Find users with this role (Admin, Audit, etc.)
    const users = await prisma.user.findMany({
      where: roleName === 'creator'
        ? { requisitions: { some: { id: requisitionId } } }
        : { role: { contains: roleName.toLowerCase() } }
    });

    const link = requisitionId ? `/requisitions/${requisitionId}` : null;
    const notificationData = users.map(u => ({ userId: u.id, content: message, link }));

    // Also create a department-scoped notification so the originating department
    // sees status updates even though they have no User row
    if (departmentId && (roleName === 'creator' || roleName === 'department')) {
      notificationData.push({ departmentId, content: message, link });
    }

    if (notificationData.length > 0) {
      try {
        await prisma.notification.createMany({ data: notificationData });
      } catch (err) {
        logger.warn('[NOTIF] Bulk create failed (possibly missing link column):', err.message);
        // Fallback: create without link
        const safeData = notificationData.map(({ link, ...rest }) => rest);
        await prisma.notification.createMany({ data: safeData }).catch(e => logger.error('[NOTIF] Fallback failed:', e.message));
      }
    }

    // Filter out fake placeholder emails (e.g. seeded @cssgroup.local)
    const emails = users.map(u => u.email).filter(e => e && !e.endsWith('@cssgroup.local'));
    if (emails.length > 0) {
      const actionUrl = (APP_BASE_URL && requisitionId)
        ? `${APP_BASE_URL.replace(/\/$/, '')}/requisitions/${requisitionId}`
        : (APP_BASE_URL ? APP_BASE_URL.replace(/\/$/, '') : '');
      const { text, html } = buildEmailContent({
        title: message,
        lines: requisitionId ? [`Requisition ID: #${requisitionId}`] : [],
        actionUrl,
        actionLabel: 'Open Requisition'
      });
      const results = await Promise.allSettled(emails.map(email => sendEmail({ to: email, subject: message, text, html })));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[MAIL] Failed to send to ${emails[i]}:`, r.reason?.message);
        } else {
          console.log(`[MAIL] Sent to ${emails[i]} OK`);
        }
      });
    }
  } catch (err) {
    console.error("Notification failed:", err);
  }
}

// ── NOTIFICATIONS ──
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const userId = getNumericUserId(req.user);

    // Build an OR query: match by userId (admin) OR departmentId (dept login)
    const orClauses = [];
    if (userId) orClauses.push({ userId });
    if (deptId && !isNaN(deptId)) orClauses.push({ departmentId: deptId });

    if (orClauses.length === 0) {
      console.warn("[NOTIF] No valid ID for notification query:", { role: req.user.role, id: req.user.id, deptId });
      return res.json([]);
    }

    const notifications = await prisma.notification.findMany({
      where: { OR: orClauses },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.json(notifications);
  } catch (error) {
    console.error("[NOTIF] Fetch Error:", error.message);
    res.status(500).json({ error: "Notification fetch failed" });
  }
});

// Clear ALL notifications for the user/department
app.delete('/api/notifications/clear-all', authenticateToken, async (req, res) => {
  try {
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const userId = getNumericUserId(req.user);
    const orClauses = [];
    if (userId) orClauses.push({ userId });
    if (deptId && !isNaN(deptId)) orClauses.push({ departmentId: deptId });
    if (orClauses.length === 0) return res.json({ count: 0 });

    const result = await prisma.notification.deleteMany({
      where: { OR: orClauses }
    });
    res.json({ count: result.count });
  } catch (error) { sendError(res, 500, error.message); }
});

// Mark single notification as read
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const userId = getNumericUserId(req.user);
    const orClauses = [];
    if (userId) orClauses.push({ userId });
    if (deptId && !isNaN(deptId)) orClauses.push({ departmentId: deptId });
    if (orClauses.length === 0) return res.json({ count: 0 });
    const result = await prisma.notification.updateMany({
      where: { OR: orClauses, isRead: false },
      data: { isRead: true }
    });
    res.json({ count: result.count });
  } catch (error) { sendError(res, 500, error.message); }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const notifId = parseInt(req.params.id);
    const notification = await prisma.notification.findUnique({ where: { id: notifId } });
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    const userId = getNumericUserId(req.user);
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    if (notification.userId !== userId && notification.departmentId !== deptId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await prisma.notification.update({
      where: { id: notifId },
      data: { isRead: true }
    });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Chat API ──────────────────────────────────────────────────────────────────

// Helper: broadcast a chat_message SSE event to specific dept(s) or all
function broadcastChatSSE(msg, targetDeptIds /* null = all */) {
  const payload = `event: chat_message\ndata: ${JSON.stringify(msg)}\n\n`;
  for (const [, { res, user }] of sseClients) {
    if (normalizeRole(user?.role) !== 'department') continue;
    const deptId = toIntOrNull(user?.deptId);
    if (!deptId) continue;
    if (targetDeptIds === null || targetDeptIds.includes(deptId)) {
      try { res.write(payload); } catch (_) {}
    }
  }
}

// GET /api/chat/conversations — inbox list: group unread + DM threads
app.get('/api/chat/conversations', authenticateToken, async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    if (!myDeptId) return res.json({ group: { unread: 0, lastMessage: null }, dms: [] });

    // Group unread
    const groupUnread = await prisma.chatMessage.count({
      where: { toDeptId: null, NOT: { readBy: { has: myDeptId } }, fromDeptId: { not: myDeptId } }
    });
    const lastGroupMsg = await prisma.chatMessage.findFirst({
      where: { toDeptId: null },
      orderBy: { createdAt: 'desc' },
      include: { fromDept: { select: { name: true } } }
    });

    // DM threads — get all messages involving my dept (excluding group)
    const dmMessages = await prisma.chatMessage.findMany({
      where: {
        toDeptId: { not: null },
        OR: [{ fromDeptId: myDeptId }, { toDeptId: myDeptId }]
      },
      orderBy: { createdAt: 'desc' },
      include: { fromDept: { select: { id: true, name: true } }, toDept: { select: { id: true, name: true } } }
    });

    // Build per-partner summary
    const dmMap = new Map();
    for (const m of dmMessages) {
      const partnerId = m.fromDeptId === myDeptId ? m.toDeptId : m.fromDeptId;
      const partnerName = m.fromDeptId === myDeptId ? m.toDept?.name : m.fromDept?.name;
      if (!dmMap.has(partnerId)) {
        const unread = dmMessages.filter(x =>
          ((x.fromDeptId === partnerId && x.toDeptId === myDeptId)) &&
          !x.readBy.includes(myDeptId)
        ).length;
        dmMap.set(partnerId, { deptId: partnerId, deptName: partnerName, lastMessage: m, unread });
      }
    }

    res.json({
      group: { unread: groupUnread, lastMessage: lastGroupMsg },
      dms: [...dmMap.values()]
    });
  } catch (err) { sendError(res, 500, err.message); }
});

const chatMsgInclude = {
  fromDept: { select: { id: true, name: true } },
  replyTo: {
    select: {
      id: true, body: true, mediaType: true, mediaName: true, mediaKey: true,
      fromDept: { select: { name: true } }
    }
  }
};

// GET /api/chat/group?before=<id>&limit=50 — group channel messages
app.get('/api/chat/group', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before) : undefined;
    const messages = await prisma.chatMessage.findMany({
      where: { toDeptId: null, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: chatMsgInclude
    });
    res.json(messages.reverse());
  } catch (err) { sendError(res, 500, err.message); }
});

// GET /api/chat/dm/:deptId?before=<id>&limit=50 — DM thread
app.get('/api/chat/dm/:deptId', authenticateToken, async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    const otherDeptId = parseInt(req.params.deptId);
    if (!myDeptId || isNaN(otherDeptId)) return res.status(400).json({ error: 'Invalid dept' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const before = req.query.before ? parseInt(req.query.before) : undefined;
    const messages = await prisma.chatMessage.findMany({
      where: {
        toDeptId: { not: null },
        OR: [
          { fromDeptId: myDeptId, toDeptId: otherDeptId },
          { fromDeptId: otherDeptId, toDeptId: myDeptId }
        ],
        ...(before ? { id: { lt: before } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: chatMsgInclude
    });
    res.json(messages.reverse());
  } catch (err) { sendError(res, 500, err.message); }
});

// POST /api/chat/send — send a message
app.post('/api/chat/send', authenticateToken, async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    if (!myDeptId) return res.status(403).json({ error: 'Department account required' });
    const parsed = z.object({
      body: z.string().max(2000).default(''),
      toDeptId: z.number().int().optional(),
      mediaKey: z.string().optional(),
      mediaType: z.enum(['audio', 'image', 'file']).optional(),
      mediaName: z.string().optional(),
      mediaMime: z.string().optional(),
      replyToId: z.number().int().optional(),
      reqRef: z.string().max(1000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid message' });
    const { body, toDeptId, mediaKey, mediaType, mediaName, mediaMime, replyToId, reqRef } = parsed.data;
    if (!body && !mediaKey && !reqRef) return res.status(400).json({ error: 'Message body, media, or request reference required' });
    if (toDeptId && toDeptId === myDeptId) return res.status(400).json({ error: 'Cannot message yourself' });

    const msg = await prisma.chatMessage.create({
      data: {
        fromDeptId: myDeptId, toDeptId: toDeptId || null, body, readBy: [myDeptId],
        ...(mediaKey ? { mediaKey, mediaType, mediaName, mediaMime } : {}),
        ...(replyToId ? { replyToId } : {}),
        ...(reqRef ? { reqRef } : {}),
      },
      include: {
        fromDept: { select: { id: true, name: true } },
        toDept: { select: { id: true, name: true } },
        replyTo: { select: { id: true, body: true, mediaType: true, mediaName: true, mediaKey: true, fromDept: { select: { name: true } } } }
      }
    });

    // Build human-readable preview for notifications
    const reqRefTitle = reqRef ? (() => { try { return JSON.parse(reqRef)?.title; } catch { return null; } })() : null;
    const msgPreview = body
      ? (body.length > 60 ? body.slice(0, 60) + '…' : body)
      : reqRefTitle ? `📋 ${reqRefTitle}`
      : mediaType === 'audio' ? '🎤 Voice message'
      : mediaType === 'image' ? '📷 Image'
      : `📎 ${mediaName || 'File'}`;
    const pushPreview = body
      ? (body.length > 80 ? body.slice(0, 80) + '…' : body)
      : reqRefTitle ? `📋 ${reqRefTitle}`
      : mediaType === 'audio' ? '🎤 Voice message'
      : mediaType === 'image' ? '📷 Image'
      : `📎 ${mediaName || 'File'}`;

    // SSE push
    if (toDeptId) {
      broadcastChatSSE(msg, [toDeptId]);
      await prisma.notification.create({
        data: {
          departmentId: toDeptId,
          content: `💬 ${msg.fromDept.name}: ${msgPreview}`,
          link: `?chat=dm:${myDeptId}`
        }
      }).catch(() => {});
      await sendPushNotification([toDeptId], {
        title: `Message from ${msg.fromDept.name}`,
        body: pushPreview,
        url: `/?chat=dm:${myDeptId}`
      });
    } else {
      // Group — push to all depts except sender
      broadcastChatSSE(msg, null);
      const allDepts = await prisma.department.findMany({ select: { id: true } });
      const otherIds = allDepts.map(d => d.id).filter(id => id !== myDeptId);
      for (const deptId of otherIds) {
        await prisma.notification.create({
          data: {
            departmentId: deptId,
            content: `📢 ${msg.fromDept.name} (All): ${msgPreview}`,
            link: '?chat=group'
          }
        }).catch(() => {});
      }
      await sendPushNotification(otherIds, {
        title: `${msg.fromDept.name} — All Departments`,
        body: pushPreview,
        url: '/?chat=group'
      });
    }

    res.json(msg);
  } catch (err) { sendError(res, 500, err.message); }
});

// POST /api/chat/upload — upload media (image / file / voice note) for chat
app.post('/api/chat/upload', authenticateToken, chatUpload.single('file'), async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    if (!myDeptId) return res.status(403).json({ error: 'Department account required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mime = req.file.mimetype;
    let mediaType = 'file';
    if (mime.startsWith('image/')) mediaType = 'image';
    else if (mime.startsWith('audio/') || mime === 'video/webm') mediaType = 'audio';
    const key = generateStorageKey('chat', req.file.originalname || `voice-${Date.now()}.webm`);
    await putObject({ key, body: req.file.buffer, contentType: mime });
    res.json({ key, name: req.file.originalname || 'voice-message.webm', type: mediaType, mime });
  } catch (err) { sendError(res, 500, err.message); }
});

// GET /api/chat/media?key=<storageKey>&download=1 — serve chat media with auth
app.get('/api/chat/media', authenticateToken, async (req, res) => {
  try {
    const key = req.query.key;
    if (!key || typeof key !== 'string' || !key.startsWith('chat/')) {
      return res.status(400).json({ error: 'Invalid media key' });
    }
    const download = req.query.download === '1';
    const ext = key.split('.').pop()?.toLowerCase() || '';
    const mimeMap = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
      wav: 'audio/wav', mp4: 'audio/mp4', pdf: 'application/pdf',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      txt: 'text/plain', csv: 'text/csv'
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const filename = key.split('/').pop();
    const stream = await getObjectStream(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
    stream.pipe(res);
  } catch (err) { sendError(res, 500, err.message); }
});

// POST /api/chat/read — mark messages as read
app.post('/api/chat/read', authenticateToken, async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    if (!myDeptId) return res.status(403).json({ error: 'Department account required' });
    const parsed = z.object({ messageIds: z.array(z.number().int()) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const { messageIds } = parsed.data;
    // Add myDeptId to readBy for each message (only if not already present)
    for (const id of messageIds) {
      await prisma.$executeRaw`
        UPDATE "ChatMessage"
        SET "readBy" = array_append("readBy", ${myDeptId})
        WHERE id = ${id} AND NOT (${myDeptId} = ANY("readBy"))
      `;
    }
    res.json({ success: true });
  } catch (err) { sendError(res, 500, err.message); }
});

// PATCH /api/chat/messages/:id — edit own text message
app.patch('/api/chat/messages/:id', authenticateToken, async (req, res) => {
  try {
    const myDeptId = toIntOrNull(req.user?.deptId);
    if (!myDeptId) return res.status(403).json({ error: 'Department account required' });
    const msgId = parseInt(req.params.id);
    if (isNaN(msgId)) return res.status(400).json({ error: 'Invalid message ID' });
    const parsed = z.object({ body: z.string().min(1).max(2000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const existing = await prisma.chatMessage.findUnique({ where: { id: msgId } });
    if (!existing) return res.status(404).json({ error: 'Message not found' });
    if (existing.fromDeptId !== myDeptId) return res.status(403).json({ error: 'Not your message' });
    if (existing.mediaKey) return res.status(400).json({ error: 'Cannot edit media messages' });

    const updated = await prisma.chatMessage.update({
      where: { id: msgId },
      data: { body: parsed.data.body, editedAt: new Date() },
      include: { fromDept: { select: { id: true, name: true } } }
    });

    // Broadcast edit to recipient(s) with _action flag so client distinguishes from new messages
    const targetIds = existing.toDeptId ? [existing.toDeptId] : null;
    broadcastChatSSE({ ...updated, _action: 'edit' }, targetIds);

    res.json(updated);
  } catch (err) { sendError(res, 500, err.message); }
});

// One-time migration: fix sub-account refCodes to use parentCode[subCode] format
app.post('/api/admin/fix-subaccount-refcodes', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const reqs = await prisma.requisition.findMany({
      where: { refCode: { not: null }, department: { type: 'Sub-Account' } },
      select: {
        id: true, refCode: true,
        department: { select: { id: true, name: true, code: true, parentId: true } },
      },
    });
    const parentCache = {};
    const results = [];
    for (const req of reqs) {
      const dept = req.department;
      if (!dept?.parentId) { results.push({ id: req.id, status: 'skipped', reason: 'no parentId' }); continue; }
      if (!parentCache[dept.parentId]) {
        parentCache[dept.parentId] = await prisma.department.findUnique({ where: { id: dept.parentId }, select: { name: true, code: true } });
      }
      const parent = parentCache[dept.parentId];
      if (!parent) { results.push({ id: req.id, status: 'skipped', reason: 'parent not found' }); continue; }
      const parentCode = parent.code || deriveCode(parent.name);
      const subCode    = dept.code   || deriveCode(dept.name);
      const parts = (req.refCode || '').split('/');
      if (parts.length < 5) { results.push({ id: req.id, status: 'skipped', reason: 'bad refCode format' }); continue; }
      if (parts[1].includes('[')) { results.push({ id: req.id, status: 'already_correct', old: req.refCode }); continue; }
      parts[1] = `${parentCode}[${subCode}]`;
      const newRefCode = parts.join('/');
      await prisma.requisition.update({ where: { id: req.id }, data: { refCode: newRefCode } });
      results.push({ id: req.id, status: 'updated', old: req.refCode, new: newRefCode });
    }
    const updated = results.filter(r => r.status === 'updated').length;
    const skipped = results.filter(r => r.status !== 'updated').length;
    res.json({ message: `Done. Updated: ${updated}, Skipped/already correct: ${skipped}`, results });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/requisition-types', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const parsed = z.object({
      name: z.string().min(1),
      description: z.string().optional()
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid type payload' });
    const { name, description } = parsed.data;
    const type = await prisma.requisitionType.create({ data: { name, description: description || '' } });
    res.json(type);
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/requisition-types/:id', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.requisitionType.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/departments', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const parsed = z.object({
      name: z.string().min(1),
      type: z.string().min(1),
      accessCode: z.string().min(4),
      headName:  z.string().optional(),
      headTitle: z.string().optional(),
      headEmail: z.string().email().optional().or(z.literal('')),
      phone:     z.string().optional(),
      staffId:   z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid department payload' });
    }
    const { name, type, accessCode, headName, headTitle, headEmail, phone, staffId } = parsed.data;
    const trimmedName = name.trim();
    const trimmedStaffId = staffId?.trim() ? staffId.trim().toUpperCase() : null;

    // Reject name clashes case-insensitively, regardless of Strategic/Operational type —
    // department names must be unique system-wide.
    const clash = await prisma.department.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } },
      select: { id: true, name: true }
    });
    if (clash) {
      return res.status(409).json({ error: `A department named "${clash.name}" already exists. Please choose a different name.` });
    }

    if (trimmedStaffId) {
      const staffClash = await prisma.department.findFirst({
        where: { staffId: { equals: trimmedStaffId, mode: 'insensitive' } },
        select: { id: true, staffId: true }
      });
      if (staffClash) {
        return res.status(409).json({ error: `Staff ID "${staffClash.staffId}" is already assigned to another department head. Please use a different Staff ID.` });
      }
    }

    const accessCodeHash = await bcrypt.hash(accessCode, 10);
    const dept = await prisma.department.create({
      data: {
        name: trimmedName, type,
        accessCode: null, accessCodeHash, accessCodeLabel: accessCode,
        headName:  headName?.trim()  || null,
        headTitle: headTitle?.trim() || null,
        headEmail: headEmail?.trim() || null,
        phone:     phone?.trim()     || null,
        staffId:   trimmedStaffId,
      }
    });
    const { accessCode: _ac, accessCodeHash: _ach, accessCodeLabel: _acl, codeChangedByDept: _ccbd, ...safeDept } = dept;

    // If the head's full contact details were provided at creation, send the same
    // "Account Activated" welcome email + SMS used when assigning a head via Edit —
    // fire-and-forget, never blocks the response.
    if (dept.headName && dept.headEmail && dept.phone) {
      setImmediate(async () => {
        const detailLines = [
          `Staff ID: ${dept.staffId || 'Not set'}`,
          `Name: ${dept.headName}`,
          `Position/Title: ${dept.headTitle || 'Not set'}`,
          `Department: ${dept.name}`,
          `Email: ${dept.headEmail}`,
          `Phone: ${dept.phone}`,
          `Access Code: ${accessCode}`,
        ];
        await prisma.notification.create({
          data: { departmentId: dept.id, content: 'Your department account is ready — check your email for your access code.' }
        }).catch(() => {});

        const subject = 'Account Activated — Welcome to RMS Portal';
        const { text, html } = buildEmailContent({
          title: subject,
          lines: [
            `Your department account has been activated on the RMS Portal by the RMS Administrator.`,
            ``,
            ...detailLines,
            ``,
            `Use this access code to log in for the first time. You will be asked to create your own password — once set, the access code no longer works and only your password will grant access to your dashboard.`,
          ],
          actionLabel: 'Open RMS Portal',
        });
        sendEmail({ to: dept.headEmail, subject, text, html }).catch(() => {});
        sendSms({
          to: dept.phone,
          message: `HELLO ${dept.headName}: Welcome to RMS portal, ${dept.name} department. Staff ID: ${dept.staffId || 'N/A'}. Access Code: ${accessCode}. Use the access code to login then create your personal password to access your dashboard.`,
        }).catch(() => {});

        if (SUPER_ADMIN_EMAIL) {
          try {
            const confirmSubject = `Confirmed: ${dept.name} Department Created`;
            const { text: ct, html: ch } = buildEmailContent({
              title: confirmSubject,
              lines: [
                `You successfully created the department "${dept.name}".`,
                ...detailLines,
                `An "Account Activated" email and SMS with the access code were sent to the head.`,
              ],
            });
            await sendEmail({ to: SUPER_ADMIN_EMAIL, subject: confirmSubject, text: ct, html: ch });
          } catch (e) { logger.warn('[MAIL] Super Admin confirmation failed:', e.message); }
        }
      });
    }

    res.json(safeDept);
  } catch (error) { sendError(res, 500, error.message); }
});

// Edit department info (Admin only)
app.put('/api/departments/:id', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, headName, headTitle, headEmail, phone, staffId } = req.body;
    if (!name?.trim()) return sendError(res, 400, 'Department name is required.');
    if (!staffId?.trim()) return sendError(res, 400, 'Staff ID is required.');
    if (!headName?.trim()) return sendError(res, 400, 'Head official name is required.');
    if (!headTitle?.trim()) return sendError(res, 400, 'Head official designation/title is required — the dashboard treats a profile without one as incomplete and will keep prompting the department to set it.');
    if (!headEmail?.trim()) return sendError(res, 400, 'Head official email is required.');
    if (!phone?.trim()) return sendError(res, 400, 'Contact phone is required — used to SMS the access code.');

    // Reject name clashes case-insensitively (excluding this department itself),
    // regardless of Strategic/Operational type — names must be unique system-wide.
    const trimmedName = name.trim();
    const clash = await prisma.department.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' }, id: { not: parseInt(id) } },
      select: { id: true, name: true }
    });
    if (clash) {
      return res.status(409).json({ error: `A department named "${clash.name}" already exists. Please choose a different name.` });
    }

    const trimmedStaffId = staffId.trim().toUpperCase();
    const staffClash = await prisma.department.findFirst({
      where: { staffId: { equals: trimmedStaffId, mode: 'insensitive' }, id: { not: parseInt(id) } },
      select: { id: true, staffId: true }
    });
    if (staffClash) {
      return res.status(409).json({ error: `Staff ID "${staffClash.staffId}" is already assigned to another department head. Please use a different Staff ID.` });
    }

    // Snapshot BEFORE the update — codeChangedByDept tells us whether this head has
    // ever activated their account (set their own password) yet.
    const before = await prisma.department.findUnique({
      where: { id: parseInt(id) },
      select: { codeChangedByDept: true, accessCodeLabel: true, accessCode: true }
    });

    const updated = await prisma.department.update({
      where: { id: parseInt(id) },
      data: {
        name: name.trim(),
        ...(type ? { type } : {}),
        headName: headName ?? null,
        headTitle: headTitle ?? null,
        headEmail: headEmail ?? null,
        phone: phone ?? null,
        staffId: trimmedStaffId
      }
    });
    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Department Updated',
        details: `Admin updated info for ${updated.name}`
      }
    });

    // Notify both sides of the change — fire-and-forget, never blocks the response
    setImmediate(async () => {
      // Not yet activated = head has never set their own password — the original
      // admin-set access code is still valid, so this really is a "welcome" moment.
      const isFreshAssignment = !before?.codeChangedByDept;
      const accessCode = before?.accessCodeLabel || before?.accessCode || null;

      await prisma.notification.create({
        data: {
          departmentId: updated.id,
          content: isFreshAssignment
            ? `Your department account is ready — check your email for your access code.`
            : `Your department profile was updated.`,
        }
      }).catch(() => {});

      if (isFreshAssignment && accessCode) {
        const subject = 'Account Activated — Welcome to RMS Portal';
        const { text, html } = buildEmailContent({
          title: subject,
          lines: [
            `Your department account has been activated on the RMS Portal by the RMS Administrator.`,
            ``,
            `Staff ID: ${updated.staffId || 'Not set'}`,
            `Name: ${updated.headName}`,
            `Position/Title: ${updated.headTitle || 'Not set'}`,
            `Department: ${updated.name}`,
            `Email: ${updated.headEmail}`,
            `Phone: ${updated.phone}`,
            `Access Code: ${accessCode}`,
            ``,
            `Use this access code to log in for the first time. You will be asked to create your own password — once set, the access code no longer works and only your password will grant access to your dashboard.`,
          ],
          actionLabel: 'Open RMS Portal',
        });
        sendEmail({ to: updated.headEmail, subject, text, html }).catch(() => {});
        sendSms({
          to: updated.phone,
          message: `HELLO ${updated.headName}: Welcome to RMS portal, ${updated.name} department. Staff ID: ${updated.staffId || 'N/A'}. Access Code: ${accessCode}. Use the access code to login then create your personal password to access your dashboard.`,
        }).catch(() => {});
      } else {
        const subject = 'Your Department Profile Was Updated';
        const { text, html } = buildEmailContent({
          title: subject,
          lines: [
            `The RMS Administrator has updated your department's official profile.`,
            ``,
            `Staff ID: ${updated.staffId || 'Not set'}`,
            `Name: ${updated.headName || 'Not set'}`,
            `Position/Title: ${updated.headTitle || 'Not set'}`,
            `Department: ${updated.name}`,
            `Email: ${updated.headEmail || 'Not set'}`,
            `Phone: ${updated.phone || 'Not set'}`,
          ],
          actionLabel: 'Open RMS Portal',
        });
        sendEmail({ to: updated.headEmail, subject, text, html }).catch(() => {});
      }

      // Confirm to Super Admin — direct email, since they have no department inbox
      if (SUPER_ADMIN_EMAIL) {
        try {
          const subject = `Confirmed: ${updated.name} Department Profile Saved`;
          const { text, html } = buildEmailContent({
            title: subject,
            lines: [
              `You successfully updated the department profile for ${updated.name}.`,
              `Department: ${updated.name}`,
              `Staff ID: ${updated.staffId || 'Not set'}`,
              `Head Name: ${updated.headName || 'Not set'}`,
              `Position/Title: ${updated.headTitle || 'Not set'}`,
              `Email: ${updated.headEmail || 'Not set'}`,
              `Phone: ${updated.phone || 'Not set'}`,
              isFreshAssignment
                ? `An "Account Activated" email and SMS with the access code were sent to the head.`
                : `A profile-update notice was emailed to the head (no access code — account already active).`,
            ],
          });
          await sendEmail({ to: SUPER_ADMIN_EMAIL, subject, text, html });
        } catch (e) { logger.warn('[MAIL] Super Admin confirmation failed:', e.message); }
      }
    });

    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/departments/:id', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.department.delete({ where: { id: parseInt(id) } });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Succession — auto-elevate / revert the acting-head candidate ────────────────
// Triggered whenever a main department's login is suspended or restored. The successor
// is computed dynamically as the most senior (lowest seniorityRank) sub-account that is
// NOT itself disabled — never a fixed person — so if the most senior one is also
// suspended, it naturally cascades down to the next-most-senior active sub-account.
async function elevateActingHeadCandidate(parentId) {
  const candidate = await prisma.department.findFirst({
    where: { parentId, isSubAccount: true, isDeleted: false, isDisabled: false },
    orderBy: [{ seniorityRank: 'asc' }, { createdAt: 'asc' }],
  });
  if (!candidate) return null; // nobody active to elevate
  const snapshot = JSON.stringify({
    privilegeAmount: candidate.privilegeAmount, approvalLimit: candidate.approvalLimit,
    directRoute: candidate.directRoute, cashPrivilege: candidate.cashPrivilege,
    memoPrivilege: candidate.memoPrivilege, materialPrivilege: candidate.materialPrivilege,
  });
  const elevated = await prisma.department.update({
    where: { id: candidate.id },
    data: {
      isActingHeadCandidate: true,
      preElevationPrivileges: snapshot,
      approvalLimit: null, // null = no ceiling, full authority
      directRoute: true, cashPrivilege: true, memoPrivilege: true, materialPrivilege: true,
    }
  });
  return elevated;
}

async function revertActingHeadCandidate(parentId) {
  // Find whoever is CURRENTLY elevated — not necessarily the most senior anymore, since
  // seniority could have been reordered, or the cascade picked someone further down.
  const candidate = await prisma.department.findFirst({
    where: { parentId, isSubAccount: true, isActingHeadCandidate: true, isDeleted: false, preElevationPrivileges: { not: null } }
  });
  if (!candidate) return null;
  let prior = {};
  try { prior = JSON.parse(candidate.preElevationPrivileges); } catch (_) {}
  return prisma.department.update({
    where: { id: candidate.id },
    data: { ...prior, preElevationPrivileges: null, isActingHeadCandidate: false }
  });
}

// Suspend or restore a main department's own login (separate from deleting it).
// Suspending auto-elevates the designated successor sub-account (if one was set during
// batch upload); restoring reverts that successor back to their normal privileges.
app.patch('/api/departments/:id/toggle-disable', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const deptId = parseInt(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id: deptId } });
    if (!dept) return res.status(404).json({ error: 'Department not found.' });
    if (dept.isSubAccount) return res.status(400).json({ error: 'Use the sub-account toggle endpoint for sub-accounts.' });

    const nextDisabled = !dept.isDisabled;
    const updated = await prisma.department.update({ where: { id: deptId }, data: { isDisabled: nextDisabled } });

    let successionNote = null;
    if (nextDisabled) {
      const elevated = await elevateActingHeadCandidate(deptId);
      if (elevated) successionNote = `${elevated.name} has been granted full approval authority while ${dept.name}'s head is suspended.`;
    } else {
      const reverted = await revertActingHeadCandidate(deptId);
      if (reverted) successionNote = `${reverted.name}'s privileges have been restored to normal now that ${dept.name}'s head is reactivated.`;
    }

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: nextDisabled ? 'Department Suspended' : 'Department Reactivated',
        details: `${dept.name} ${nextDisabled ? 'suspended' : 'reactivated'} by ${req.user.name || 'Admin'}.${successionNote ? ' ' + successionNote : ''}`
      }
    });

    res.json({ id: updated.id, isDisabled: updated.isDisabled, successionNote });
  } catch (error) { sendError(res, 500, error.message); }
});

app.put('/api/departments/:id/head', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const deptId = parseInt(id);
    if (req.user.role === 'department' && req.user.deptId && req.user.deptId !== deptId) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    const parsed = z.object({
      headName: z.string().min(2),
      headTitle: z.string().min(2),
      headEmail: z.string().email(),
      password: z.string().min(6).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid department head payload' });
    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { name: true, isSubAccount: true } });
    const updateData = {
      headName: parsed.data.headName,
      headTitle: parsed.data.headTitle,
      headEmail: parsed.data.headEmail,
    };
    if (parsed.data.password && !dept?.isSubAccount) {
      updateData.accessCodeHash = await bcrypt.hash(parsed.data.password, 10);
      updateData.codeChangedByDept = true;
    }
    const updated = await prisma.department.update({ where: { id: deptId }, data: updateData });
    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Department Head Updated',
        details: `Head info updated for ${updated.name} by ${req.user.name || 'user'}: ${parsed.data.headName} (${parsed.data.headTitle})`
      }
    });
    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

// Access Code Reset (Admin only)
app.put('/api/departments/:id/access-code', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = z.object({ accessCode: z.string().min(4) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Access code must be at least 4 characters' });
    const accessCodeHash = await bcrypt.hash(parsed.data.accessCode, 10);
    const updated = await prisma.department.update({
      where: { id: parseInt(id) },
      data: { accessCodeHash, accessCodeLabel: parsed.data.accessCode, codeChangedByDept: false }
    });
    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Access Code Reset',
        details: `Access code reset for department: ${updated.name}`
      }
    });
    res.json({ success: true, department: updated.name });
  } catch (error) { sendError(res, 500, error.message); }
});

// Full Security Reset (Admin only) — distinct from the manual access-code reset above:
// auto-generates a fresh access code (admin doesn't type one), force-logs-out every active
// session on every device via a tokenVersion bump, and notifies the department by SMS +
// email with the new code. Intended for "this account may be compromised" situations.
app.post('/api/departments/:id/security-reset', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const deptId = parseInt(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id: deptId } });
    if (!dept) return res.status(404).json({ error: 'Department not found.' });

    // Restore the department's original/default code rather than inventing a new one.
    // Priority: accessCodeLabel (the original admin-set code, preserved through the
    // dept head's own activation — see the same pattern used by the bulk hard-reset
    // above) > legacy plain-text accessCode (predates the label column) > the four
    // departments with a fixed env-configured default (GM/CEO/ICC/Audit) as a last-
    // resort safety net > a freshly generated random code if none of the above exist.
    const restoredCode = dept.accessCodeLabel || dept.accessCode || getFixedDefaultAccessCode(dept.name, process.env);
    const newCode = restoredCode || await generateUniqueAccessCode(dept.name);
    const accessCodeHash = await bcrypt.hash(newCode, 10);

    const updated = await prisma.department.update({
      where: { id: deptId },
      data: {
        accessCodeHash,
        accessCodeLabel: newCode,
        codeChangedByDept: false,
        tokenVersion: { increment: 1 },
      }
    });

    const subject = `[RMS] Security Reset — ${updated.name}`;
    const lines = [
      `Your CSS RMS account password has been reset by the system administrator for security reasons.`,
      `You have been logged out of every device you were signed in on.`,
      ``,
      restoredCode ? `Your access code has been restored: ${newCode}` : `Your new access code: ${newCode}`,
      ``,
      `Use this access code to log in, then create a new personal password.`,
      ``,
      `If you did not expect this reset, contact the ICT Department immediately.`
    ];
    const { text, html } = buildEmailContent({ title: subject, lines, actionLabel: 'Open RMS Portal' });

    if (updated.headEmail) {
      sendEmail({ to: updated.headEmail, subject, text, html }).catch(() => {});
    }
    if (updated.phone) {
      sendSms({
        to: updated.phone,
        message: `CSS RMS SECURITY ALERT: Your account password was reset by the administrator and you've been logged out on all devices. ${restoredCode ? `Access code restored: ${newCode}` : `New access code: ${newCode}`}. Use it to log in, then set a new password.`
      }).catch(() => {});
    }

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Department Security Reset',
        details: `Security reset performed on ${updated.name} by ${req.user.name || 'admin'}: password reset, access code reactivated, all sessions force-logged-out, notified by SMS/email.`
      }
    });

    res.json({ success: true, department: updated.name });
  } catch (error) { sendError(res, 500, error.message); }
});

// Department self-service access code change
app.put('/api/department/access-code', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'department' || !req.user.deptId)
      return sendError(res, 403, 'Only department accounts can change their password.');
    const { currentCode, newCode, confirmCode } = req.body;
    if (!currentCode || !newCode) return sendError(res, 400, 'Both current and new codes are required.');
    if (newCode !== confirmCode) return sendError(res, 400, 'New codes do not match. Please re-enter.');
    if (newCode.trim().length < 4) return sendError(res, 400, 'New password must be at least 4 characters.');
    const dept = await prisma.department.findUnique({ where: { id: req.user.deptId } });
    if (!dept) return sendError(res, 404, 'Department not found.');
    const valid = dept.accessCodeHash
      ? await bcrypt.compare(currentCode.trim(), dept.accessCodeHash)
      : dept.accessCode === currentCode.trim();
    if (!valid) return sendError(res, 401, 'The current password you entered is incorrect.');
    const newHash = await bcrypt.hash(newCode.trim(), 10);
    await prisma.department.update({
      where: { id: req.user.deptId },
      data: { accessCodeHash: newHash, accessCodeLabel: newCode.trim(), codeChangedByDept: true }
    });
    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Access Code Changed',
        details: `${dept.name} changed their own access code`
      }
    });

    // Email only the account that changed its own password (use headEmail of the dept)
    if (dept.headEmail && !dept.headEmail.endsWith('@cssgroup.local')) {
      const { text, html } = buildEmailContent({
        title: `Password Changed — ${dept.name}`,
        lines: [
          `Your login password has been successfully changed.`,
          `Account: ${dept.name}`,
          `Changed on: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
          ``,
          `If you did not make this change, contact your system administrator immediately.`
        ]
      });
      sendEmail({ to: dept.headEmail, subject: `[RMS] Password Changed — ${dept.name}`, text, html }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// Department Stamp Upload (Admin only)
app.post('/api/departments/:id/stamp', authenticateToken, requireRoles(['global_admin']), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No stamp uploaded' });
    const storageKey = generateStorageKey(`stamps/department-${id}`, req.file.originalname);
    await putObject({ key: storageKey, body: req.file.buffer, contentType: req.file.mimetype });
    const stamp = await prisma.departmentStamp.upsert({
      where: { departmentId: parseInt(id) },
      update: { imageKey: storageKey },
      create: { departmentId: parseInt(id), imageKey: storageKey }
    });
    res.json(stamp);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Sub-Account Management (Dept Head OR Super Admin) ────────────────────────
const requireSubAccountManager = (req, res, next) => {
  const role = normalizeRole(req.user?.role);
  if (role === 'global_admin') return next();
  if (role === 'department' && !req.user?.isSubAccount) return next();
  return res.status(403).json({ error: 'Only department heads or super admins can manage sub-accounts.' });
};

// Super Admin can globally disable department heads from creating/managing sub-accounts
// (create, rename, reset code, enable/disable, delete, assign users). Heads can still
// always VIEW their sub-account list — this only blocks mutating actions. Admin is never blocked.
const checkHeadCanManageSubaccounts = async (req, res, next) => {
  if (normalizeRole(req.user?.role) === 'global_admin') return next();
  try {
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'heads_can_manage_subaccounts' LIMIT 1`;
    const enabled = (rows?.[0]?.value ?? 'true') !== 'false';
    if (!enabled) return res.status(403).json({ error: 'Super Admin has disabled department heads from managing sub-accounts. Contact Super Admin.' });
  } catch (_) {}
  next();
};

// Super Admin can globally disable department heads from configuring sub-account
// privilege settings (cash/memo/material toggles, limits, direct routing). Admin is never blocked.
const checkHeadCanSetSubPrivileges = async (req, res, next) => {
  if (normalizeRole(req.user?.role) === 'global_admin') return next();
  try {
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'heads_can_set_subaccount_privileges' LIMIT 1`;
    const enabled = (rows?.[0]?.value ?? 'true') !== 'false';
    if (!enabled) return res.status(403).json({ error: 'Super Admin has disabled department heads from setting sub-account privileges. Contact Super Admin.' });
  } catch (_) {}
  next();
};

// Resolve parentId: dept heads use their own deptId; admins pass parentId in query/body
const resolveParentId = (req) => {
  const role = normalizeRole(req.user?.role);
  if (role === 'global_admin') {
    const pid = parseInt(req.query.parentId || req.body?.parentId);
    return isNaN(pid) ? null : pid;
  }
  return parseInt(req.user.deptId);
};

// Pattern: first 2 letters of name (uppercase) + 4 random digits (6 chars total), unique
// across all dept accessCodeLabels
const generateUniqueAccessCode = async (name) => {
  const prefix = (name || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase().padEnd(2, 'X');
  for (let i = 0; i < 50; i++) {
    const digits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const code = prefix + digits;
    const clash = await prisma.department.findFirst({ where: { accessCodeLabel: code } });
    if (!clash) return code;
  }
  // Extremely unlikely fallback if all 10,000 combos are taken
  return prefix + String(Math.floor(Math.random() * 900000) + 100000);
};

// List ALL sub-accounts across all depts (admin only) OR for a specific parent
app.get('/api/sub-accounts', authenticateToken, requireSubAccountManager, async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const parentId = resolveParentId(req);
    // Admin with no parentId gets ALL sub-accounts across every dept
    const where = (role === 'global_admin' && !parentId)
      ? { isSubAccount: true, isDeleted: false }
      : { parentId: parentId || -1, isSubAccount: true, isDeleted: false };
    const subs = await prisma.department.findMany({
      where,
      include: {
        users: { select: { id: true, name: true, email: true } },
        parent: { select: { id: true, name: true } },
        _count: { select: { requisitions: true } }
      },
      orderBy: [{ seniorityRank: 'asc' }, { createdAt: 'asc' }]
    });
    const isAdmin = role === 'global_admin';
    res.json(subs.map(s => ({
      id: s.id, name: s.name, staffId: s.staffId || null,
      headName: s.headName, headEmail: s.headEmail,
      headTitle: s.headTitle, isDisabled: s.isDisabled, createdAt: s.createdAt,
      seniorityRank: s.seniorityRank ?? null, isActingHeadCandidate: s.isActingHeadCandidate ?? false,
      codeChangedByDept: s.codeChangedByDept ?? false,
      userCount: s.users.length, users: s.users, reqCount: s._count.requisitions,
      // Only admins see the stored plain-text code (permanent reference); dept heads get it only on reset
      ...(isAdmin ? { accessCodeLabel: s.accessCodeLabel } : {}),
      parentDept: s.parent ? { id: s.parent.id, name: s.parent.name } : null,
      privilegeAmount:     s.privilegeAmount     ?? null,
      cashPrivilege:       s.cashPrivilege       ?? false,
      memoPrivilege:       s.memoPrivilege       ?? false,
      materialPrivilege:   s.materialPrivilege   ?? false,
      directRoute:         s.directRoute         ?? false,
      allowedRouteDeptIds: (() => { try { return JSON.parse(s.allowedRouteDeptIds || 'null') || []; } catch { return []; } })(),
    })));
  } catch (err) { sendError(res, 500, err.message); }
});

// Create a sub-account
app.post('/api/sub-accounts', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const parsed = z.object({
      name:      z.string().min(2),
      staffId:   z.string().min(1),
      parentId:  z.number().int().optional(),
      headName:  z.string().optional(),
      headTitle: z.string().optional(),
      headEmail: z.string().email(),
      phone:     z.string().min(1),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Name, Staff ID, Email, and Phone are all required to create a sub-account.' });
    const parentId = resolveParentId(req);
    if (!parentId) return res.status(400).json({ error: 'parentId is required for admin requests.' });
    const parent = await prisma.department.findUnique({ where: { id: parentId } });
    if (!parent) return res.status(404).json({ error: 'Parent department not found.' });
    const { name, staffId: staffIdRaw } = parsed.data;
    const staffId = staffIdRaw.trim().toUpperCase();

    // ── 1. Staff ID conflict (primary identifier) ─────────────────────────
    {
      // Ensure staffId column exists (may not exist in older DB yet)
      try { await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "staffId" TEXT`; } catch (_) {}
      try { await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "Department_staffId_key" ON "Department"("staffId") WHERE "staffId" IS NOT NULL`; } catch (_) {}
      const staffIdRows = await prisma.$queryRaw`SELECT id, name, "isDeleted", "parentId", "headName", "createdAt", "staffId" FROM "Department" WHERE "staffId" = ${staffId} AND "isSubAccount" = true LIMIT 1`;
      const staffIdMatch = staffIdRows?.[0];
      if (staffIdMatch) {
        if (staffIdMatch.isDeleted && parseInt(staffIdMatch.parentId) === parentId) {
          return res.status(409).json({
            conflict: 'deleted',
            deletedSub: { id: staffIdMatch.id, name: staffIdMatch.name, staffId: staffIdMatch.staffId, headName: staffIdMatch.headName, createdAt: staffIdMatch.createdAt },
          });
        }
        return res.status(409).json({ error: `Staff ID "${staffId}" is already assigned to "${staffIdMatch.name}".` });
      }
    }

    // ── 2. Name uniqueness check (still required for login lookup) ────────
    const existing = await prisma.department.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } });
    if (existing) {
      // Deleted sub-account with same name but different person → suggest a renamed version
      if (existing.isDeleted && existing.isSubAccount && existing.parentId === parentId) {
        let suggestedName = null;
        for (let n = 2; n <= 20; n++) {
          const candidate = `${name.trim()} (${n})`;
          const clash = await prisma.department.findFirst({ where: { name: { equals: candidate, mode: 'insensitive' } } });
          if (!clash) { suggestedName = candidate; break; }
        }
        return res.status(409).json({ conflict: 'name_taken', suggestedName, error: `The name "${name.trim()}" is taken by a deleted record. Try "${suggestedName || name.trim() + ' (2)'}" instead.` });
      }
      return res.status(409).json({ error: 'A department or sub-account with that name already exists.' });
    }
    const plainCode = await generateUniqueAccessCode(name.trim());
    const hash = await bcrypt.hash(plainCode, 10);
    const { headName: hName, headTitle: hTitle, headEmail: hEmail, phone: hPhone } = parsed.data;
    // New sub-accounts join the bottom of the seniority list by default — freely
    // re-orderable afterward via the move-up/move-down endpoint.
    const maxRank = await prisma.department.aggregate({
      where: { parentId, isSubAccount: true, isDeleted: false },
      _max: { seniorityRank: true },
    });
    const sub = await prisma.department.create({
      data: {
        name: name.trim(), type: 'Sub-Account',
        isSubAccount: true, parentId, createdByDeptId: parentId,
        accessCodeHash: hash, accessCodeLabel: plainCode,
        staffId, headEmail: hEmail.trim(), phone: hPhone.trim(),
        seniorityRank: (maxRank._max.seniorityRank || 0) + 1,
        ...(hName  ? { headName:  hName.trim()  } : {}),
        ...(hTitle ? { headTitle: hTitle.trim() } : {}),
      }
    });
    await prisma.activityLog.create({ data: { action: 'Sub-Account Created', details: `${name.trim()} created under ${parent.name}` } });

    // Email parent dept head and sub-account (if email provided) with creation details
    const createdBy = req.user?.name || req.user?.email || 'Administrator';
    const createdDate = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
    const subEmailAddr = hEmail?.trim();

    // — Email to PARENT HEAD —
    if (parent.headEmail && !parent.headEmail.endsWith('@cssgroup.local')) {
      const { text, html } = buildEmailContent({
        title: `✅ Sub-Account Successfully Created — ${name.trim()}`,
        lines: [
          `A new sub-account has been successfully created under your department.`,
          ``,
          `Unit Name: ${name.trim()}`,
          `Parent Department: ${parent.name}`,
          `Staff ID: ${staffId}`,
          ...(hName?.trim()  ? [`Full Name: ${hName.trim()}`]           : []),
          ...(hTitle?.trim() ? [`Position / Title: ${hTitle.trim()}`]   : []),
          ...(subEmailAddr   ? [`Unit Email: ${subEmailAddr}`]           : []),
          `Phone: ${hPhone.trim()}`,
          ``,
          `ACCESS CODE: ${plainCode}`,
          ``,
          `Created by: ${createdBy}`,
          `Date: ${createdDate}`,
          ``,
          `IMPORTANT: This Access Code is for first-time login only. When the unit member logs in for the first time, they will be prompted to create their own personal password which will replace this code.`,
          ``,
          `Please share this Access Code securely with the unit staff.`
        ],
        actionLabel: 'Open RMS Portal'
      });
      sendEmail({ to: parent.headEmail, subject: `[RMS] ✅ Sub-Account Created — ${name.trim()}`, text, html }).catch(() => {});
    }

    // — Welcome email to SUB-ACCOUNT —
    if (subEmailAddr && !subEmailAddr.endsWith('@cssgroup.local') && subEmailAddr !== parent.headEmail) {
      const { text, html } = buildEmailContent({
        title: `Welcome to CSS Group RMS — ${name.trim()}`,
        lines: [
          `Welcome! Your sub-account has been set up on the CSS Group Requisition Management System (RMS).`,
          ``,
          `Account Name: ${name.trim()}`,
          `Parent Department: ${parent.name}`,
          `Staff ID: ${staffId}`,
          ...(hTitle?.trim() ? [`Position / Title: ${hTitle.trim()}`] : []),
          `Date Created: ${createdDate}`,
          ``,
          `YOUR ACCESS CODE: ${plainCode}`,
          ``,
          `IMPORTANT: This Access Code is for first-time login only. When you log in for the first time, you will be asked to create your own personal password. Keep this code safe until you complete your first login.`,
          ``,
          `To log in: visit the RMS portal, select "${parent.name}" from the department list, then enter the Access Code above.`,
          ``,
          `If you did not expect this message or need help, contact your department head (${parent.name}).`
        ],
        actionLabel: 'Log In to RMS Portal'
      });
      sendEmail({ to: subEmailAddr, subject: `[RMS] Welcome — Your Sub-Account Access Code: ${name.trim()}`, text, html }).catch(() => {});
    }

    // — Welcome SMS to SUB-ACCOUNT — phone is now required, always send
    sendSms({
      to: hPhone.trim(),
      message: `CSS RMS: Your sub-account "${name.trim()}" under ${parent.name} is ready. Staff ID: ${staffId}. Access Code: ${plainCode}. Log in then create your password. - RMS Administrator`,
    }).catch(() => {});

    res.json({ id: sub.id, name: sub.name, staffId: sub.staffId || null, accessCode: plainCode, isDisabled: false, userCount: 0, reqCount: 0, parentDept: { id: parent.id, name: parent.name } });
  } catch (err) { sendError(res, 500, err.message); }
});

// ── Batch upload — create many sub-accounts (or assign a head) from one CSV/Excel file ──
// File rows, top to bottom, encode seniority:
//   - If the parent department has no head yet, row 1 becomes the department's head
//     directly (fills headName/headTitle/headEmail/phone/staffId + generates its access
//     code) and rows 2..N become ordinary sub-accounts.
//   - If the parent department already has a head, every row becomes a sub-account, each
//     assigned a seniorityRank continuing the upload's top-to-bottom order. Whoever ends up
//     most senior (and still active) is who inherits full authority if the head is ever
//     suspended — recomputed live, not fixed at upload time, and freely re-orderable after
//     the fact via the move-up/move-down endpoint.
// Validation is all-or-nothing: any invalid/duplicate row rejects the whole file with a
// precise per-row reason — nothing is created until every row passes.
const BATCH_UPLOAD_COLUMNS = ['Staff ID', 'Surname', 'First Name', 'Other Name', 'Title', 'Email', 'Phone'];

function parseBatchUploadFile(buffer, originalName) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    throw Object.assign(new Error(`Could not read "${originalName}" — make sure it's a valid CSV or Excel file.`), { status: 400 });
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw Object.assign(new Error('The uploaded file has no sheets/data.'), { status: 400 });
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length) throw Object.assign(new Error('The uploaded file has no data rows below the header.'), { status: 400 });
  return rows;
}

function normalizeBatchRow(row, idx) {
  // Tolerant header matching — accepts "Staff ID", "staff id", "StaffID", etc.
  const get = (label) => {
    const key = Object.keys(row).find(k => k.replace(/[\s_-]+/g, '').toLowerCase() === label.replace(/[\s_-]+/g, '').toLowerCase());
    return key ? String(row[key] ?? '').trim() : '';
  };
  return {
    rowNum: idx + 2, // +2: 1-indexed plus the header row itself
    staffId: get('Staff ID').toUpperCase(),
    surname: get('Surname'),
    firstName: get('First Name'),
    otherName: get('Other Name'),
    title: get('Title'),
    email: get('Email'),
    phone: get('Phone'),
  };
}

function validateBatchRows(rawRows) {
  const rows = rawRows.map(normalizeBatchRow);
  const errors = [];
  const seenStaffIds = new Map();
  const seenEmails = new Map();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  rows.forEach(r => {
    const label = `Row ${r.rowNum}`;
    if (!r.staffId) errors.push(`${label}: Staff ID is required.`);
    if (!r.surname) errors.push(`${label}: Surname is required.`);
    if (!r.firstName) errors.push(`${label}: First Name is required.`);
    if (!r.email) errors.push(`${label}: Email is required.`);
    else if (!emailRe.test(r.email)) errors.push(`${label}: "${r.email}" is not a valid email address.`);
    if (!r.phone) errors.push(`${label}: Phone is required.`);

    if (r.staffId) {
      if (seenStaffIds.has(r.staffId)) errors.push(`${label}: Staff ID "${r.staffId}" is duplicated within this file (also on Row ${seenStaffIds.get(r.staffId)}).`);
      else seenStaffIds.set(r.staffId, r.rowNum);
    }
    if (r.email) {
      const emailKey = r.email.toLowerCase();
      if (seenEmails.has(emailKey)) errors.push(`${label}: Email "${r.email}" is duplicated within this file (also on Row ${seenEmails.get(emailKey)}).`);
      else seenEmails.set(emailKey, r.rowNum);
    }
  });

  return { rows, errors };
}

app.post('/api/sub-accounts/batch-upload', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, batchUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded. Please attach a .csv, .xlsx, or .xls file.' });

    const parentId = resolveParentId(req);
    if (!parentId) return res.status(400).json({ error: 'Select a department before uploading.' });
    const parent = await prisma.department.findUnique({ where: { id: parentId } });
    if (!parent) return res.status(404).json({ error: 'Parent department not found.' });
    if (parent.isSubAccount) return res.status(400).json({ error: 'Batch upload must target a main department, not a sub-account.' });

    let rawRows;
    try {
      rawRows = parseBatchUploadFile(req.file.buffer, req.file.originalname);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    const { rows, errors: rowErrors } = validateBatchRows(rawRows);

    // ── Cross-check against the database — same all-or-nothing rule ──────────
    const dbErrors = [];
    try {
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "staffId" TEXT`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "Department_staffId_key" ON "Department"("staffId") WHERE "staffId" IS NOT NULL`;
    } catch (_) { /* columns/index already exist */ }

    for (const r of rows) {
      if (!r.staffId) continue; // already reported as missing above
      const staffIdClash = await prisma.department.findFirst({ where: { staffId: r.staffId, isDeleted: false }, select: { id: true, name: true } });
      if (staffIdClash) dbErrors.push(`Row ${r.rowNum}: Staff ID "${r.staffId}" is already assigned to "${staffIdClash.name}".`);
      const fullName = [r.surname, r.firstName, r.otherName].filter(Boolean).join(' ');
      const nameClash = await prisma.department.findFirst({ where: { name: { equals: fullName, mode: 'insensitive' } }, select: { id: true } });
      if (nameClash) dbErrors.push(`Row ${r.rowNum}: A department or sub-account named "${fullName}" already exists.`);
    }

    const allErrors = [...rowErrors, ...dbErrors];
    if (allErrors.length > 0) {
      return res.status(400).json({
        error: `${allErrors.length} issue(s) found — nothing was created. Fix the file and try again.`,
        issues: allErrors,
      });
    }

    // ── All rows valid — determine Case A (assign head) vs Case B (all sub-accounts) ──
    const hasHeadAlready = !!(parent.headName && parent.headEmail);
    const createdBy = req.user?.name || req.user?.email || 'Administrator';
    const createdDate = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
    const results = { headAssigned: null, created: [], mostSenior: null };

    let subAccountRows = rows;
    if (!hasHeadAlready) {
      const headRow = rows[0];
      subAccountRows = rows.slice(1);
      const headFullName = [headRow.surname, headRow.firstName, headRow.otherName].filter(Boolean).join(' ');
      // The department already has its own login code from creation (e.g. "AUDIT-2026"),
      // even though no head's personal details were filled in yet. Batch upload should only
      // attach the head's identity to that existing code, never silently replace it — only
      // generate a fresh one if the department truly never had one set.
      const existingCode = parent.accessCodeLabel || parent.accessCode;
      let headAccessCode = existingCode;
      const updateData = {
        headName: headFullName, headTitle: headRow.title || null, headEmail: headRow.email,
        phone: headRow.phone, staffId: headRow.staffId,
      };
      if (!existingCode) {
        headAccessCode = await generateUniqueAccessCode(parent.name);
        updateData.accessCodeHash = await bcrypt.hash(headAccessCode, 10);
        updateData.accessCodeLabel = headAccessCode;
        updateData.accessCode = null;
      }
      const updatedParent = await prisma.department.update({ where: { id: parent.id }, data: updateData });
      results.headAssigned = { name: headFullName, staffId: headRow.staffId, email: headRow.email, accessCode: headAccessCode };

      setImmediate(async () => {
        const lines = [
          `Your department account has been activated on the RMS Portal via a batch staff upload by the RMS Administrator.`,
          ``,
          `Staff ID: ${headRow.staffId}`,
          `Name: ${headFullName}`,
          `Position/Title: ${headRow.title || 'Not set'}`,
          `Department: ${parent.name}`,
          `Email: ${headRow.email}`,
          `Phone: ${headRow.phone}`,
          `Access Code: ${headAccessCode}`,
          ``,
          `Use this access code to log in for the first time. You will be asked to create your own password — once set, the access code no longer works.`,
        ];
        const { text, html } = buildEmailContent({ title: 'Account Activated — Welcome to RMS Portal', lines, actionLabel: 'Open RMS Portal' });
        sendEmail({ to: headRow.email, subject: '[RMS] Account Activated — Welcome to RMS Portal', text, html }).catch(() => {});
        sendSms({ to: headRow.phone, message: `HELLO ${headFullName}: Welcome to RMS portal, ${parent.name} department. Staff ID: ${headRow.staffId}. Access Code: ${headAccessCode}. Use the access code to login then create your personal password to access your dashboard.` })
          .catch(e => logger.error(`[BATCH-UPLOAD] SMS failed for head ${headFullName} (${headRow.phone}):`, e.message));
      });
    }

    // New sub-accounts are appended after whatever seniority ranks already exist under
    // this parent, preserving the upload's top-to-bottom order as the new tail of the list.
    const existingMaxRank = await prisma.department.aggregate({
      where: { parentId: parent.id, isSubAccount: true, isDeleted: false },
      _max: { seniorityRank: true },
    });
    let nextRank = (existingMaxRank._max.seniorityRank || 0) + 1;

    for (let i = 0; i < subAccountRows.length; i++) {
      const r = subAccountRows[i];
      const fullName = [r.surname, r.firstName, r.otherName].filter(Boolean).join(' ');
      const plainCode = await generateUniqueAccessCode(fullName);
      const hash = await bcrypt.hash(plainCode, 10);
      const rank = nextRank++;
      const sub = await prisma.department.create({
        data: {
          name: fullName, type: 'Sub-Account',
          isSubAccount: true, parentId: parent.id, createdByDeptId: parent.id,
          accessCodeHash: hash, accessCodeLabel: plainCode,
          staffId: r.staffId, headName: fullName, headTitle: r.title || null,
          headEmail: r.email, phone: r.phone,
          seniorityRank: rank,
        }
      });
      results.created.push({ id: sub.id, name: fullName, staffId: r.staffId, accessCode: plainCode, seniorityRank: rank });

      setImmediate(async () => {
        const lines = [
          `Welcome! Your sub-account has been set up on the CSS Group Requisition Management System (RMS) via a batch staff upload.`,
          ``,
          `Staff ID: ${r.staffId}`,
          `Account Name: ${fullName}`,
          `Parent Department: ${parent.name}`,
          ...(r.title ? [`Position / Title: ${r.title}`] : []),
          `Date Created: ${createdDate}`,
          ``,
          `YOUR ACCESS CODE: ${plainCode}`,
          ``,
          `IMPORTANT: This Access Code is for first-time login only. When you log in for the first time, you will be asked to create your own personal password.`,
          ``,
          `To log in: visit the RMS portal, select "${parent.name}" from the department list, then enter the Access Code above.`,
        ];
        const { text, html } = buildEmailContent({ title: `Welcome to CSS Group RMS — ${fullName}`, lines, actionLabel: 'Log In to RMS Portal' });
        sendEmail({ to: r.email, subject: `[RMS] Welcome — Your Sub-Account Access Code: ${fullName}`, text, html }).catch(() => {});
        sendSms({ to: r.phone, message: `CSS RMS: Your sub-account "${fullName}" under ${parent.name} is ready. Staff ID: ${r.staffId}. Access Code: ${plainCode}. Log in then create your password. - RMS Administrator` })
          .catch(e => logger.error(`[BATCH-UPLOAD] SMS failed for ${fullName} (${r.phone}):`, e.message));
      });
    }

    // Informational only — the actual successor at suspension time is recomputed live by
    // seniorityRank, so this just tells the admin who that would be right now.
    const currentSenior = await prisma.department.findFirst({
      where: { parentId: parent.id, isSubAccount: true, isDeleted: false, isDisabled: false },
      orderBy: [{ seniorityRank: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, staffId: true },
    });
    results.mostSenior = currentSenior;

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Batch Sub-Account Upload',
        details: `${createdBy} uploaded ${rows.length} staff record(s) for ${parent.name}${results.headAssigned ? ' (1 assigned as head)' : ''}.`
      }
    });

    res.json(results);
  } catch (err) {
    logger.error('[BATCH-UPLOAD] Failed:', err);
    sendError(res, 500, 'Batch upload failed unexpectedly. No records were created. Please try again or contact support if this persists.');
  }
});

// Update sub-account details
app.patch('/api/sub-accounts/:id', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    const { name, staffId: staffIdRaw, headName, headTitle, headEmail } = req.body;
    const staffId = staffIdRaw !== undefined ? (staffIdRaw?.trim() || null) : undefined;
    if (name?.trim()) {
      const clash = await prisma.department.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, NOT: { id: subId } } });
      if (clash) return res.status(409).json({ error: 'That name is already taken.' });
    }
    if (staffId) {
      const staffIdClash = await prisma.department.findFirst({ where: { staffId, NOT: { id: subId } } });
      if (staffIdClash) return res.status(409).json({ error: `Staff ID "${staffId}" is already assigned to "${staffIdClash.name}".` });
    }
    const updated = await prisma.department.update({
      where: { id: subId },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(staffId !== undefined ? { staffId } : {}),
        headName: headName ?? sub.headName,
        headTitle: headTitle ?? sub.headTitle,
        headEmail: headEmail !== undefined ? (headEmail?.trim() || null) : sub.headEmail
      }
    });
    res.json({ id: updated.id, name: updated.name, staffId: updated.staffId || null, headName: updated.headName, headTitle: updated.headTitle, headEmail: updated.headEmail });
  } catch (err) { sendError(res, 500, err.message); }
});

// Enable / disable sub-account
app.patch('/api/sub-accounts/:id/toggle', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    const updated = await prisma.department.update({ where: { id: subId }, data: { isDisabled: !sub.isDisabled } });
    res.json({ id: updated.id, isDisabled: updated.isDisabled });
  } catch (err) { sendError(res, 500, err.message); }
});

// Move a sub-account up or down in seniority order — swaps seniorityRank with whichever
// sibling currently sits on that side. This is what "rearrange the positioning" maps to:
// the order shown here is exactly what the succession cascade reads at suspension time.
app.patch('/api/sub-accounts/:id/move', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const direction = req.body?.direction === 'up' ? 'up' : req.body?.direction === 'down' ? 'down' : null;
    if (!direction) return res.status(400).json({ error: 'direction must be "up" or "down".' });

    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true, isDeleted: false } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });

    const siblings = await prisma.department.findMany({
      where: { parentId: sub.parentId, isSubAccount: true, isDeleted: false },
      orderBy: [{ seniorityRank: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, seniorityRank: true },
    });
    const idx = siblings.findIndex(s => s.id === subId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || swapIdx < 0 || swapIdx >= siblings.length) {
      return res.status(400).json({ error: `Already at the ${direction === 'up' ? 'top' : 'bottom'} of the list.` });
    }

    const current = siblings[idx];
    const swapWith = siblings[swapIdx];
    // Backfill null ranks (legacy rows created before this field existed) using their
    // current list position, so the swap always has real numbers to exchange.
    const currentRank = current.seniorityRank ?? idx + 1;
    const swapRank = swapWith.seniorityRank ?? swapIdx + 1;

    await prisma.$transaction([
      prisma.department.update({ where: { id: current.id }, data: { seniorityRank: swapRank } }),
      prisma.department.update({ where: { id: swapWith.id }, data: { seniorityRank: currentRank } }),
    ]);

    res.json({ success: true });
  } catch (err) { sendError(res, 500, err.message); }
});

// Soft-delete sub-account — marks isDeleted=true + isDisabled=true, preserves all data
// Dept heads can only delete their own sub-accounts; admins can delete any
app.delete('/api/sub-accounts/:id', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    if (sub.isDeleted) return res.status(400).json({ error: 'Sub-account is already deleted.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'You can only delete sub-accounts belonging to your department.' });
    await prisma.department.update({
      where: { id: subId },
      data: { isDeleted: true, isDisabled: true }
    });
    await prisma.activityLog.create({
      data: { action: 'SubAccountDeleted', details: `Sub-account "${sub.name}" soft-deleted by ${req.user.name || 'user'}. All records preserved.` }
    });
    res.json({ success: true, message: `"${sub.name}" has been deleted. All its records are preserved.` });
  } catch (err) { sendError(res, 500, err.message); }
});

// Reactivate a previously deleted sub-account — generates a fresh access code, preserves all history
app.post('/api/sub-accounts/:id/reactivate', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    if (!sub.isDeleted) return res.status(400).json({ error: 'Sub-account is not deleted — nothing to reactivate.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'You can only reactivate sub-accounts belonging to your department.' });
    const parent = await prisma.department.findUnique({ where: { id: sub.parentId } });

    // Generate a fresh access code
    const plainCode = await generateUniqueAccessCode(sub.name);
    const hash = await bcrypt.hash(plainCode, 10);

    await prisma.department.update({
      where: { id: subId },
      data: { isDeleted: false, isDisabled: false, accessCodeHash: hash, accessCodeLabel: plainCode }
    });
    await prisma.activityLog.create({
      data: { action: 'SubAccountReactivated', details: `Sub-account "${sub.name}" reactivated by ${req.user.name || 'user'}. All prior records restored.` }
    });

    // Email parent dept head with new credentials
    if (parent?.headEmail && !parent.headEmail.endsWith('@cssgroup.local')) {
      const { text, html } = buildEmailContent({
        title: `Sub-Account Reactivated — ${sub.name}`,
        lines: [
          `A previously deleted sub-account has been reactivated under your department.`,
          `Unit Name: ${sub.name}`,
          `Parent Department: ${parent.name}`,
          `New Login Password: ${plainCode}`,
          `Reactivated by: ${req.user?.name || 'Administrator'}`,
          `Date: ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
          ``,
          `All previous requests and records for this unit have been restored. Please share the new password securely with the relevant staff.`
        ]
      });
      sendEmail({ to: parent.headEmail, subject: `[RMS] Sub-Account Reactivated — ${sub.name}`, text, html }).catch(() => {});
    }

    res.json({
      id: sub.id, name: sub.name, accessCode: plainCode,
      isDisabled: false, isDeleted: false,
      parentDept: parent ? { id: parent.id, name: parent.name } : null
    });
  } catch (err) { sendError(res, 500, err.message); }
});

// Reset sub-account access code — returns plain code once; emails parent dept head
app.post('/api/sub-accounts/:id/reset-code', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({
      where: { id: subId, isSubAccount: true },
      include: { parent: { select: { id: true, name: true, headEmail: true } } }
    });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    const plainCode = await generateUniqueAccessCode(sub.name);
    const hash = await bcrypt.hash(plainCode, 10);
    await prisma.department.update({ where: { id: subId }, data: { accessCodeHash: hash, accessCodeLabel: plainCode, codeChangedByDept: false } });

    // Email parent dept head and sub-account (if it has headEmail) with the new password
    const resetBy = req.user?.name || req.user?.email || 'Administrator';
    const resetDate = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
    const parentEmail = sub.parent?.headEmail;
    const subEmail = sub.headEmail;

    if (parentEmail && !parentEmail.endsWith('@cssgroup.local')) {
      const { text, html } = buildEmailContent({
        title: `Sub-Account Access Code Reset — ${sub.name}`,
        lines: [
          `The login access code for one of your sub-accounts has been reset.`,
          ``,
          `Unit: ${sub.name}`,
          `Parent Department: ${sub.parent?.name || '—'}`,
          ``,
          `NEW ACCESS CODE: ${plainCode}`,
          ``,
          `Reset by: ${resetBy}`,
          `Date: ${resetDate}`,
          ``,
          `IMPORTANT: This is a first-time access code. The unit member will be prompted to create a new personal password when they log in with it. Please share this code securely with the unit staff.`
        ]
      });
      sendEmail({ to: parentEmail, subject: `[RMS] Sub-Account Access Code Reset — ${sub.name}`, text, html }).catch(() => {});
    }

    if (subEmail && !subEmail.endsWith('@cssgroup.local') && subEmail !== parentEmail) {
      const { text, html } = buildEmailContent({
        title: `Your Access Code Has Been Reset — ${sub.name}`,
        lines: [
          `Your sub-account access code has been reset by your department head.`,
          ``,
          `Account: ${sub.name}`,
          ``,
          `NEW ACCESS CODE: ${plainCode}`,
          ``,
          `Reset by: ${resetBy}`,
          `Date: ${resetDate}`,
          ``,
          `IMPORTANT: This is a one-time access code. You will be asked to create your own personal password when you log in with it. If you did not expect this reset, contact your department head immediately.`
        ]
      });
      sendEmail({ to: subEmail, subject: `[RMS] Your Access Code Has Been Reset — ${sub.name}`, text, html }).catch(() => {});
    }

    res.json({ accessCode: plainCode });
  } catch (err) { sendError(res, 500, err.message); }
});

// List users in a sub-account
app.get('/api/sub-accounts/:id/users', authenticateToken, requireSubAccountManager, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const users = await prisma.user.findMany({
      where: { departmentId: subId },
      select: { id: true, name: true, email: true, role: true, createdAt: true }
    });
    res.json(users);
  } catch (err) { sendError(res, 500, err.message); }
});

// Assign a user to this sub-account
app.post('/api/sub-accounts/:id/users', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });
    const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const updated = await prisma.user.update({ where: { id: parseInt(userId) }, data: { departmentId: subId } });
    res.json({ id: updated.id, name: updated.name, email: updated.email, departmentId: updated.departmentId });
  } catch (err) { sendError(res, 500, err.message); }
});

// Remove a user from this sub-account
app.delete('/api/sub-accounts/:id/users/:userId', authenticateToken, requireSubAccountManager, checkHeadCanManageSubaccounts, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    await prisma.user.update({ where: { id: parseInt(req.params.userId) }, data: { departmentId: null } });
    res.json({ ok: true });
  } catch (err) { sendError(res, 500, err.message); }
});

// List staff users available for assignment
// Requisitions created by a specific sub-account — for the expanded panel view
app.get('/api/sub-accounts/:id/requisitions', authenticateToken, requireSubAccountManager, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({ where: { id: subId, isSubAccount: true } });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const parentId = resolveParentId(req);
    if (parentId && sub.parentId !== parentId) return res.status(403).json({ error: 'Access denied.' });
    const reqs = await prisma.requisition.findMany({
      where: { departmentId: subId },
      select: {
        id: true, title: true, type: true, status: true, urgency: true,
        amount: true, createdAt: true,
        targetDepartment: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(reqs);
  } catch (err) { sendError(res, 500, err.message); }
});

app.get('/api/sub-accounts/available-users', authenticateToken, requireSubAccountManager, async (req, res) => {
  try {
    const parentId = resolveParentId(req);
    const subDeptIds = parentId
      ? (await prisma.department.findMany({ where: { parentId, isSubAccount: true }, select: { id: true } })).map(d => d.id)
      : (await prisma.department.findMany({ where: { isSubAccount: true }, select: { id: true } })).map(d => d.id);
    const users = await prisma.user.findMany({
      where: {
        role: 'staff',
        OR: [
          { departmentId: null },
          { departmentId: { in: subDeptIds } }
        ]
      },
      select: { id: true, name: true, email: true, departmentId: true },
      orderBy: { name: 'asc' }
    });
    res.json(users);
  } catch (err) { sendError(res, 500, err.message); }
});

// ── Sub-account privilege amount — set by parent dept head or Super Admin ─────
app.get('/api/sub-accounts/:id/privilege', authenticateToken, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const sub = await prisma.department.findFirst({
      where: { id: subId, isSubAccount: true },
      select: { id: true, parentId: true }
    });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const deptId  = req.user.deptId ? parseInt(req.user.deptId) : null;
    if (!isAdmin && deptId !== sub.parentId) return res.status(403).json({ error: 'Access denied.' });
    let priv = { privilegeAmount: null, cashPrivilege: false, memoPrivilege: false, materialPrivilege: false };
    try {
      const rows = await prisma.$queryRaw`
        SELECT "privilegeAmount", "cashPrivilege", "memoPrivilege", "materialPrivilege"
        FROM "Department" WHERE id = ${subId} LIMIT 1
      `;
      if (rows?.[0]) {
        const r = rows[0];
        priv = { privilegeAmount: r.privilegeAmount ?? null, cashPrivilege: r.cashPrivilege ?? false, memoPrivilege: r.memoPrivilege ?? false, materialPrivilege: r.materialPrivilege ?? false };
      }
    } catch (_) {}
    res.json(priv);
  } catch (err) { sendError(res, 500, err.message); }
});

app.put('/api/sub-accounts/:id/privilege', authenticateToken, checkHeadCanSetSubPrivileges, async (req, res) => {
  try {
    const subId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const sub = await prisma.department.findFirst({
      where: { id: subId, isSubAccount: true },
      select: { id: true, parentId: true, name: true }
    });
    if (!sub) return res.status(404).json({ error: 'Sub-account not found.' });

    if (!isAdmin && userDeptId !== sub.parentId) {
      return res.status(403).json({ error: 'Only the parent department head can set privileges for their sub-accounts.' });
    }

    const parsed = z.object({
      maxAmount:           z.union([z.number().min(0), z.null()]).optional(),
      approvalLimit:       z.union([z.number().min(0), z.null()]).optional(),
      cashPrivilege:       z.boolean().optional(),
      memoPrivilege:       z.boolean().optional(),
      materialPrivilege:   z.boolean().optional(),
      directRoute:         z.boolean().optional(),
      allowedRouteDeptIds: z.array(z.number().int()).nullable().optional(),
    }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid privilege payload.' });

    const { maxAmount, approvalLimit, cashPrivilege, memoPrivilege, materialPrivilege, directRoute, allowedRouteDeptIds } = parsed.data;
    if (maxAmount === undefined && approvalLimit === undefined && cashPrivilege === undefined && memoPrivilege === undefined && materialPrivilege === undefined && directRoute === undefined && allowedRouteDeptIds === undefined)
      return res.status(400).json({ error: 'No privilege fields provided.' });

    // Ensure columns exist in DB regardless of Prisma client schema version
    try {
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "privilegeAmount" DOUBLE PRECISION`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "approvalLimit" DOUBLE PRECISION`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "cashPrivilege" BOOLEAN NOT NULL DEFAULT false`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "memoPrivilege" BOOLEAN NOT NULL DEFAULT false`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "materialPrivilege" BOOLEAN NOT NULL DEFAULT false`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "directRoute" BOOLEAN NOT NULL DEFAULT false`;
      await prisma.$executeRaw`ALTER TABLE "Department" ADD COLUMN IF NOT EXISTS "allowedRouteDeptIds" TEXT`;
    } catch (_) {}

    // Build and run raw UPDATE to bypass Prisma client field validation
    const setClauses = [];
    const values = [];
    if (maxAmount !== undefined) { setClauses.push(`"privilegeAmount" = $${setClauses.length + 1}`); values.push(maxAmount === null ? null : parseFloat(maxAmount)); }
    if (approvalLimit !== undefined) { setClauses.push(`"approvalLimit" = $${setClauses.length + 1}`); values.push(approvalLimit === null ? null : parseFloat(approvalLimit)); }
    if (cashPrivilege !== undefined) { setClauses.push(`"cashPrivilege" = $${setClauses.length + 1}`); values.push(cashPrivilege); }
    if (memoPrivilege !== undefined) { setClauses.push(`"memoPrivilege" = $${setClauses.length + 1}`); values.push(memoPrivilege); }
    if (materialPrivilege !== undefined) { setClauses.push(`"materialPrivilege" = $${setClauses.length + 1}`); values.push(materialPrivilege); }
    if (directRoute !== undefined) { setClauses.push(`"directRoute" = $${setClauses.length + 1}`); values.push(directRoute); }
    if (allowedRouteDeptIds !== undefined) { setClauses.push(`"allowedRouteDeptIds" = $${setClauses.length + 1}`); values.push(allowedRouteDeptIds === null || allowedRouteDeptIds.length === 0 ? null : JSON.stringify(allowedRouteDeptIds)); }
    values.push(subId);
    await prisma.$executeRawUnsafe(
      `UPDATE "Department" SET ${setClauses.join(', ')} WHERE id = $${values.length}`,
      ...values
    );

    try {
      await prisma.activityLog.create({
        data: {
          userId: getNumericUserId(req.user) || null,
          action: 'Sub-Account Privilege Updated',
          details: `Privilege for ${sub.name}: maxAmount=${maxAmount}, memoPrivilege=${memoPrivilege}, materialPrivilege=${materialPrivilege}`
        }
      });
    } catch (_) {}

    let updated = { privilegeAmount: null, approvalLimit: null, cashPrivilege: false, memoPrivilege: false, materialPrivilege: false, directRoute: false, allowedRouteDeptIds: [] };
    try {
      const rows = await prisma.$queryRaw`
        SELECT "privilegeAmount", "approvalLimit", "cashPrivilege", "memoPrivilege", "materialPrivilege",
               "directRoute", "allowedRouteDeptIds"
        FROM "Department" WHERE id = ${subId} LIMIT 1
      `;
      if (rows?.[0]) {
        const d = rows[0];
        let allowedRouteDeptIds = [];
        try { allowedRouteDeptIds = JSON.parse(d.allowedRouteDeptIds || 'null') || []; } catch { allowedRouteDeptIds = []; }
        updated = { ...d, allowedRouteDeptIds };
      }
    } catch (_) {}
    res.json({ success: true, ...updated });
  } catch (error) { sendError(res, 500, error.message); }
});

// User Signature Upload (User or Admin)
app.post('/api/users/:id/signature', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = getNumericUserId(req.user);
    const targetId = parseInt(id);
    if (!req.file) return res.status(400).json({ error: 'No signature uploaded' });
    if (userId !== targetId && normalizeRole(req.user.role) !== 'global_admin') {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    const storageKey = generateStorageKey(`signatures/user-${id}`, req.file.originalname);
    await putObject({ key: storageKey, body: req.file.buffer, contentType: req.file.mimetype });
    const signatureRecord = await prisma.userSignature.upsert({
      where: { userId: targetId },
      update: { imageKey: storageKey },
      create: { userId: targetId, imageKey: storageKey }
    });
    res.json(signatureRecord);
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/requisitions', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length === 0) return res.status(400).json({ error: 'No requisitions supplied' });

    const systemUser = await prisma.user.findFirst({ where: { role: 'global_admin' } });
    const creatorId = getNumericUserId(req.user) || systemUser?.id || 1;
    const createdRecords = [];
    const existingRecords = [];

    for (const item of items) {
      const parsed = z.object({
        clientId: z.string().optional().nullable(),
        title: z.string().optional().nullable(),
        description: z.string().optional().nullable(),
        type: z.string().optional().nullable(),
        amount: z.union([z.string(), z.number()]).optional().nullable(),
        departmentId: z.union([z.string(), z.number()]).optional().nullable(),
        urgency: z.string().optional().nullable(),
        content: z.string().optional().nullable(),
        isDraft: z.union([z.boolean(), z.string()]).optional().nullable(),
        targetDepartmentId: z.union([z.string(), z.number()]).optional().nullable(),
        status: z.string().optional().nullable(),
        createdBy: z.string().optional().nullable(),
        createdAt: z.string().optional().nullable(),
      }).passthrough().safeParse(item);
      if (!parsed.success) {
        console.error('[REQS] Validation failed:', JSON.stringify(parsed.error.issues));
        return res.status(400).json({ error: 'Some required fields are missing or invalid. Please check your request and try again.' });
      }
      const data = parsed.data;
      const clientId = data.clientId || crypto.randomUUID();

      const existing = await prisma.requisition.findUnique({ where: { clientId } });
      if (existing) {
        existingRecords.push(existing);
        continue;
      }

      const recordType = data.type || 'Cash';
      const isMemoPayload = /memo/i.test(recordType) || /memorandum/i.test(recordType);
      const isMaterialPayload = /^material/i.test(recordType);
      const isCashPayload = !isMemoPayload && !isMaterialPayload;
      const amount = parseFloat(data.amount || 0) || 0;
      const eligibleStages = await getEligibleStages(amount);
      const firstStage = eligibleStages[0] || null;
      const isDraft = data.isDraft === true || data.isDraft === 'true';

      // Super Admin oversees the registry rather than originating requests — each
      // request type can be individually re-enabled for Admin via System Settings.
      if (req.user.role === 'global_admin' && !isDraft) {
        const settingKey = isMemoPayload ? 'admin_create_memo_enabled'
          : isMaterialPayload ? 'admin_create_material_enabled'
          : 'admin_create_fund_enabled';
        const setting = await prisma.systemSetting.findUnique({ where: { key: settingKey } });
        if (setting?.value !== 'true') {
          return res.status(403).json({ error: `Super Admin cannot create ${isMemoPayload ? 'memos' : isMaterialPayload ? 'Material Requests' : 'Fund Requests'} until enabled in System Settings → Features.` });
        }
      }

      const originDeptId = parseInt(data.departmentId || req.user.deptId || 1);
      if (req.user.role === 'department' && req.user.deptId && originDeptId !== parseInt(req.user.deptId)) {
        return res.status(403).json({ error: 'Department users can only create for their own department' });
      }

      // ── Sub-account creation privilege checks ─────────────────────────────
      if (req.user.isSubAccount && req.user.role === 'department') {
        const subPriv = await getSubPrivilege(originDeptId);

        // Cash: check toggle then enforce optional amount limit
        if (isCashPayload && !isDraft) {
          const cashAllowed = subPriv.cashPrivilege || req.user.cashPrivilege || subPriv.privilegeAmount != null;
          if (!cashAllowed) {
            return res.status(403).json({ error: 'Your sub-account does not have permission to create cash requests. Ask your department head to enable Cash Privilege.' });
          }
          if (subPriv.privilegeAmount != null) {
            const creationLimit = parseFloat(subPriv.privilegeAmount);
            if (!isNaN(creationLimit) && amount > creationLimit) {
              return res.status(403).json({
                error: `Your sub-account can only create cash requests up to ₦${creationLimit.toLocaleString()}. This request is ₦${amount.toLocaleString()}.`
              });
            }
          }
        }

        // Memo: check toggle
        if (isMemoPayload && !isDraft && !subPriv.memoPrivilege && !(req.user.memoPrivilege)) {
          return res.status(403).json({ error: 'Your sub-account does not have permission to create memo requests. Ask your department head to enable Memo Privilege.' });
        }

        // Material: check toggle
        if (isMaterialPayload && !isDraft && !subPriv.materialPrivilege && !(req.user.materialPrivilege)) {
          return res.status(403).json({ error: 'Your sub-account does not have permission to create material requests. Ask your department head to enable Material Privilege.' });
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      // Validate target department if supplied
      let targetDepartmentId = data.targetDepartmentId ? parseInt(data.targetDepartmentId) : null;

      // ── Sub-account routing enforcement ───────────────────────────────────
      if (!isDraft && req.user.isSubAccount && req.user.parentDeptId) {
        const subPriv = await getSubPrivilege(originDeptId);
        if (!subPriv.directRoute) {
          // Direct route OFF → force all requests through the parent head
          targetDepartmentId = parseInt(req.user.parentDeptId);
        } else if (subPriv.allowedRouteDeptIds && subPriv.allowedRouteDeptIds.length > 0) {
          // Direct route ON with restricted list → validate chosen target
          if (targetDepartmentId && !subPriv.allowedRouteDeptIds.includes(targetDepartmentId)) {
            return res.status(403).json({
              error: 'Your unit is not authorised to send requests to that department. Contact your department head.'
            });
          }
        }
        // directRoute ON + empty allowedRouteDeptIds → any department is fine (no restriction)
      }
      // ──────────────────────────────────────────────────────────────────────

      // Non-admin, non-draft submissions must always specify a target department
      const isAdminSender = normalizeRole(req.user.role) === 'global_admin';
      if (!isDraft && !isAdminSender && !targetDepartmentId) {
        return res.status(400).json({ error: 'Please select a department to send this request to.' });
      }

      if (targetDepartmentId) {
        const targetDept = await prisma.department.findUnique({ where: { id: targetDepartmentId } });
        if (!targetDept) {
          return res.status(400).json({ error: 'Target department not found' });
        }
        // Only Global Admin / GM / CEO / HR may route to Super Admin dept
        const superAdminDept = await prisma.department.findFirst({ where: { name: 'Super Admin' } });
        const senderDept = await prisma.department.findUnique({ where: { id: originDeptId } });
        const privilegedCodes = ['GMR', 'CEO', 'HRD'];
        if (
          superAdminDept && targetDepartmentId === superAdminDept.id &&
          normalizeRole(req.user.role) !== 'global_admin' &&
          !privilegedCodes.includes(senderDept?.code)
        ) {
          return res.status(403).json({ error: 'Only GM, CEO, or HR may send to Super Admin' });
        }
      }

      // GLOBAL GOVERNANCE CHECK (Bypassed for Global Admins)
      const isGlobalAdmin = normalizeRole(req.user.role) === 'global_admin';

      if (!isGlobalAdmin) {
        const originReady = await checkDeptReadiness(originDeptId);
        if (!originReady.ready) return res.status(400).json({ error: originReady.reason });

        if (targetDepartmentId) {
          const targetReady = await checkDeptReadiness(targetDepartmentId);
          if (!targetReady.ready) return res.status(400).json({ error: targetReady.reason });
        }
      }

      // Inter-department requests (with targetDepartmentId) from non-admin senders
      // skip the admin workflow entirely – only the target dept reviews them.
      const isAdminOriginated = normalizeRole(req.user.role) === 'global_admin';
      const useWorkflow = !targetDepartmentId || isAdminOriginated;

      const refCode = await buildRefCode(recordType, originDeptId, isDraft);
      const created = await prisma.requisition.create({
        data: {
          clientId,
          title: data.title || data.description || (isMemoPayload ? 'Untitled Memo' : 'Untitled Requisition'),
          type: recordType,
          amount: isMemoPayload ? null : amount,
          description: data.description || '',
          urgency: data.urgency || 'normal',
          status: isDraft ? 'draft' : 'pending',
          departmentId: originDeptId,
          creatorId,
          content: data.content || null,
          currentStageId: isDraft ? null : (!isMemoPayload && useWorkflow ? (firstStage?.id || null) : null),
          lastActionById: creatorId,
          lastActionAt: new Date(),
          targetDepartmentId: isDraft ? null : targetDepartmentId,
          refCode: refCode || null,
        }
      });

      // Track the initial creation event for inter-department chain
      if (!isDraft && targetDepartmentId) {
        try {
          await prisma.forwardEvent.create({
            data: {
              requisitionId: created.id,
              fromDeptId: originDeptId,
              toDeptId: targetDepartmentId,
              action: 'created',
              note: data.description || null,
              actorName: req.user?.name || 'System'
            }
          });
        } catch (fwdErr) { logger.warn('[FWD] Forward event creation failed:', fwdErr.message); }
      }

      createdRecords.push(created);

      // Fire post-creation notifications asynchronously — do NOT await before responding
      if (!isDraft) {
        const _created = created;
        const _isMemoPayload = isMemoPayload;
        const _useWorkflow = useWorkflow;
        const _firstStageRole = firstStage?.role;
        const _originDeptId = originDeptId;
        const _targetDepartmentId = targetDepartmentId;
        setImmediate(async () => {
          try {
            if (!_isMemoPayload && _useWorkflow && _firstStageRole) {
              await notifyRole(_firstStageRole, `New Requisition: ${_created.title}`, _created.id);
            }
            const originDept = await prisma.department.findUnique({ where: { id: _originDeptId } });
            const targetDeptForEmail = _targetDepartmentId
              ? await prisma.department.findUnique({ where: { id: _targetDepartmentId } })
              : null;

            // Real-time SSE + in-app/push notification — ICC (global observer) always included
            broadcastUpdate(_created.id, { action: 'created', fromDept: originDept?.name || 'Department', toDept: targetDeptForEmail?.name });
            broadcastPushToInvolved(_created.id, {
              title: _isMemoPayload ? 'New Memo Submitted' : 'New Requisition Submitted',
              body: `${originDept?.name || 'A department'} submitted "${_created.title}"${targetDeptForEmail ? ` → ${targetDeptForEmail.name}` : ''}`,
              url: `/?req=${_created.id}`
            });
            await notifyDepartmentHead({
              departmentId: _originDeptId,
              requisition: { ..._created, department: originDept || null },
              subject: _isMemoPayload ? `Your Memo has been Submitted: ${_created.title}` : `Your Requisition has been Submitted: ${_created.title}`,
              lines: [
                `Department: ${originDept?.name || 'Department'}`,
                targetDeptForEmail ? `Sent To: ${targetDeptForEmail.name}` : null,
                `Type: ${_created.type}`,
                amountLine(_created.type, _created.amount),
                `Urgency: ${_created.urgency || 'normal'}`,
              ].filter(Boolean)
            });
            if (_targetDepartmentId) {
              await notifyDepartmentHead({
                departmentId: _targetDepartmentId,
                requisition: _created,
                subject: _isMemoPayload ? `Incoming Memo: ${_created.title}` : `Incoming Requisition: ${_created.title}`,
                lines: [
                  `From Department: ${originDept?.name || 'Department'}`,
                  `Type: ${_created.type}`,
                  amountLine(_created.type, _created.amount),
                  `Urgency: ${_created.urgency || 'normal'}`,
                  `Description: ${_created.description || '—'}`
                ]
              });
            }

            // If this was submitted by a sub-account, also notify the parent department head
            if (originDept?.isSubAccount && originDept?.parentId) {
              const parentDept = await prisma.department.findUnique({ where: { id: originDept.parentId } });
              if (parentDept) {
                // In-app platform notification for the parent dept
                try {
                  await prisma.notification.create({
                    data: {
                      departmentId: parentDept.id,
                      content: `Sub-unit ${originDept.name} submitted: ${_created.title}`,
                      link: `/requisitions/${_created.id}`
                    }
                  });
                } catch (_) {}
                // Email notification to parent dept head
                await notifyDepartmentHead({
                  departmentId: parentDept.id,
                  requisition: { ..._created, department: originDept },
                  subject: `Sub-Unit Submission: ${_created.title}`,
                  lines: [
                    `Your sub-unit "${originDept.name}" submitted a new request.`,
                    `Sent To: ${targetDeptForEmail?.name || 'Workflow'}`,
                    `Type: ${_created.type}`,
                    amountLine(_created.type, _created.amount),
                    `Urgency: ${_created.urgency || 'normal'}`,
                    `Description: ${_created.description || '—'}`
                  ].filter(Boolean)
                });
              }
            }
          } catch (e) { logger.warn('[NOTIFY] Post-create notifications failed:', e.message); }
        });
      }
    }

    res.json([...createdRecords, ...existingRecords]);
  } catch (error) { sendError(res, 500, error.message); }
});

// Edit draft requisition
app.put('/api/requisitions/:id', authenticateToken, generalLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      type: z.string().optional(),
      amount: z.union([z.string(), z.number()]).optional(),
      urgency: z.string().optional(),
      content: z.string().optional(),
      isDraft: z.boolean().optional(),
      targetDepartmentId: z.number().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const data = parsed.data;

    const existing = await prisma.requisition.findUnique({ where: { id: parseInt(id) } });
    if (!existing) return res.status(404).json({ error: 'Requisition not found' });
    if (existing.status !== 'draft') return res.status(400).json({ error: 'Only drafts can be edited' });

    // Verify ownership — also allow the parent dept head to edit sub-account drafts
    const systemUser = await prisma.user.findFirst({ where: { role: 'global_admin' } });
    const isAdmin = getNumericUserId(req.user) === systemUser?.id;
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    let canEdit = isAdmin || existing.departmentId === userDeptId;
    if (!canEdit && userDeptId) {
      const subDept = await prisma.department.findFirst({
        where: { id: existing.departmentId, isSubAccount: true, parentId: userDeptId }
      });
      canEdit = !!subDept;
    }
    if (!canEdit) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }

    const recordType = data.type !== undefined ? data.type : existing.type;
    const isMemoPayload = /memo/i.test(recordType) || /memorandum/i.test(recordType);
    const amount = isMemoPayload ? null : parseFloat(data.amount || existing.amount || 0);
    const eligibleStages = await getEligibleStages(amount);
    const firstStage = eligibleStages[0] || null;
    const targetDepartmentId = data.isDraft
      ? existing.targetDepartmentId
      : (data.targetDepartmentId !== undefined ? data.targetDepartmentId : existing.targetDepartmentId);
    const useWorkflow = !targetDepartmentId || isAdmin;

    const updated = await prisma.requisition.update({
      where: { id: parseInt(id) },
      data: {
        title: data.title !== undefined ? data.title : existing.title,
        description: data.description !== undefined ? data.description : existing.description,
        type: recordType,
        amount: isMemoPayload ? null : (data.amount !== undefined ? amount : existing.amount),
        urgency: data.urgency !== undefined ? data.urgency : existing.urgency,
        content: data.content !== undefined ? data.content : existing.content,
        targetDepartmentId,
        status: data.isDraft ? 'draft' : 'pending',
        currentStageId: data.isDraft ? null : (!isMemoPayload && useWorkflow ? (firstStage?.id || null) : null),
      }
    });

    if (!data.isDraft && existing.status === 'draft') {
      if (!isMemoPayload && useWorkflow && firstStage?.role) {
        await notifyRole(firstStage.role, `New Requisition: ${updated.title}`, updated.id);
      }

      const originDeptId = userDeptId || updated.departmentId;
      const originDept = await prisma.department.findUnique({ where: { id: originDeptId } });
      const currentRequisition = await prisma.requisition.findUnique({ where: { id: updated.id }, include: { department: true } });

      // Notify Target Department if specified
      if (updated.targetDepartmentId) {
        await notifyDepartmentHead({
          departmentId: updated.targetDepartmentId,
          requisition: currentRequisition,
          subject: isMemoPayload ? `Incoming Memo: ${updated.title}` : `Incoming Requisition: ${updated.title}`,
          lines: [
            `From Department: ${originDept?.name || 'Department'}`,
            `Type: ${updated.type}`,
            amountLine(updated.type, updated.amount),
            `Urgency: ${updated.urgency || 'normal'}`
          ]
        });
      }

      // Also notify origin department head that it's now submitted
      await notifyDepartmentHead({
        departmentId: originDeptId,
        requisition: currentRequisition,
        subject: isMemoPayload ? `Memo Submitted: ${updated.title}` : `Requisition Submitted: ${updated.title}`,
        lines: [
          `Status: Moved from draft to pending`,
          `Type: ${updated.type}`,
          amountLine(updated.type, updated.amount)
        ]
      });
    }
    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

// Delete requisition (admins can delete any; departments can only delete their own drafts)
app.delete('/api/requisitions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqId = parseInt(id);
    const existing = await prisma.requisition.findUnique({
      where: { id: reqId },
      include: { department: { select: { name: true } } }
    });
    if (!existing) return res.status(404).json({ error: 'Requisition not found' });

    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;

    if (!isAdmin) {
      let canDelete = existing.departmentId === userDeptId;
      if (!canDelete && userDeptId) {
        const subDept = await prisma.department.findFirst({
          where: { id: existing.departmentId, isSubAccount: true, parentId: userDeptId }
        });
        canDelete = !!subDept;
      }
      if (!canDelete) {
        return res.status(403).json({ error: 'You can only delete records belonging to your department.' });
      }
      // Block deletion once the record has been finally treated, published, or fully approved
      const lockedStatuses = ['treated', 'published', 'approved'];
      if (lockedStatuses.includes(existing.finalApprovalStatus)) {
        return res.status(400).json({ error: 'This record has been finally processed and can no longer be deleted. Contact the administrator if removal is required.' });
      }
    }

    // Snapshot + audit log every deletion unconditionally, including Global Admin's — a
    // completed, audited financial transaction should never be erasable with zero trace
    // just because the actor happens to be an admin.
    await prisma.deletedRecord.create({
      data: {
        originalId:     reqId,
        recordType:     existing.type || 'Requisition',
        title:          existing.title,
        departmentId:   existing.departmentId,
        departmentName: existing.department?.name || null,
        deletedByName:  req.user.name || null,
        snapshot:       JSON.parse(JSON.stringify(existing)),
      }
    });
    await prisma.activityLog.create({
      data: {
        action: 'Requisition Deleted',
        details: `"${existing.title}" (#${reqId}, ${existing.type || 'Requisition'}) deleted by ${req.user.name || 'unknown user'}${isAdmin ? ' (Global Admin)' : ''}`,
        userId: getNumericUserId(req.user) || null,
      }
    });

    // Cascade-delete all related records in dependency order so FK constraints are satisfied
    // 1. File access logs (reference Attachments)
    const attachments = await prisma.attachment.findMany({ where: { requisitionId: reqId }, select: { id: true } });
    if (attachments.length > 0) {
      await prisma.fileAccessLog.deleteMany({ where: { attachmentId: { in: attachments.map(a => a.id) } } });
    }
    // 2. Attachments
    await prisma.attachment.deleteMany({ where: { requisitionId: reqId } });
    // 3. Signature records (reference Approvals)
    const approvals = await prisma.approval.findMany({ where: { requisitionId: reqId }, select: { id: true } });
    if (approvals.length > 0) {
      await prisma.signatureRecord.deleteMany({ where: { approvalId: { in: approvals.map(a => a.id) } } });
    }
    // 4. Approvals
    await prisma.approval.deleteMany({ where: { requisitionId: reqId } });
    // 5. Forward events (already cascade, but be explicit)
    await prisma.forwardEvent.deleteMany({ where: { requisitionId: reqId } });
    // 6. Notifications linked to this record
    await prisma.notification.deleteMany({ where: { link: { in: [`/requisitions/${reqId}`, `/memos/${reqId}`] } } });
    // 7. Finally delete the requisition
    await prisma.requisition.delete({ where: { id: reqId } });

    res.json({ ok: true, message: 'Requisition permanently deleted.' });
  } catch (error) {
    logger.error('[DELETE REQUISITION] Error:', error.message);
    res.status(500).json({ error: 'Failed to delete requisition. Please try again.' });
  }
});

app.post('/api/requisitions/bulk-delete', authenticateToken, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });

    const systemUser = await prisma.user.findFirst({ where: { role: 'global_admin' } });
    const isAdmin = getNumericUserId(req.user) === systemUser?.id;
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;

    const targetIds = [];
    let targetRecords = [];
    if (isAdmin) {
      targetRecords = await prisma.requisition.findMany({
        where: { id: { in: ids } },
        include: { department: { select: { name: true } } }
      });
      targetRecords.forEach(r => targetIds.push(r.id));
    } else {
      // Departments can bulk-delete their own records — not if finally processed
      targetRecords = await prisma.requisition.findMany({
        where: {
          id: { in: ids },
          departmentId: userDeptId,
          finalApprovalStatus: { notIn: ['treated', 'published', 'approved'] }
        },
        include: { department: { select: { name: true } } }
      });
      targetRecords.forEach(r => targetIds.push(r.id));
    }
    if (targetIds.length === 0) return res.json({ ok: true, message: 'No eligible records to delete.' });

    // Snapshot + audit log every deletion unconditionally, including Global Admin's —
    // same reasoning as the single-record delete endpoint above.
    await prisma.deletedRecord.createMany({
      data: targetRecords.map(r => ({
        originalId:     r.id,
        recordType:     r.type || 'Requisition',
        title:          r.title,
        departmentId:   r.departmentId,
        departmentName: r.department?.name || null,
        deletedByName:  req.user.name || null,
        snapshot:       JSON.parse(JSON.stringify(r)),
      }))
    });
    await prisma.activityLog.create({
      data: {
        action: 'Requisitions Bulk Deleted',
        details: `${targetRecords.length} record(s) deleted by ${req.user.name || 'unknown user'}${isAdmin ? ' (Global Admin)' : ''}: ${targetRecords.map(r => `#${r.id}`).join(', ')}`,
        userId: getNumericUserId(req.user) || null,
      }
    });

    // Cascade manually to avoid FK constraint failures
    const attachments = await prisma.attachment.findMany({ where: { requisitionId: { in: targetIds } }, select: { id: true } });
    if (attachments.length > 0) {
      await prisma.fileAccessLog.deleteMany({ where: { attachmentId: { in: attachments.map(a => a.id) } } });
    }
    await prisma.attachment.deleteMany({ where: { requisitionId: { in: targetIds } } });
    const approvals = await prisma.approval.findMany({ where: { requisitionId: { in: targetIds } }, select: { id: true } });
    if (approvals.length > 0) {
      await prisma.signatureRecord.deleteMany({ where: { approvalId: { in: approvals.map(a => a.id) } } });
    }
    await prisma.approval.deleteMany({ where: { requisitionId: { in: targetIds } } });
    await prisma.forwardEvent.deleteMany({ where: { requisitionId: { in: targetIds } } });
    await prisma.notification.deleteMany({
      where: { link: { in: targetIds.flatMap(id => [`/requisitions/${id}`, `/memos/${id}`]) } }
    });
    await prisma.requisition.deleteMany({ where: { id: { in: targetIds } } });
    return res.json({ ok: true, message: `${targetIds.length} record(s) deleted.` });
  } catch (error) {
    logger.error('[BULK DELETE] Error:', error.message);
    res.status(500).json({ error: 'Bulk delete failed. Please try again.' });
  }
});


// ── Deleted Records Bin (super admin only — invisible to department users) ──────
// ── Admin Documentation: live architecture guide + read-only migration logbook ──
// The guide is read straight off disk on every request (no caching) so editing
// ARCHITECTURE.md and deploying is the only step needed to update what admins see —
// there is no build step or database write involved in keeping this page current.
app.get('/api/admin/architecture-doc', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const docPath = path.join(__dirname, 'ARCHITECTURE.md');
    const content = fs.readFileSync(docPath, 'utf8');
    const stats = fs.statSync(docPath);
    res.json({ content, updatedAt: stats.mtime });
  } catch (err) {
    logger.error('[ARCHITECTURE DOC GET]', err.message);
    res.status(500).json({ error: 'Failed to load architecture guide.' });
  }
});

app.get('/api/admin/vps-guide', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const docPath = path.join(__dirname, 'VPS_MANAGEMENT_GUIDE.md');
    const content = fs.readFileSync(docPath, 'utf8');
    const stats = fs.statSync(docPath);
    res.json({ content, updatedAt: stats.mtime });
  } catch (err) {
    logger.error('[VPS GUIDE GET]', err.message);
    res.status(500).json({ error: 'Failed to load VPS management guide.' });
  }
});

app.get('/api/admin/deploy-history', authenticateToken, requireRoles(['global_admin']), (req, res) => {
  const logPath = path.join(__dirname, 'deploy-history.log');
  try {
    if (!fs.existsSync(logPath)) {
      return res.json({ content: 'No deploys recorded yet.\nPush a change to trigger the first deploy.' });
    }
    const raw = fs.readFileSync(logPath, 'utf8');
    const content = raw.length > 20000 ? raw.slice(-20000) : raw;
    res.json({ content });
  } catch (err) {
    logger.error('[DEPLOY HISTORY GET]', err.message);
    res.status(500).json({ error: 'Failed to read deploy history.' });
  }
});

app.get('/api/admin/pm2-logs', authenticateToken, requireRoles(['global_admin']), (req, res) => {
  const lines = Math.min(Math.max(parseInt(req.query.lines) || 150, 1), 500);
  const type = req.query.type === 'err' ? 'cssrms-error.log' : 'cssrms-out.log';
  const logPath = `/var/log/pm2/${type}`;
  try {
    if (!fs.existsSync(logPath)) return res.json({ lines: [], total: 0 });
    const all = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim());
    res.json({ lines: all.slice(-lines), total: all.length });
  } catch (err) {
    logger.error('[PM2 LOGS GET]', err.message);
    res.status(500).json({ error: 'Failed to read PM2 logs.' });
  }
});

// Reads Prisma's own migration history table directly — this list is always accurate
// with zero manual upkeep, since it's exactly what the database itself recorded.
app.get('/api/admin/storage-status', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  const status = {
    mode: useS3 ? 'r2' : 'local-disk',
    r2Configured: useS3,
    r2AccountId: process.env.R2_ACCOUNT_ID ? `${process.env.R2_ACCOUNT_ID.slice(0, 6)}***` : null,
    r2Bucket: process.env.R2_BUCKET_NAME || null,
    testResult: null,
    testError: null,
  };
  if (useS3) {
    try {
      const testKey = `_healthcheck/ping-${Date.now()}.txt`;
      await putObject({ key: testKey, body: Buffer.from('ping'), contentType: 'text/plain' });
      await deleteObject(testKey);
      status.testResult = 'ok';
    } catch (err) {
      status.testResult = 'failed';
      status.testError = err.message;
    }
  } else {
    const { promises: fsp, existsSync } = require('fs');
    const uploadDir = require('path').join(__dirname, 'uploads');
    try {
      await fsp.mkdir(uploadDir, { recursive: true });
      const testFile = require('path').join(uploadDir, `ping-${Date.now()}.txt`);
      await fsp.writeFile(testFile, 'ping');
      await fsp.unlink(testFile);
      status.testResult = 'ok';
    } catch (err) {
      status.testResult = 'failed';
      status.testError = err.message;
    }
  }
  res.json(status);
});

app.get('/api/admin/migrations', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name, started_at, finished_at, applied_steps_count, logs
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
    `;
    res.json(rows);
  } catch (err) {
    logger.error('[MIGRATIONS LOGBOOK GET]', err.message);
    res.status(500).json({ error: 'Failed to load migration history.' });
  }
});

app.get('/api/admin/deleted-records', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const records = await prisma.deletedRecord.findMany({
      orderBy: { deletedAt: 'desc' }
    });
    res.json(records);
  } catch (err) {
    logger.error('[DELETED RECORDS GET]', err.message);
    res.status(500).json({ error: 'Failed to fetch deleted records.' });
  }
});

app.delete('/api/admin/deleted-records/:id', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    await prisma.deletedRecord.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true, message: 'Record permanently purged from bin.' });
  } catch (err) {
    logger.error('[DELETED RECORDS DELETE]', err.message);
    res.status(500).json({ error: 'Failed to purge record.' });
  }
});

// ── Public login-style setting (no auth — needed before user logs in) ─────────
app.get('/api/public/login-style', async (req, res) => {
  try {
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SystemSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '')`;
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'login_style' LIMIT 1`;
    res.json({ value: rows[0]?.value ?? 'standard' });
  } catch { res.json({ value: 'standard' }); }
});

// ── Public ICT support phone (no auth — shown on login forgot-code modal) ─────
app.get('/api/public/support-phone', async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'ict_support_phone' LIMIT 1`;
    res.json({ value: rows?.[0]?.value || '' });
  } catch { res.json({ value: '' }); }
});

// ── Public app status (maintenance mode check — no auth, bypasses maintenance middleware) ─
app.get('/api/public/app-status', (req, res) => {
  res.json({ maintenance: process.env.MAINTENANCE_MODE === 'true' });
});

// ── Public Turnstile config (no auth — needed by login page before user logs in) ─
app.get('/api/public/turnstile-config', async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'turnstile_required_depts' LIMIT 1`;
    const requiredDepts = rows?.[0]?.value ? JSON.parse(rows[0].value) : [];
    // TURNSTILE_ENABLED=false in Railway env disables Turnstile system-wide
    const globallyEnabled = process.env.TURNSTILE_ENABLED !== 'false';
    res.json({ requiredDepts, globallyEnabled });
  } catch { res.json({ requiredDepts: [], globallyEnabled: true }); }
});

// ── System Settings ───────────────────────────────────────────────────────────
// GET /api/system-settings/:key  — read one setting (public for dept-level reads like chairman access)
app.get('/api/system-settings/:key', authenticateToken, async (req, res) => {
  try {
    // Ensure table exists (idempotent — protects against boot-race on Railway)
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SystemSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '')`;
    const rows = await prisma.$queryRaw`
      SELECT "value" FROM "SystemSetting" WHERE "key" = ${req.params.key} LIMIT 1
    `;
    res.json({ key: req.params.key, value: rows[0]?.value ?? null });
  } catch (error) { sendError(res, 500, error.message); }
});

// PUT /api/system-settings/:key  — upsert one setting (Super Admin only)
app.put('/api/system-settings/:key', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const { value } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value is required' });
    // Ensure table exists (idempotent — protects against boot-race on Railway)
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SystemSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '')`;
    await prisma.$executeRaw`
      INSERT INTO "SystemSetting" ("key", "value") VALUES (${req.params.key}, ${value})
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
    `;
    if (req.params.key === 'oversight_departments') invalidateOversightCache();
    res.json({ key: req.params.key, value });
  } catch (error) { sendError(res, 500, error.message); }
});

// GET /api/sync/heartbeat — desktop-client activation check. Deliberately NOT
// gated by authenticateToken: the desktop app has no RMS login of its own,
// it's a separate product entirely. Gated instead by a fixed shared secret
// (DESKTOP_SYNC_KEY) sent as a header — a wrong/missing key gets a plain 404,
// not 401/403, so the route's existence isn't advertised to anyone probing it.
// Reuses the same SystemSetting table/keys the Super Admin already edits via
// the existing PUT /api/system-settings/:key (no separate write endpoint
// needed) — desktop_sync_enabled ("true"/"false"), desktop_sync_expires_at
// (ISO datetime or empty = no auto-expiry), desktop_sync_message (free text
// the admin controls, shown verbatim to the desktop app's users when
// disabled — never hardcoded here, and never attributed to any third party).
app.get('/api/sync/heartbeat', desktopSyncLimiter, async (req, res) => {
  if (!process.env.DESKTOP_SYNC_KEY || req.headers['x-sync-key'] !== process.env.DESKTOP_SYNC_KEY) {
    return res.status(404).end();
  }
  try {
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SystemSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '')`;
    const rows = await prisma.$queryRaw`
      SELECT "key", "value" FROM "SystemSetting"
      WHERE "key" IN (
        'desktop_sync_enabled', 'desktop_sync_expires_at', 'desktop_sync_message',
        'desktop_app_latest_version', 'desktop_app_download_url', 'desktop_app_release_notes'
      )
    `;
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const expiresAt = map.desktop_sync_expires_at || null;
    const notExpired = !expiresAt || new Date(expiresAt) > new Date();
    const enabled = map.desktop_sync_enabled !== 'false' && notExpired;

    // Own try/catch, deliberately isolated from the block above: a problem
    // fetching pending corrections must never turn the whole heartbeat into
    // a 500 and break activation checks for everyone — worst case here is
    // just "no corrections delivered this check-in", not an outage.
    let pendingCorrections = [];
    try {
      await ensureCorrectionsTable();
      const pending = await prisma.$queryRaw`
        SELECT "id", "staffId", "date", "reason" FROM "PendingAttendanceCorrection" WHERE "status" = 'pending'
      `;
      pendingCorrections = pending.map(p => ({ id: p.id, staffId: p.staffId, date: p.date, reason: p.reason }));
    } catch (e) { logger.error(`[heartbeat] pendingCorrections fetch failed: ${e.message}`); }

    res.json({
      enabled,
      expiresAt,
      message: map.desktop_sync_message || 'This software is currently inactive. Contact your administrator.',
      // Piggybacked on this same already-proven, already rate-limited
      // heartbeat call rather than adding a second endpoint/polling loop
      // just for update checks — see main_window.py's Update Available
      // banner. Blank/unset on the server = no update-check UI shown.
      latestVersion: map.desktop_app_latest_version || null,
      downloadUrl: map.desktop_app_download_url || null,
      releaseNotes: map.desktop_app_release_notes || null,
      // New, additive field — see app/licensing/client.py's defensive
      // .get("pendingCorrections", []) on the desktop side, which treats a
      // missing field (an older backend) the same as an empty list.
      pendingCorrections,
    });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Manual Attendance Corrections (desktop sync) ─────────────────────────────
// Lets a Super Admin record, from this portal, that a specific staff member
// should count as Present on a specific date despite having no real device
// punch (e.g. they were enrolled a day after attendance tracking started).
// The desktop app picks pending entries up on its next heartbeat, applies
// them locally the next time an Extract actually runs (not immediately —
// this is a software-side correction, not something faked onto the device),
// then reports back which ones landed via POST .../corrections-applied so
// the status/appliedAt below reflect reality, not just "we sent it". New,
// isolated routes — deliberately not touching GET /api/sync/heartbeat itself
// yet (see the small separate addition to that handler once these are
// verified working on their own).
async function ensureCorrectionsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "PendingAttendanceCorrection" (
      "id" SERIAL PRIMARY KEY,
      "staffId" TEXT NOT NULL,
      "date" TEXT NOT NULL,
      "reason" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdBy" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "appliedAt" TIMESTAMPTZ
    )
  `;
}

// GET /api/attendance-corrections — Super Admin only: the audit list (pending + applied)
app.get('/api/attendance-corrections', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user?.role) !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    await ensureCorrectionsTable();
    const rows = await prisma.$queryRaw`
      SELECT "id", "staffId", "date", "reason", "status", "createdBy", "createdAt", "appliedAt"
      FROM "PendingAttendanceCorrection" ORDER BY "createdAt" DESC
    `;
    res.json({ corrections: rows });
  } catch (error) { sendError(res, 500, error.message); }
});

// POST /api/attendance-corrections — Super Admin only. Body: either one
// {staffId, date, reason} or {corrections: [{staffId, date, reason}, ...]}
// for bulk entry. Rows missing staffId/date are silently skipped rather
// than failing the whole batch, so one typo doesn't block the rest.
app.post('/api/attendance-corrections', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user?.role) !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    await ensureCorrectionsTable();
    const entries = Array.isArray(req.body?.corrections) ? req.body.corrections : [req.body];
    const createdBy = req.user?.email || req.user?.name || 'admin';
    const created = [];
    for (const entry of entries) {
      const staffId = String(entry?.staffId || '').trim();
      const date = String(entry?.date || '').trim();
      const reason = String(entry?.reason || '').trim();
      if (!staffId || !date) continue;
      const rows = await prisma.$queryRaw`
        INSERT INTO "PendingAttendanceCorrection" ("staffId", "date", "reason", "createdBy")
        VALUES (${staffId}, ${date}, ${reason}, ${createdBy})
        RETURNING "id", "staffId", "date", "reason", "status", "createdBy", "createdAt", "appliedAt"
      `;
      created.push(rows[0]);
    }
    res.json({ ok: true, created });
  } catch (error) { sendError(res, 500, error.message); }
});

// POST /api/sync/corrections-applied — called by the desktop app itself once
// it has actually folded a correction into a real Extract run locally, NOT
// by a logged-in admin — same shared-secret auth as the heartbeat, matching
// that route's own auth style exactly (wrong/missing key -> plain 404).
app.post('/api/sync/corrections-applied', desktopSyncLimiter, async (req, res) => {
  if (!process.env.DESKTOP_SYNC_KEY || req.headers['x-sync-key'] !== process.env.DESKTOP_SYNC_KEY) {
    return res.status(404).end();
  }
  try {
    await ensureCorrectionsTable();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    // One UPDATE per id rather than a single array-bound query — batches here
    // are always small (a handful of corrections per Extract run at most),
    // and this sidesteps any doubt about how Prisma's raw-query layer binds
    // array parameters against Postgres, which isn't something testable
    // against a real database from this environment.
    for (const id of ids) {
      await prisma.$executeRaw`
        UPDATE "PendingAttendanceCorrection"
        SET "status" = 'applied', "appliedAt" = now()
        WHERE "id" = ${id} AND "status" = 'pending'
      `;
    }
    res.json({ ok: true, applied: ids.length });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Reference Code Pattern Settings ──────────────────────────────────────────
app.get('/api/settings/ref-pattern', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user?.role) !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const keys = ['ref_org_prefix', 'ref_type_cash', 'ref_type_material', 'ref_type_memo'];
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({
      orgPrefix:    map.ref_org_prefix    || 'CSSG',
      typeCash:     map.ref_type_cash     || 'FR',
      typeMaterial: map.ref_type_material || 'MR',
      typeMemo:     map.ref_type_memo     || 'MO',
    });
  } catch (e) { sendError(res, 500, e.message); }
});

app.patch('/api/settings/ref-pattern', authenticateToken, async (req, res) => {
  if (normalizeRole(req.user?.role) !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const { orgPrefix, typeCash, typeMaterial, typeMemo } = req.body || {};
    const updates = [
      { key: 'ref_org_prefix',    value: String(orgPrefix    || 'CSSG').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CSSG' },
      { key: 'ref_type_cash',     value: String(typeCash     || 'FR'  ).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'FR'   },
      { key: 'ref_type_material', value: String(typeMaterial || 'MR'  ).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'MR'   },
      { key: 'ref_type_memo',     value: String(typeMemo     || 'MO'  ).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'MO'   },
    ];
    await Promise.all(updates.map(u =>
      prisma.systemSetting.upsert({ where: { key: u.key }, update: { value: u.value }, create: u })
    ));
    res.json({ ok: true });
  } catch (e) { sendError(res, 500, e.message); }
});

// ── SMS Provider Balances (Termii + Twilio + TextFlow) ───────────────────────
async function getTermiiBalance() {
  const apiKey = process.env.TERMII_API_KEY || process.env.TERMII_SECRET_KEY;
  if (!apiKey) return { configured: false };
  try {
    const resp = await fetch(`https://api.ng.termii.com/api/get-balance?api_key=${encodeURIComponent(apiKey)}`);
    const data = await resp.json().catch(() => ({}));
    logger.info(`[SMS] Termii balance check — status ${resp.status}, body: ${JSON.stringify(data)}`);
    if (!resp.ok) return { configured: true, error: data?.message || `Termii returned status ${resp.status}.` };
    if (data.balance === undefined) return { configured: true, error: data?.message || 'Unexpected response from Termii.' };
    return { configured: true, balance: data.balance, currency: data.currency || 'NGN' };
  } catch (error) {
    logger.warn('[SMS] Termii balance check failed:', error.message);
    return { configured: true, error: error.message };
  }
}

async function getTwilioBalance() {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return { configured: false };
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
    });
    const data = await resp.json().catch(() => ({}));
    logger.info(`[SMS] Twilio balance check — status ${resp.status}, body: ${JSON.stringify(data)}`);
    if (!resp.ok) return { configured: true, error: data?.message || `Twilio returned status ${resp.status}.` };
    return { configured: true, balance: data.balance, currency: data.currency || 'USD' };
  } catch (error) {
    logger.warn('[SMS] Twilio balance check failed:', error.message);
    return { configured: true, error: error.message };
  }
}

async function getTextflowBalance() {
  const apiKey = process.env.TEXTFLOW_API_KEY;
  if (!apiKey) return { configured: false };
  try {
    const resp = await fetch('https://textflow.ng/api/v1/balance', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await resp.json().catch(() => ({}));
    logger.info(`[SMS] TextFlow balance check — status ${resp.status}, body: ${JSON.stringify(data)}`);
    if (!resp.ok) return { configured: true, error: data?.message || `TextFlow returned status ${resp.status}.` };
    const bal = data?.data?.balance;
    if (bal === undefined) return { configured: true, error: data?.message || 'Unexpected response from TextFlow.' };
    return { configured: true, balance: bal, currency: data?.data?.currency || 'NGN' };
  } catch (error) {
    logger.warn('[SMS] TextFlow balance check failed:', error.message);
    return { configured: true, error: error.message };
  }
}

app.get('/api/admin/sms-balance', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const [termii, twilio, textflow, provider, tThreshRow, wThreshRow, tfThreshRow] = await Promise.all([
      getTermiiBalance(),
      getTwilioBalance(),
      getTextflowBalance(),
      getSmsProvider(),
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_termii_threshold' } }),
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_twilio_threshold' } }),
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_textflow_threshold' } }),
    ]);
    const termiiThreshold    = parseFloat(tThreshRow?.value)  || 1000;
    const twilioThreshold    = parseFloat(wThreshRow?.value)  || 5;
    const textflowThreshold  = parseFloat(tfThreshRow?.value) || 1000;
    if (termii.balance   !== undefined) termii.belowThreshold   = parseFloat(termii.balance)   < termiiThreshold;
    if (twilio.balance   !== undefined) twilio.belowThreshold   = parseFloat(twilio.balance)   < twilioThreshold;
    if (textflow.balance !== undefined) textflow.belowThreshold = parseFloat(textflow.balance) < textflowThreshold;
    res.json({ termii, twilio, textflow, provider, thresholds: { termii: termiiThreshold, twilio: twilioThreshold, textflow: textflowThreshold } });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// ── SMS Balance Alert Monitor ─────────────────────────────────────────────────
// Runs every 2 hours. If Termii < threshold (₦) or Twilio < threshold ($),
// sends an SMS (trying both providers) + email to the configured admin phone
// and SUPER_ADMIN_EMAIL. Repeats every 2 h while still below threshold.
const _smsAlertLastSent = { termii: 0, twilio: 0, textflow: 0 };
const SMS_ALERT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

async function _getAdminAlertPhones() {
  try {
    const row = await prisma.systemSetting.findFirst({ where: { key: 'admin_alert_phone' } });
    if (!row?.value) return [];
    const val = row.value.trim();
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : (val ? [val] : []);
    } catch { return val ? [val] : []; }
  } catch { return []; }
}

async function _getAdminAlertEmails() {
  const emails = new Set();
  if (SUPER_ADMIN_EMAIL) emails.add(SUPER_ADMIN_EMAIL);
  try {
    const row = await prisma.systemSetting.findFirst({ where: { key: 'admin_alert_emails' } });
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      if (Array.isArray(parsed)) parsed.filter(Boolean).forEach(e => emails.add(e));
    }
  } catch {}
  return [...emails];
}

async function _getSmsAlertThresholds() {
  try {
    const [tRow, wRow, tfRow] = await Promise.all([
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_termii_threshold' } }),
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_twilio_threshold' } }),
      prisma.systemSetting.findFirst({ where: { key: 'sms_alert_textflow_threshold' } }),
    ]);
    return { termii: parseFloat(tRow?.value) || 1000, twilio: parseFloat(wRow?.value) || 5, textflow: parseFloat(tfRow?.value) || 1000 };
  } catch { return { termii: 1000, twilio: 5, textflow: 1000 }; }
}

async function _sendBalanceAlertSms(phones, message) {
  if (!phones?.length) return;
  for (const phone of phones) {
    const tRes = await sendTermiiSms({ to: phone, message });
    if (!tRes?.error && !tRes?.skipped) continue;
    const tfRes = await sendTextflowSms({ to: phone, message });
    if (!tfRes?.error && !tfRes?.skipped) continue;
    await sendTwilioSms({ to: phone, message });
  }
}

async function checkSmsBalancesAndAlert() {
  try {
    const [termiiData, twilioData, textflowData, thresholds, phones, emails] = await Promise.all([
      getTermiiBalance(), getTwilioBalance(), getTextflowBalance(), _getSmsAlertThresholds(),
      _getAdminAlertPhones(), _getAdminAlertEmails(),
    ]);
    const now = Date.now();

    if (termiiData.configured && !termiiData.error && termiiData.balance !== undefined) {
      const bal = parseFloat(termiiData.balance);
      if (bal < thresholds.termii && now - _smsAlertLastSent.termii > SMS_ALERT_COOLDOWN_MS) {
        _smsAlertLastSent.termii = now;
        logger.warn(`[SMS-ALERT] Termii balance ₦${bal} below threshold ₦${thresholds.termii} — alerting ${phones.length} phone(s), ${emails.length} email(s)`);
        const msg = `⚠️ CSS RMS ALERT: Termii SMS balance is ₦${bal}. Threshold: ₦${thresholds.termii}. Top up now to avoid OTP failures. Repeats every 2h.`;
        await _sendBalanceAlertSms(phones, msg);
        for (const toEmail of emails) {
          const { text, html } = buildEmailContent({
            title: '⚠️ Termii SMS Balance Low',
            lines: [`Current balance: ₦${bal}`, `Alert threshold: ₦${thresholds.termii}`, 'Top up immediately — zero balance blocks all department account activations.', 'This alert repeats every 2 hours until the balance is above threshold.'],
            actionUrl: APP_BASE_URL || '', actionLabel: 'Open RMS Dashboard',
          });
          await sendEmail({ to: toEmail, subject: '⚠️ CSS RMS — Termii SMS Balance Low', text, html }).catch(e => logger.error('[SMS-ALERT] email failed:', e.message));
        }
      }
    }

    if (twilioData.configured && !twilioData.error && twilioData.balance !== undefined) {
      const bal = parseFloat(twilioData.balance);
      if (bal < thresholds.twilio && now - _smsAlertLastSent.twilio > SMS_ALERT_COOLDOWN_MS) {
        _smsAlertLastSent.twilio = now;
        logger.warn(`[SMS-ALERT] Twilio balance $${bal} below threshold $${thresholds.twilio} — alerting ${phones.length} phone(s), ${emails.length} email(s)`);
        const msg = `⚠️ CSS RMS ALERT: Twilio balance is $${bal} USD. Threshold: $${thresholds.twilio}. Top up to prevent SMS failures. Repeats every 2h.`;
        await _sendBalanceAlertSms(phones, msg);
        for (const toEmail of emails) {
          const { text, html } = buildEmailContent({
            title: '⚠️ Twilio Balance Low',
            lines: [`Current balance: $${bal} USD`, `Alert threshold: $${thresholds.twilio} USD`, 'Top up your Twilio account to prevent SMS delivery failures.', 'This alert repeats every 2 hours until the balance is above threshold.'],
            actionUrl: APP_BASE_URL || '', actionLabel: 'Open RMS Dashboard',
          });
          await sendEmail({ to: toEmail, subject: '⚠️ CSS RMS — Twilio Balance Low', text, html }).catch(e => logger.error('[SMS-ALERT] email failed:', e.message));
        }
      }
    }

    if (textflowData.configured && !textflowData.error && textflowData.balance !== undefined) {
      const bal = parseFloat(textflowData.balance);
      if (bal < thresholds.textflow && now - _smsAlertLastSent.textflow > SMS_ALERT_COOLDOWN_MS) {
        _smsAlertLastSent.textflow = now;
        logger.warn(`[SMS-ALERT] TextFlow balance ₦${bal} below threshold ₦${thresholds.textflow} — alerting ${phones.length} phone(s), ${emails.length} email(s)`);
        const msg = `⚠️ CSS RMS ALERT: TextFlow SMS balance is ₦${bal}. Threshold: ₦${thresholds.textflow}. Top up now to avoid SMS failures. Repeats every 2h.`;
        await _sendBalanceAlertSms(phones, msg);
        for (const toEmail of emails) {
          const { text, html } = buildEmailContent({
            title: '⚠️ TextFlow SMS Balance Low',
            lines: [`Current balance: ₦${bal}`, `Alert threshold: ₦${thresholds.textflow}`, 'Top up immediately — zero balance blocks SMS delivery.', 'This alert repeats every 2 hours until the balance is above threshold.'],
            actionUrl: APP_BASE_URL || '', actionLabel: 'Open RMS Dashboard',
          });
          await sendEmail({ to: toEmail, subject: '⚠️ CSS RMS — TextFlow SMS Balance Low', text, html }).catch(e => logger.error('[SMS-ALERT] email failed:', e.message));
        }
      }
    }
  } catch (err) {
    logger.error('[SMS-ALERT] Balance check error:', err.message);
  }
}

// Warm-up delay then every 2 h
setTimeout(() => {
  checkSmsBalancesAndAlert();
  setInterval(checkSmsBalancesAndAlert, SMS_ALERT_COOLDOWN_MS);
}, 5 * 60 * 1000);

// ── Print Access Settings ─────────────────────────────────────────────────────
// GET  /api/admin/print-settings  — returns all depts with canPrint + global showStamp
app.get('/api/admin/print-settings', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const [depts, stampRows, sigRows, govRows] = await Promise.all([
      prisma.department.findMany({
        select: { id: true, name: true, canPrint: true },
        orderBy: { name: 'asc' }
      }),
      prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'show_stamp_on_pdf' LIMIT 1`.catch(() => []),
      prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'show_signature_on_pdf' LIMIT 1`.catch(() => []),
      prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'require_governance_setup' LIMIT 1`.catch(() => [])
    ]);
    const showStamp = (stampRows?.[0]?.value ?? 'true') !== 'false';
    const showSignature = (sigRows?.[0]?.value ?? 'true') !== 'false';
    const requireGovernance = (govRows?.[0]?.value ?? 'true') !== 'false';
    res.json({ departments: depts, showStamp, showSignature, requireGovernance });
  } catch (error) { sendError(res, 500, error.message); }
});

// POST /api/admin/hard-reset — nuclear option: wipe selected data categories
app.post('/api/admin/hard-reset', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only.' });
  try {
    const { confirmText, options = {} } = req.body;
    if (confirmText !== 'CONFIRM HARD RESET') return res.status(400).json({ error: 'Type "CONFIRM HARD RESET" exactly to confirm.' });

    const { requisitions = false, subAccounts = false, deptActivations = false,
            activityLogs = false, chatMessages = false, storeRecords = false, notifications = false } = options;

    const summary = {};

    if (requisitions) {
      // Delete in FK-safe order (children before parents)
      await prisma.fileAccessLog.deleteMany({});
      await prisma.signatureRecord.deleteMany({});
      await prisma.approval.deleteMany({});
      await prisma.attachment.deleteMany({});
      await prisma.vettingEvent.deleteMany({});
      await prisma.forwardEvent.deleteMany({});
      await prisma.requisitionTag.deleteMany({});
      await prisma.requisitionSubVisibility.deleteMany({});
      const { count: reqCount } = await prisma.requisition.deleteMany({});
      const { count: memoCount } = await prisma.memo.deleteMany({});
      summary.requisitions = reqCount;
      summary.memos = memoCount;
    }

    if (subAccounts) {
      // Remove FK-linked records for sub-accounts before deleting them
      const subs = await prisma.department.findMany({ where: { isSubAccount: true }, select: { id: true } });
      const subIds = subs.map(s => s.id);
      if (subIds.length) {
        // 1. Unlink users whose departmentId points to a sub-account (non-nullable FK blocker)
        await prisma.user.updateMany({ where: { departmentId: { in: subIds } }, data: { departmentId: null } });

        // 2. Chat messages: fromDeptId is non-nullable so we must delete them
        //    Handle self-referential replyToId before deletion
        const subMsgIds = (await prisma.chatMessage.findMany({
          where: { OR: [{ fromDeptId: { in: subIds } }, { toDeptId: { in: subIds } }] },
          select: { id: true }
        })).map(m => m.id);
        if (subMsgIds.length) {
          await prisma.chatMessage.updateMany({ where: { replyToId: { in: subMsgIds } }, data: { replyToId: null } });
          await prisma.chatMessage.deleteMany({ where: { id: { in: subMsgIds } } });
        }

        // 3. If requisitions weren't cleared globally, clear sub-account requisitions in FK-safe order
        if (!requisitions) {
          const subReqIds = (await prisma.requisition.findMany({ where: { departmentId: { in: subIds } }, select: { id: true } })).map(r => r.id);
          if (subReqIds.length) {
            await prisma.fileAccessLog.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.signatureRecord.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.approval.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.attachment.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.vettingEvent.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.forwardEvent.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.requisitionTag.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.requisitionSubVisibility.deleteMany({ where: { requisitionId: { in: subReqIds } } });
            await prisma.requisition.deleteMany({ where: { id: { in: subReqIds } } });
          }
        }

        // 4. ForwardEvents from sub-accounts not yet removed (if requisitions weren't cleared)
        await prisma.forwardEvent.deleteMany({ where: { fromDeptId: { in: subIds } } });

        // 5. Core FK records
        await prisma.departmentKey.deleteMany({ where: { departmentId: { in: subIds } } });
        await prisma.departmentStamp.deleteMany({ where: { departmentId: { in: subIds } } });
        await prisma.notification.deleteMany({ where: { departmentId: { in: subIds } } });
        await prisma.pushSubscription.deleteMany({ where: { deptId: { in: subIds } } });
        const { count: subCount } = await prisma.department.deleteMany({ where: { id: { in: subIds } } });
        summary.subAccounts = subCount;
      } else {
        summary.subAccounts = 0;
      }
    }

    if (deptActivations) {
      // Restore each dept's original admin-set access code (rehash accessCodeLabel) and wipe personal info
      // Note: mode:'insensitive' is not supported inside `not` in Prisma v6 — filter in JS instead
      const allDepts = await prisma.department.findMany({
        where: { isSubAccount: false },
        select: { id: true, name: true, accessCodeLabel: true, accessCode: true, headEmail: true }
      });
      const depts = allDepts.filter(d => d.name.toLowerCase() !== 'super admin');

      // Delete UserSignature records for all current head users before clearing headEmail
      const headEmails = depts.map(d => d.headEmail).filter(Boolean);
      if (headEmails.length) {
        const headUsers = await prisma.user.findMany({
          where: { email: { in: headEmails } },
          select: { id: true },
        });
        const headUserIds = headUsers.map(u => u.id);
        if (headUserIds.length) {
          await prisma.userSignature.deleteMany({ where: { userId: { in: headUserIds } } });
        }
      }
      // Also wipe DepartmentStamp (corporate seal overrides) for all non-super-admin depts
      await prisma.departmentStamp.deleteMany({ where: { departmentId: { in: depts.map(d => d.id) } } });

      let deptCount = 0;
      for (const d of depts) {
        // Prefer accessCodeLabel (the "original code" store); fall back to the legacy
        // plain-text accessCode column for departments that predate the label column.
        const codeToRestore = d.accessCodeLabel || d.accessCode;
        const data = { headName: null, headTitle: null, headEmail: null, phone: null, address: null, staffId: null, codeChangedByDept: false };
        if (codeToRestore) {
          data.accessCodeHash = await bcrypt.hash(codeToRestore, 10);
          // Backfill accessCodeLabel so future resets always work without the fallback
          if (!d.accessCodeLabel) data.accessCodeLabel = codeToRestore;
        }
        await prisma.department.update({ where: { id: d.id }, data });
        deptCount++;
      }
      summary.deptActivationsReset = deptCount;
    }

    if (activityLogs) {
      const { count } = await prisma.activityLog.deleteMany({});
      summary.activityLogs = count;
    }

    if (chatMessages) {
      // Clear self-referential links before deleting
      await prisma.chatMessage.updateMany({ where: {}, data: { replyToId: null } });
      const { count } = await prisma.chatMessage.deleteMany({});
      summary.chatMessages = count;
    }

    if (storeRecords) {
      await prisma.storeRecordEntry.deleteMany({});
      const { count } = await prisma.storeRecord.deleteMany({});
      summary.storeRecords = count;
    }

    if (notifications) {
      const { count: nCount } = await prisma.notification.deleteMany({});
      const { count: psCount } = await prisma.pushSubscription.deleteMany({});
      summary.notifications = nCount;
      summary.pushSubscriptions = psCount;
    }

    // Clear deleted records bin if requisitions were cleared
    if (requisitions) {
      await prisma.deletedRecord.deleteMany({});
    }

    await prisma.activityLog.create({ data: { action: 'Hard Reset', details: `System hard reset executed by Super Admin. Summary: ${JSON.stringify(summary)}` } }).catch(() => {});
    logger.warn('[HARD RESET] System reset executed', summary);
    res.json({ success: true, summary });
  } catch (error) { sendError(res, 500, error.message); }
});

// POST /api/admin/print-settings  — bulk-save canPrint list + stamp/signature/governance flags
app.post('/api/admin/print-settings', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const { canPrintIds, showStamp, showSignature, requireGovernance } = req.body || {};
    if (!Array.isArray(canPrintIds)) return res.status(400).json({ error: 'canPrintIds must be an array' });
    // Update all departments: enable canPrint for those in the list, disable for the rest
    const allDepts = await prisma.department.findMany({ select: { id: true } });
    await prisma.$transaction(
      allDepts.map(d => prisma.department.update({
        where: { id: d.id },
        data: { canPrint: canPrintIds.includes(d.id) }
      }))
    );
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SystemSetting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '')`;
    const upsertSetting = async (key, val) => {
      if (typeof val !== 'boolean') return;
      await prisma.$executeRaw`
        INSERT INTO "SystemSetting" ("key", "value") VALUES (${key}, ${val ? 'true' : 'false'})
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
      `;
    };
    await Promise.all([
      upsertSetting('show_stamp_on_pdf', showStamp),
      upsertSetting('show_signature_on_pdf', showSignature),
      upsertSetting('require_governance_setup', requireGovernance),
    ]);
    res.json({ ok: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// GET /api/settings/print-access  — returns current dept's canPrint + global showStamp (any dept user)
app.get('/api/settings/print-access', authenticateToken, async (req, res) => {
  try {
    const deptId = req.user?.deptId ? parseInt(req.user.deptId) : null;
    let canPrint = true;
    if (deptId) {
      const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { canPrint: true } });
      canPrint = dept?.canPrint ?? true;
    }
    const stampRows = await prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'show_stamp_on_pdf' LIMIT 1`.catch(() => []);
    const showStamp = (stampRows?.[0]?.value ?? 'true') !== 'false';
    res.json({ canPrint, showStamp });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/departments/:id/activation', authenticateToken, async (req, res) => {
  try {
    const deptIdParam = parseInt(req.params.id);
    const userRole = normalizeRole(req.user.role);
    if (userRole !== 'global_admin') {
      const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
      if (userDeptId !== deptIdParam) return res.status(403).json({ error: 'Access denied' });
    }
    const dept = await prisma.department.findUnique({
      where: { id: deptIdParam },
      select: { id: true, name: true, headName: true, headEmail: true }
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    res.json({ activated: Boolean(dept.headEmail), departmentName: dept.name, headName: dept.headName, headEmail: dept.headEmail });
  } catch (error) { sendError(res, 500, error.message); }
});

// Creator clarification comment on a returned requisition (fields stay locked)
app.post('/api/requisitions/:id/creator-comment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (await blockIfIccFrozen(parseInt(id), res)) return;
    const parsed = z.object({ comment: z.string().min(1) }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Comment text is required' });
    const { comment } = parsed.data;

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const requisition = await prisma.requisition.findUnique({ where: { id: parseInt(id) } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    if (!isAdmin) {
      if (requisition.departmentId !== userDeptId) {
        return res.status(403).json({ error: 'Only the creator department may add a clarification comment' });
      }
      if (requisition.targetDepartmentId !== userDeptId) {
        return res.status(403).json({ error: 'Requisition has not been returned to your department' });
      }
    }

    await prisma.forwardEvent.create({
      data: {
        requisitionId: parseInt(id),
        fromDeptId: userDeptId,
        toDeptId: userDeptId,
        action: 'commented',
        note: comment,
        actorName: req.user?.name || 'Creator'
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Creator Comment Added',
        details: `Req #${id}: clarification comment added by creator.`
      }
    });

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── KIV (Keep In View) — holder or ICC puts request on hold ───────────────────
app.post('/api/requisitions/:id/kiv', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const { note } = req.body || {};
    const userDeptId = req.user?.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const isIcc = isIccDept(req.user?.name);
    // ICC acts immediately on any request; non-ICC blocked when frozen
    if (!isIcc && await blockIfIccFrozen(reqId, res)) return;
    const requisition = await prisma.requisition.findUnique({ where: { id: reqId } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });
    const isHolder = userDeptId && (
      requisition.targetDepartmentId === userDeptId ||
      requisition.currentVettingDeptId === userDeptId ||
      requisition.finalApprovedByDeptId === userDeptId
    );
    if (!isAdmin && !isIcc && !isHolder) return res.status(403).json({ error: 'Only the current holder may KIV this request.' });
    if (!note?.trim()) return res.status(400).json({ error: 'A reason is required to place this request on hold.' });
    await prisma.requisition.update({
      where: { id: reqId },
      data: { isKIV: true, kivNote: note.trim(), kivAt: new Date(), kivByName: req.user?.name || null }
    });
    broadcastUpdate(reqId, { action: 'kiv', fromDept: req.user?.name || '' });
    res.json({ ok: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/requisitions/:id/un-kiv', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user?.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const isIcc = isIccDept(req.user?.name);
    if (!isIcc && await blockIfIccFrozen(reqId, res)) return;
    const requisition = await prisma.requisition.findUnique({ where: { id: reqId } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });
    const isHolder = userDeptId && (
      requisition.targetDepartmentId === userDeptId ||
      requisition.currentVettingDeptId === userDeptId ||
      requisition.finalApprovedByDeptId === userDeptId
    );
    if (!isAdmin && !isIcc && !isHolder) return res.status(403).json({ error: 'Not authorized.' });
    await prisma.requisition.update({
      where: { id: reqId },
      data: { isKIV: false, kivNote: null, kivAt: null, kivByName: null }
    });
    broadcastUpdate(reqId, { action: 'un-kiv', fromDept: req.user?.name || '' });
    res.json({ ok: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// Toggle sub-account visibility — dept head only, on their own (non-sub-account) department's requests
// Get current sub-account visibility state for a request (which sub-accounts can see it)
app.get('/api/requisitions/:id/sub-visibility', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const role = normalizeRole(req.user?.role);
    if (role !== 'department' || req.user?.isSubAccount) {
      return res.status(403).json({ error: 'Only department heads can view sub-account visibility.' });
    }
    const deptId = parseInt(req.user.deptId);
    const existing = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { departmentId: true, visibleToSubAccounts: true }
    });
    if (!existing) return res.status(404).json({ error: 'Requisition not found.' });
    if (existing.departmentId !== deptId) return res.status(403).json({ error: 'Access denied.' });
    let specificIds = [];
    try {
      const rows = await prisma.requisitionSubVisibility.findMany({
        where: { requisitionId: reqId },
        select: { subAccountId: true }
      });
      specificIds = rows.map(r => r.subAccountId);
    } catch (_) { /* table not yet migrated */ }
    const subAccounts = await prisma.department.findMany({
      where: { parentId: deptId, isSubAccount: true, isDeleted: false },
      select: { id: true, name: true, headName: true }
    });
    res.json({
      visibleToAll: existing.visibleToSubAccounts,
      specificIds,
      subAccounts
    });
  } catch (err) { sendError(res, 500, err.message); }
});

// Set sub-account visibility: selectAll=true → all sub-units; selectAll=false + subAccountIds → specific ones; empty → hidden
app.patch('/api/requisitions/:id/sub-account-visibility', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const role = normalizeRole(req.user?.role);
    if (role !== 'department' || req.user?.isSubAccount) {
      return res.status(403).json({ error: 'Only department heads can control sub-account visibility.' });
    }
    const deptId = parseInt(req.user.deptId);
    const existing = await prisma.requisition.findUnique({ where: { id: reqId }, select: { departmentId: true, department: { select: { isSubAccount: true } } } });
    if (!existing) return res.status(404).json({ error: 'Requisition not found.' });
    if (existing.departmentId !== deptId) return res.status(403).json({ error: 'You can only control visibility of your own department\'s requests.' });
    if (existing.department?.isSubAccount) return res.status(400).json({ error: 'Sub-account requests cannot use this feature.' });

    const { selectAll, subAccountIds = [] } = req.body;
    const ids = Array.isArray(subAccountIds) ? subAccountIds.map(Number).filter(n => !isNaN(n)) : [];

    if (selectAll) {
      // Visible to ALL sub-accounts — set boolean flag, clear junction records
      await prisma.requisition.update({ where: { id: reqId }, data: { visibleToSubAccounts: true } });
      try { await prisma.requisitionSubVisibility.deleteMany({ where: { requisitionId: reqId } }); } catch (_) {}
    } else if (ids.length > 0) {
      // Visible to specific sub-accounts only — clear boolean flag, write junction records
      await prisma.requisition.update({ where: { id: reqId }, data: { visibleToSubAccounts: false } });
      try {
        await prisma.requisitionSubVisibility.deleteMany({ where: { requisitionId: reqId } });
        await prisma.requisitionSubVisibility.createMany({
          data: ids.map(subAccountId => ({ requisitionId: reqId, subAccountId })),
          skipDuplicates: true
        });
      } catch (_) {}
    } else {
      // Hidden from all sub-accounts
      await prisma.requisition.update({ where: { id: reqId }, data: { visibleToSubAccounts: false } });
      try { await prisma.requisitionSubVisibility.deleteMany({ where: { requisitionId: reqId } }); } catch (_) {}
    }

    const updated = await prisma.requisition.findUnique({ where: { id: reqId }, select: { visibleToSubAccounts: true } });
    let updatedSpecificIds = [];
    try {
      const rows = await prisma.requisitionSubVisibility.findMany({ where: { requisitionId: reqId }, select: { subAccountId: true } });
      updatedSpecificIds = rows.map(r => r.subAccountId);
    } catch (_) {}
    broadcastUpdate(reqId, { action: 'visibility-updated' });
    res.json({
      id: reqId,
      visibleToSubAccounts: updated.visibleToSubAccounts,
      specificIds: updatedSpecificIds
    });
  } catch (err) { sendError(res, 500, err.message); }
});

// Forward / Return-to-Sender a requisition (target department response)
app.post('/api/requisitions/:id/forward', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (await blockIfIccFrozen(parseInt(id), res)) return;
    const parsed = z.object({
      targetDepartmentId: z.number().nullable().optional(),
      note: z.string().optional(),
      returnToSender: z.boolean().optional()
    }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { targetDepartmentId, note, returnToSender } = parsed.data;

    const requisition = await prisma.requisition.findUnique({
      where: { id: parseInt(id) },
      include: { department: true, targetDepartment: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    // Only the current target department or admin may forward/return
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    if (!isAdmin && userDeptId !== requisition.targetDepartmentId) {
      return res.status(403).json({ error: 'Only the current target department may forward or return' });
    }

    const newTargetId = returnToSender ? null : (targetDepartmentId ?? null);

    // When returning, find who LAST sent the document to the current holder —
    // explicitly excluding self-loop events (fromDeptId === currentDept) so that
    // previously created bad ISAC→ISAC events don't pollute the lookup.
    const currentHolderDeptId = userDeptId ?? requisition.targetDepartmentId;
    let returnTargetId = requisition.departmentId; // fallback: original creator
    if (returnToSender) {
      const lastInbound = await prisma.forwardEvent.findFirst({
        where: {
          requisitionId: parseInt(id),
          toDeptId: currentHolderDeptId,
          NOT: { fromDeptId: currentHolderDeptId }  // skip self-loop events
        },
        orderBy: { createdAt: 'desc' }
      });
      if (lastInbound?.fromDeptId) {
        returnTargetId = lastInbound.fromDeptId;
      }
    } else {
      returnTargetId = newTargetId;
    }

    // If forwarding to Account on an approved requisition, auto-activate vetting
    // mode so Account always sees the Treat panel regardless of routing path.
    let extraVettingData = {};
    if (!returnToSender && returnTargetId && requisition.finalApprovalStatus === 'approved') {
      const targetDept = await prisma.department.findUnique({
        where: { id: returnTargetId }, select: { name: true }
      });
      if (targetDept && /\baccount\b/i.test(targetDept.name)) {
        extraVettingData = { currentVettingDeptId: returnTargetId };
      }
    }

    const updated = await prisma.requisition.update({
      where: { id: parseInt(id) },
      data: {
        targetDepartmentId: returnTargetId,
        forwardNote: note || null,
        ...extraVettingData
      },
      include: { department: true, targetDepartment: true }
    });

    // Record ForwardEvent for the chain
    try {
      await prisma.forwardEvent.create({
        data: {
          requisitionId: parseInt(id),
          fromDeptId: userDeptId || requisition.targetDepartmentId || requisition.departmentId,
          toDeptId: returnTargetId,
          action: returnToSender ? 'returned' : 'forwarded',
          note: note || null,
          actorName: req.user?.name || 'Department'
        }
      });
    } catch (fwdErr) { logger.warn('[FWD] Forward event creation failed:', fwdErr.message); }

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: returnToSender ? 'Requisition Returned' : 'Requisition Forwarded',
        details: `Req #${id}: ${returnToSender ? 'returned to sender' : `forwarded to dept #${newTargetId}`}. Note: ${note || 'none'}`
      }
    });

    broadcastUpdate(parseInt(id), {
      action: returnToSender ? 'returned' : 'forwarded',
      fromDept: requisition.targetDepartment?.name || req.user?.name || 'Department',
      toDept: returnToSender
        ? (updated.department?.name || 'Originator')
        : (updated.targetDepartment?.name || 'Department')
    });
    res.json(updated);

    // Fire notifications in background — must not block the HTTP response
    if (!returnToSender && newTargetId) {
      notifyDepartmentHead({
        departmentId: newTargetId,
        requisition: updated,
        subject: `📋 Forwarded Requisition: ${updated.title}`,
        lines: [
          `Originally From: ${updated.department?.name || 'Department'}`,
          `Forwarded By: ${requisition.targetDepartment?.name || 'Department'}`,
          `Forwarded To: ${updated.targetDepartment?.name || 'Department'}`,
          `Type: ${updated.type}`,
          amountLine(updated.type, updated.amount),
          note ? `Note: ${note}` : null
        ].filter(Boolean)
      }).catch(() => {});
    }

    if (returnToSender && updated.departmentId) {
      notifyDepartmentHead({
        departmentId: updated.departmentId,
        requisition: updated,
        subject: `⚠️ Requisition Returned: ${updated.title}`,
        lines: [
          `Your requisition has been returned for clarification.`,
          `Returned By: ${requisition.targetDepartment?.name || 'Department'}`,
          note ? `Reason: ${note}` : `Please review the requisition for details.`
        ].filter(Boolean)
      }).catch(() => {});
    }

    pushToTaggedDepts(parseInt(id), { title: 'Requisition Updated', body: `Req #${id} has been ${returnToSender ? 'returned' : 'forwarded'}.`, url: `/?req=${id}` });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Final Approve ─────────────────────────────────────────────────────────────
app.post('/api/requisitions/:id/final-approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqId = parseInt(id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const parsed = z.object({ note: z.string().optional() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const { note } = parsed.data;

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    // Load dept name to check authority — for sub-accounts, use parent dept name
    let deptName = req.user.deptName || req.user.name || '';
    if (!deptName && userDeptId) {
      const d = await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } });
      deptName = d?.name || '';
    }
    let authorityDeptName = deptName;
    let isPrivilegedSubAccount = false;
    if (req.user.isSubAccount && req.user.parentDeptId) {
      const parentDept = await prisma.department.findUnique({
        where: { id: parseInt(req.user.parentDeptId) },
        select: { name: true }
      });
      if (parentDept) authorityDeptName = parentDept.name;
    }

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, amount: true, type: true, finalApprovalStatus: true, hasAuditOverride: true, auditAmount: true }
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    if (requisition.finalApprovalStatus && requisition.finalApprovalStatus !== 'none') {
      return res.status(409).json({ error: 'This requisition has already been finally approved.' });
    }

    const isMaterial = /^material/i.test(requisition.type || '');
    const effectiveAmount = getEffectiveReqAmount(requisition);

    // Check if sub-account has privilege for this request type
    if (req.user.isSubAccount && req.user.parentDeptId) {
      const subPriv = await getSubPrivilege(userDeptId);
      if (isMaterial) {
        if (subPriv.materialPrivilege || req.user.materialPrivilege) isPrivilegedSubAccount = true;
      } else if (/^memo/i.test(requisition.type || '')) {
        if (subPriv.memoPrivilege || req.user.memoPrivilege) isPrivilegedSubAccount = true;
      } else {
        // Cash
        const privLimit = req.user.privilegeAmount != null ? parseFloat(req.user.privilegeAmount) : subPriv.privilegeAmount;
        if (privLimit != null && effectiveAmount <= privLimit) isPrivilegedSubAccount = true;
      }
    }

    const authority = isAdmin ? 'chairman' : checkFinalApproveAuthority(authorityDeptName, isMaterial ? 0 : effectiveAmount, isMaterial);
    if (!authority && !isPrivilegedSubAccount) {
      return res.status(403).json({ error: `Your department does not have authority to final-approve this amount.` });
    }
    // Sub-account must have privilege AND parent dept must have authority
    if (isPrivilegedSubAccount && !isAdmin && !checkFinalApproveAuthority(authorityDeptName, isMaterial ? 0 : effectiveAmount, isMaterial)) {
      return res.status(403).json({ error: `Your parent department does not have authority to final-approve this amount.` });
    }

    const updated = await prisma.requisition.update({
      where: { id: reqId },
      data: {
        finalApprovalStatus: 'approved',
        finalApprovedByDeptId: userDeptId || null,
        finalApprovedAt: new Date(),
        finalApprovedNote: note || null
      },
      include: {
        department: { select: { name: true } },
        targetDepartment: { select: { name: true } }
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Final Approval',
        details: `Req #${id} finally approved by ${deptName}. Note: ${note || 'none'}`
      }
    });

    broadcastUpdate(reqId, { action: 'finally_approved', fromDept: deptName });
    pushToTaggedDepts(reqId, { title: 'Requisition Finally Approved', body: `Req #${id} has been finally approved.`, url: `/?req=${reqId}` });
    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Re-approval — confirms a price revision that exceeded the original approver's band ──
// Only the department whose tier actually covers the current amount (or admin) may clear
// the flag. Does NOT re-run the full final-approval workflow — it's a one-click
// acknowledgement that the higher authority has seen and accepts the revised amount.
// ── Forward for re-approval — the only action available while needsReapproval is set ──
// Routes the request to whoever actually holds the required tier (GM or Chairman), so it
// lands in their queue instead of requiring them to stumble onto it independently.
app.post('/api/requisitions/:id/forward-for-reapproval', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const effectiveDeptId = req.user.isSubAccount ? parseInt(req.user.parentDeptId) : userDeptId;

    const requisition = await prisma.requisition.findUnique({ where: { id: reqId } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });
    if (!requisition.needsReapproval) return res.status(400).json({ error: 'This request is not awaiting re-approval.' });

    const holdsIt = isAdmin
      || requisition.currentVettingDeptId === effectiveDeptId
      || requisition.targetDepartmentId === effectiveDeptId;
    if (!holdsIt) return res.status(403).json({ error: 'Your department does not currently hold this requisition.' });

    const authorityDept = await resolveAuthorityDept(requisition.reapprovalAuthority);
    if (!authorityDept) {
      return res.status(500).json({ error: `No ${(requisition.reapprovalAuthority || 'authority').toUpperCase()} department found in the system.` });
    }

    await prisma.requisition.update({
      where: { id: reqId },
      data: { currentVettingDeptId: authorityDept.id, reapprovalForwardedFromDeptId: effectiveDeptId || null }
    });

    const actingDept = effectiveDeptId
      ? await prisma.department.findUnique({ where: { id: effectiveDeptId }, select: { name: true } })
      : null;

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: effectiveDeptId || 0,
        deptName: actingDept?.name || 'Department',
        action: 'forwarded_for_reapproval',
        actorName: req.user?.name || actingDept?.name || 'Department',
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Forwarded for Re-Approval',
        details: `Req #${reqId} forwarded to ${authorityDept.name} for ${(requisition.reapprovalAuthority || '').toUpperCase()} re-approval.`
      }
    });

    broadcastUpdate(reqId, { action: 'forwarded_for_reapproval', fromDept: actingDept?.name || 'Department', toDept: authorityDept.name });
    notifyDepartmentHead({
      departmentId: authorityDept.id,
      subject: `Re-Approval Needed — Req #${reqId}`,
      lines: [
        `A request requires your re-approval before it can be treated.`,
        requisition.reapprovalReason || 'The verified amount was revised after final approval.',
      ].filter(Boolean)
    }).catch(() => {});
    pushToTaggedDepts(reqId, { title: 'Re-Approval Needed', body: `Req #${reqId} needs ${authorityDept.name}'s re-approval.`, url: `/?req=${reqId}` });

    res.json({ success: true, forwardedTo: authorityDept.name });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/requisitions/:id/reapprove', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const parsed = z.object({ note: z.string().optional() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
    const { note } = parsed.data;

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    let deptName = req.user.deptName || req.user.name || '';
    if (!deptName && userDeptId) {
      const d = await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } });
      deptName = d?.name || '';
    }
    let authorityDeptName = deptName;
    if (req.user.isSubAccount && req.user.parentDeptId) {
      const parentDept = await prisma.department.findUnique({
        where: { id: parseInt(req.user.parentDeptId) }, select: { name: true }
      });
      if (parentDept) authorityDeptName = parentDept.name;
    }

    const requisition = await prisma.requisition.findUnique({ where: { id: reqId } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });
    if (!requisition.needsReapproval) return res.status(400).json({ error: 'This request is not awaiting re-approval.' });

    const n = authorityDeptName.toLowerCase();
    const tierMatches = {
      gm: /general\s*manager|\bgm\b/i.test(n),
      chairman: /ceo|chairman/i.test(n),
    };
    // Chairman authority always satisfies any required tier; GM only satisfies a GM requirement.
    const satisfies = isAdmin || tierMatches.chairman || (requisition.reapprovalAuthority === 'gm' && tierMatches.gm);
    if (!satisfies) {
      return res.status(403).json({ error: `Only ${(requisition.reapprovalAuthority || 'a higher').toUpperCase()} (or Chairman/Admin) can clear this re-approval.` });
    }

    // Route it straight back to whoever forwarded it here, if anyone did — otherwise leave
    // current routing untouched (e.g. it was confirmed without ever being formally forwarded).
    const returnToDeptId = requisition.reapprovalForwardedFromDeptId || null;
    // Record the exact amount being confirmed — future re-checks compare against this so
    // confirming doesn't get silently undone the next time anyone views the request.
    const confirmedAmount = getEffectiveReqAmount(requisition);

    const updated = await prisma.requisition.update({
      where: { id: reqId },
      data: {
        needsReapproval: false,
        reapprovedAt: new Date(),
        reapprovedByDeptId: userDeptId || null,
        reapprovedAmount: confirmedAmount,
        reapprovalReason: note ? `${requisition.reapprovalReason || ''}\nRe-approved by ${deptName}: ${note}`.trim() : requisition.reapprovalReason,
        reapprovalForwardedFromDeptId: null,
        ...(returnToDeptId ? { currentVettingDeptId: returnToDeptId } : {}),
      }
    });

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: deptName || 'Department',
        action: 'reapproved',
        comment: note || null,
        actorName: req.user?.name || deptName || 'Department',
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Re-Approved',
        details: `Req #${reqId} re-approved by ${deptName}.${note ? ` Note: ${note}` : ''}${returnToDeptId ? ' Routed back for treatment.' : ''}`
      }
    });

    broadcastUpdate(reqId, { action: 'reapproved', fromDept: deptName });
    if (returnToDeptId) {
      notifyDepartmentHead({
        departmentId: returnToDeptId,
        subject: `Re-Approved — Req #${reqId}`,
        lines: [`${deptName} has re-approved this request. You can now treat it.`]
      }).catch(() => {});
    }
    pushToTaggedDepts(reqId, { title: 'Requisition Re-Approved', body: `Req #${reqId} has been re-approved and can now be treated.`, url: `/?req=${reqId}` });
    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Send to Vetting (after final approval) ────────────────────────────────────
app.post('/api/requisitions/:id/send-to-vetting', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqId = parseInt(id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const parsed = z.object({ vettingDeptId: z.number() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'vettingDeptId is required' });
    const { vettingDeptId } = parsed.data;

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, finalApprovedByDeptId: true, finalApprovalStatus: true }
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    if (requisition.finalApprovalStatus !== 'approved') {
      return res.status(400).json({ error: 'Requisition must be finally approved before sending to vetting.' });
    }
    // Allow: the approving dept itself OR a privileged sub-account of that dept
    const isApproverSub = req.user.isSubAccount && req.user.parentDeptId
      && parseInt(req.user.parentDeptId) === requisition.finalApprovedByDeptId;
    if (!isAdmin && userDeptId !== requisition.finalApprovedByDeptId && !isApproverSub) {
      return res.status(403).json({ error: 'Only the final-approving department can send to vetting.' });
    }

    const vettingDept = await prisma.department.findUnique({ where: { id: vettingDeptId }, select: { name: true } });
    if (!vettingDept) return res.status(404).json({ error: 'Vetting department not found' });

    await prisma.requisition.update({
      where: { id: reqId },
      data: {
        currentVettingDeptId: vettingDeptId,
        finalApprovalStatus: 'vetting'
      }
    });

    // Resolve sender's dept name for a clear "Dept A → Dept B" display
    let senderDeptName = '';
    if (userDeptId) {
      const sd = await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } });
      senderDeptName = sd?.name || '';
    }

    // Log the vetting start event using standard model
    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: vettingDeptId,
        deptName: vettingDept.name,
        action: 'sent_to_vetting',
        comment: senderDeptName || req.user?.name || 'System', // store sender dept in comment for display
        actorName: senderDeptName || req.user?.name || 'System'
      }
    });

    // Notify vetting dept — fire-and-forget, do not block response
    notifyDepartmentHead({
      departmentId: vettingDeptId,
      requisition: { id: reqId, title: requisition.title || `Requisition #${id}` },
      subject: `📋 Approved Requisition for Vetting: #${id}`,
      lines: [
        `A finally-approved requisition has been sent to your department for vetting.`
      ]
    }).catch(() => { });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Sent to Vetting',
        details: `Req #${id} sent to ${vettingDept.name} for vetting`
      }
    });

    broadcastUpdate(reqId, { action: 'sent_to_vetting', fromDept: req.user?.name || 'Department', toDept: vettingDept.name });
    pushToTaggedDepts(reqId, { title: 'Requisition Sent to Vetting', body: `Req #${id} has been sent for vetting.`, url: `/?req=${reqId}` });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Vetting Action (comment + optional attachment + forward/treat) ─────────────
app.post('/api/requisitions/:id/vetting-action', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const reqId = parseInt(id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const parsed = z.object({
      action: z.enum(['forward', 'treated', 'return']),
      comment: z.string().optional(),
      nextDeptId: z.union([z.string(), z.number()]).transform(v => parseInt(String(v))).optional(),
      vetted: z.union([z.boolean(), z.string()]).transform(v => v === true || v === 'true').optional().default(false),
      amountDisbursed: z.union([z.string(), z.number()]).transform(v => parseFloat(String(v))).optional(),
      treatmentType: z.enum(['full', 'partial', 'adjusted']).optional(),
      treatmentReason: z.string().optional(),
    }).safeParse(body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid vetting payload' });
    const { action, comment, nextDeptId, vetted, treatmentType, treatmentReason } = parsed.data;

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      include: { finalApprovedByDept: { select: { id: true, name: true } } }
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });

    // Resolve acting dept name — for sub-accounts also resolve parent dept
    const actingDeptRecord = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } })
      : null;
    const isAccountDept = actingDeptRecord && /\baccount\b/i.test(actingDeptRecord.name);

    // Sub-account parent resolution
    let parentDeptRecord = null;
    let isPrivilegedVettingSub = false;
    if (req.user.isSubAccount && req.user.parentDeptId) {
      parentDeptRecord = await prisma.department.findUnique({
        where: { id: parseInt(req.user.parentDeptId) },
        select: { id: true, name: true }
      });
      const subPriv = await getSubPrivilege(userDeptId);
      const effectiveAmt = getEffectiveReqAmount(requisition);
      const isCashReq = /^cash/i.test(requisition.type || '');
      const isMaterialR = /^material/i.test(requisition.type || '');
      const isMemoR = /^memo/i.test(requisition.type || '');

      if (isCashReq) {
        const privLimit = req.user.privilegeAmount != null ? parseFloat(req.user.privilegeAmount) : subPriv.privilegeAmount;
        if (privLimit != null && effectiveAmt <= privLimit) isPrivilegedVettingSub = true;
      } else if (isMaterialR) {
        if (subPriv.materialPrivilege || req.user.materialPrivilege) isPrivilegedVettingSub = true;
      } else if (isMemoR) {
        if (subPriv.memoPrivilege || req.user.memoPrivilege) isPrivilegedVettingSub = true;
      }
    }
    const isParentAccountDept = parentDeptRecord && /\baccount\b/i.test(parentDeptRecord.name);
    const isParentAuditDept = parentDeptRecord && /\baudit\b/i.test(parentDeptRecord.name);
    const parentId = parentDeptRecord ? parseInt(parentDeptRecord.id) : null;

    // Allow: current vetting dept, final approving dept (Chairman), admin,
    // OR Account dept whenever they hold the request on an approved/vetting requisition,
    // OR Account dept holding a Material request,
    // OR privileged sub-account of current vetting dept (Audit/Account sub-accounts)
    const isMaterialReq = /^material/i.test(requisition.type || '');
    const canAct = isAdmin
      || (requisition.currentVettingDeptId === userDeptId)
      || (requisition.finalApprovedByDeptId === userDeptId)
      || (isAccountDept && requisition.targetDepartmentId === userDeptId
          && ['approved', 'vetting', 'partial'].includes(requisition.finalApprovalStatus))
      || (isAccountDept && isMaterialReq && requisition.targetDepartmentId === userDeptId)
      // Account holds a request Audit has already reviewed (override saved) — allow treatment
      // even when finalApprovalStatus is 'none' (Audit forwarded directly to Account)
      || (isAccountDept && requisition.hasAuditOverride && requisition.targetDepartmentId === userDeptId)
      // Privileged Audit sub-account — parent is current vetting dept
      || (isPrivilegedVettingSub && isParentAuditDept && requisition.currentVettingDeptId === parentId)
      // Privileged Account sub-account — parent Account holds the request
      || (isPrivilegedVettingSub && isParentAccountDept
          && requisition.targetDepartmentId === parentId
          && ['approved', 'vetting', 'partial'].includes(requisition.finalApprovalStatus))
      || (isPrivilegedVettingSub && isParentAccountDept && isMaterialReq && requisition.targetDepartmentId === parentId)
      || (isPrivilegedVettingSub && isParentAccountDept && requisition.hasAuditOverride && requisition.targetDepartmentId === parentId);

    if (!canAct) {
      return res.status(403).json({ error: 'You are not authorized to perform vetting actions for this requisition.' });
    }

    // Re-approval escalation — a later price revision (Audit/ICC override) pushed the
    // effective amount past the band of whoever already gave final approval. Re-check
    // live here (not just trust the stored flag) so records whose override predates this
    // control, or drifted for any other reason, are still caught before money moves.
    if (action === 'treated') {
      const liveEscalation = await checkAndApplyReapprovalEscalation(
        reqId, getEffectiveReqAmount(requisition), isMaterialReq, 'a prior price revision'
      ).catch(() => null);
      if (liveEscalation || requisition.needsReapproval) {
        return res.status(403).json({
          error: liveEscalation?.reason || requisition.reapprovalReason || `This request needs ${(liveEscalation?.requiredTier || requisition.reapprovalAuthority || 'higher-tier').toUpperCase()} re-approval before it can be treated — the price was revised after final approval.`
        });
      }
    }

    // ICC Vets Protocol — Account and CEO/Chairman cannot treat a Cash/Material request
    // until ICC has vetted and returned it (Account must use /icc-vet-forward first).
    // Memo requests are unaffected. Either department can be individually exempted via
    // a Super-Admin-controlled System Setting checkbox. Enforced server-side — never trust the UI alone.
    const isMemoReq = /^memo/i.test(requisition.type || '');
    const actorIsAccount = (isAccountDept) || (isPrivilegedVettingSub && isParentAccountDept);
    const isCeoDept = actingDeptRecord && /ceo|chairman/i.test(actingDeptRecord.name);
    const isParentCeoDept = parentDeptRecord && /ceo|chairman/i.test(parentDeptRecord.name);
    const actorIsCeo = isCeoDept || (isPrivilegedVettingSub && isParentCeoDept);

    if (action === 'treated' && !isMemoReq && (actorIsAccount || actorIsCeo) && !requisition.iccVettingCleared) {
      const [
        accountBypassSetting, ceoBypassSetting,
        accountThreshEnabledSetting, accountThreshAmountSetting,
        ceoThreshEnabledSetting, ceoThreshAmountSetting,
      ] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_account_enabled' } }),
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_ceo_enabled' } }),
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_account_threshold_enabled' } }),
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_account_threshold_amount' } }),
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_ceo_threshold_enabled' } }),
        prisma.systemSetting.findUnique({ where: { key: 'icc_bypass_ceo_threshold_amount' } }),
      ]);

      // Effective amount this request would be treated at — same figure used for disbursement.
      const reqAmtForGate = getEffectiveReqAmount(requisition);

      // Master bypass must be on. If a threshold is additionally enabled, the bypass only
      // covers amounts at or below it — anything above still goes through ICC. With no
      // threshold configured, the master bypass covers every amount (act freely).
      let accountBypassed = actorIsAccount && accountBypassSetting?.value === 'true';
      if (accountBypassed && accountThreshEnabledSetting?.value === 'true') {
        const limit = parseFloat(accountThreshAmountSetting?.value);
        if (!isNaN(limit) && reqAmtForGate > limit) accountBypassed = false;
      }

      let ceoBypassed = actorIsCeo && ceoBypassSetting?.value === 'true';
      if (ceoBypassed && ceoThreshEnabledSetting?.value === 'true') {
        const limit = parseFloat(ceoThreshAmountSetting?.value);
        if (!isNaN(limit) && reqAmtForGate > limit) ceoBypassed = false;
      }

      if (!accountBypassed && !ceoBypassed) {
        return res.status(403).json({ error: 'This request must be vetted by ICC before it can be treated. Forward it to ICC first.' });
      }
    }

    let attachmentKey = null;
    let attachmentName = null;
    if (req.file) {
      attachmentKey = generateStorageKey(`vetting/${id}`, req.file.originalname);
      attachmentName = req.file.originalname;
      await putObject({ key: attachmentKey, body: req.file.buffer, contentType: req.file.mimetype });

      await prisma.attachment.create({
        data: {
          filename: req.file.originalname,
          storageKey: attachmentKey,
          mimeType: req.file.mimetype,
          size: req.file.size,
          requisitionId: reqId,
          uploadedById: getNumericUserId(req.user) || null,
          stageName: 'Vetting',
          stageKey: 'vetting',
          uploaderDept: req.user?.name || 'Vetting Dept'
        }
      });
    }

    let actingDeptName = req.user?.name || '';
    if (!actingDeptName && userDeptId) {
      const d = await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } });
      actingDeptName = d?.name || '';
    }

    // Resolve disbursed amount — only relevant for 'treated' action.
    // ICC's post-approval override (if any) takes priority over Audit's, per getEffectiveReqAmount.
    const reqAmount = getEffectiveReqAmount(requisition);
    const existingDisbursed = requisition.amountDisbursed || 0;
    let disbursedThisAction = null;
    let resolvedTreatmentType = treatmentType || null;
    let resolvedTreatmentReason = treatmentReason || null;

    if (action === 'treated' && reqAmount > 0) {
      const rawInput = parsed.data.amountDisbursed;
      const inputAmount = (rawInput != null && !isNaN(rawInput)) ? rawInput : reqAmount;
      disbursedThisAction = Math.min(inputAmount, reqAmount - existingDisbursed); // cap at remaining balance
      if (!resolvedTreatmentType) {
        resolvedTreatmentType = disbursedThisAction >= (reqAmount - existingDisbursed) ? 'full' : 'partial';
      }
    } else if (action === 'treated' && reqAmount === 0) {
      // Material request with no system-known amount — Account manually entered a figure
      // and chose full/partial themselves; no ceiling to validate against.
      const rawInput = parsed.data.amountDisbursed;
      if (rawInput != null && !isNaN(rawInput) && rawInput > 0) {
        disbursedThisAction = rawInput;
      }
    }

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: actingDeptName,
        action,
        vetted: vetted || false,
        comment: comment || null,
        attachmentKey,
        attachmentName,
        actorName: req.user?.name || actingDeptName,
        amountDisbursed: disbursedThisAction,
        treatmentType: resolvedTreatmentType,
        treatmentReason: resolvedTreatmentReason,
      }
    });

    if (action === 'return') {
      // Account is the only post-approval vetter; always return to the approving authority
      const myChainIdx = getVettingChainIndex(actingDeptName);

      let returnToDeptId = null;
      let resetVetting = false;

      if (myChainIdx === 0) {
        // Account → return to approving authority (HR/GM/CEO who approved)
        returnToDeptId = requisition.finalApprovedByDeptId;
        resetVetting = true;
      } else {
        // Chairman or unrecognised dept returning — return to approving authority or creator
        if (requisition.finalApprovedByDeptId && requisition.finalApprovedByDeptId !== userDeptId) {
          returnToDeptId = requisition.finalApprovedByDeptId;
        } else {
          returnToDeptId = requisition.departmentId;
        }
        resetVetting = true;
      }

      if (!returnToDeptId) return res.status(400).json({ error: 'Could not determine return destination.' });

      if (resetVetting) {
        // Send back to approving authority — keep 'approved' so they can re-route to vetting
        await prisma.requisition.update({
          where: { id: reqId },
          data: {
            finalApprovalStatus: 'approved',
            currentVettingDeptId: null,
            targetDepartmentId: returnToDeptId
            // finalApprovedByDeptId / At / Note preserved so they can re-trigger send-to-vetting
          }
        });
      } else {
        // Intra-vetting return — stay in vetting, just move to previous dept
        await prisma.requisition.update({
          where: { id: reqId },
          data: { currentVettingDeptId: returnToDeptId }
        });
      }

      notifyDepartmentHead({
        departmentId: returnToDeptId,
        requisition: { id: reqId, title: requisition.title || `Requisition #${id}` },
        subject: `↩️ Requisition Returned for Review: #${id}`,
        lines: [
          `A requisition has been returned to your department by ${actingDeptName}.`,
          comment ? `Reason: ${comment}` : null
        ].filter(Boolean)
      }).catch(() => { });

    } else if (action === 'treated') {
      const newTotalDisbursed = existingDisbursed + (disbursedThisAction || 0);
      const isPartial = resolvedTreatmentType === 'partial';
      const isAdjusted = resolvedTreatmentType === 'adjusted';
      // Partial: keep request open for Account to complete later
      // Adjusted / Full: fully close
      const isFullyClosed = !isPartial;

      await prisma.requisition.update({
        where: { id: reqId },
        data: {
          finalApprovalStatus: isPartial ? 'partial' : 'treated',
          // Cumulative total across all treatment actions so far — applies whether reqAmount
          // is known (fund/cash) or not (material with manually-entered figures).
          amountDisbursed: newTotalDisbursed > 0 ? newTotalDisbursed : null,
          treatmentType: resolvedTreatmentType,
          treatmentReason: resolvedTreatmentReason,
          treatedByDeptId: isFullyClosed ? (userDeptId || null) : undefined,
          treatedAt: isFullyClosed ? new Date() : undefined,
          // Partial: keep Account as current vetter so they can complete later
          currentVettingDeptId: isPartial ? (userDeptId || null) : null,
        }
      });

      // Notify the originating department — fire-and-forget
      if (requisition.departmentId) {
        const disbursedLine = disbursedThisAction != null
          ? (reqAmount > 0
              ? `Amount Disbursed: ₦${newTotalDisbursed.toLocaleString()} of ₦${reqAmount.toLocaleString()} requested`
              : `Amount Recorded: ₦${disbursedThisAction.toLocaleString()} this action — ₦${newTotalDisbursed.toLocaleString()} total paid so far`)
          : null;
        const notifSubject = isPartial
          ? `⏳ Partial Payment Made — Req #${id}`
          : isAdjusted
            ? `✅ Requisition Treated (Adjusted Amount) — Req #${id}`
            : `✅ Requisition Fully Treated — Req #${id}`;
        const notifLines = [
          isPartial
            ? `A partial payment has been made by ${actingDeptName}. Balance is pending.`
            : `Your requisition has been fully treated by ${actingDeptName}.`,
          disbursedLine,
          resolvedTreatmentReason ? `Reason: ${resolvedTreatmentReason}` : null,
          comment || null,
        ].filter(Boolean);
        notifyDepartmentHead({
          departmentId: requisition.departmentId,
          requisition: { id: reqId, title: requisition.title || `Requisition #${id}` },
          subject: notifSubject,
          lines: notifLines,
        }).catch(() => { });
      }

      // When Chairman/CEO treats, auto-share the record with Account — fire-and-forget
      if (/ceo|chairman/i.test(actingDeptName)) {
        prisma.department.findMany({ select: { id: true, name: true } }).then(allDepts => {
          const accountDept = allDepts.find(d => /\baccount\b/i.test(d.name));
          if (accountDept && accountDept.id !== userDeptId) {
            notifyDepartmentHead({
              departmentId: accountDept.id,
              requisition: { id: reqId, title: requisition.title || `Requisition #${id}` },
              subject: `📋 Chairman Treatment Record — Req #${id}`,
              lines: [
                `Requisition #${id} has been directly treated by ${actingDeptName}.`,
                `Title: ${requisition.title || `Requisition #${id}`}`,
                requisition.amount ? `Amount: ₦${Number(requisition.amount).toLocaleString()}` : null,
                comment ? `Chairman's Remarks: ${comment}` : null,
                `This record is shared with Account for financial processing and audit.`
              ].filter(Boolean)
            }).catch(() => { });
            sendPushNotification([accountDept.id], {
              title: `Chairman Treated Req #${id}`,
              body: `Req #${id} was directly treated by ${actingDeptName}. Record forwarded to Account.`,
              url: `/?req=${reqId}`
            }).catch(() => { });
          }
        }).catch(() => {});
      }
    } else {
      // forward
      if (!nextDeptId) return res.status(400).json({ error: 'nextDeptId is required for forward action' });
      const nextDept = await prisma.department.findUnique({ where: { id: nextDeptId }, select: { name: true } });
      if (!nextDept) return res.status(404).json({ error: 'Next vetting department not found' });

      await prisma.requisition.update({
        where: { id: reqId },
        data: { currentVettingDeptId: nextDeptId }
      });

      notifyDepartmentHead({
        departmentId: nextDeptId,
        requisition: { id: reqId, title: requisition.title || `Requisition #${id}` },
        subject: `📋 Approved Requisition for Vetting: #${id}`,
        lines: [
          `A finally-approved requisition has been forwarded to your department for vetting.`,
          `Forwarded by: ${actingDeptName}`,
          comment ? `Note: ${comment}` : null
        ].filter(Boolean)
      }).catch(() => { });
    }

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: action === 'treated' ? 'Requisition Treated' : action === 'return' ? 'Vetting Returned' : 'Vetting Forwarded',
        details: `Req #${id}: ${action} by ${actingDeptName}. ${comment ? `Note: ${comment}` : ''}`
      }
    });

    broadcastUpdate(reqId, {
      action: action === 'treated' ? 'treated' : action === 'return' ? 'returned' : 'vetting_forwarded',
      fromDept: actingDeptName
    });
    pushToTaggedDepts(reqId, { title: 'Vetting Update', body: `Req #${id} vetting action: ${action} by ${actingDeptName}.`, url: `/?req=${reqId}` });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── AUDIT PRICE OVERRIDE ──────────────────────────────────────────────────────
// Audit dept (pre-approval reviewer) can save a verified items table that
// supersedes the creator's estimated prices for threshold & payment decisions.
// The creator's original table is preserved and still visible.
app.post('/api/requisitions/:id/audit-override', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    // Resolve acting department
    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;
    const isAuditDept = actingDept && /\baudit\b/i.test(actingDept.name);

    if (!isAdmin && !isAuditDept) {
      return res.status(403).json({ error: 'Only the Audit department can save a verified items table.' });
    }

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, departmentId: true, targetDepartmentId: true, status: true, type: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    // Audit must currently hold the request (be the target dept) OR admin override
    if (!isAdmin && requisition.targetDepartmentId !== userDeptId) {
      return res.status(403).json({ error: 'Your department does not currently hold this requisition.' });
    }
    const isMaterialReq = /^material/i.test(requisition.type || '');

    const parsed = z.object({
      items: z.array(z.object({
        description: z.string().min(1),
        qty: z.union([z.number(), z.string()]).transform(v => Number(v)),
        amount: z.union([z.number(), z.string()]).transform(v => parseFloat(String(v))),
        lineTotal: z.union([z.number(), z.string()]).transform(v => parseFloat(String(v))).optional(),
      })).min(1),
      comment: z.string().optional(),
    }).safeParse(req.body || {});

    if (!parsed.success) return res.status(400).json({ error: 'Invalid audit override payload. Provide at least one item.' });

    const { items, comment } = parsed.data;

    // Recalculate lineTotals and grand total server-side (don't trust client totals)
    const verifiedItems = items.map(item => ({
      description: item.description,
      qty: item.qty,
      amount: item.amount,
      lineTotal: parseFloat((item.qty * item.amount).toFixed(2)),
    }));
    const auditTotal = parseFloat(verifiedItems.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2));

    const auditContent = JSON.stringify({
      itemized: true,
      items: verifiedItems,
      comment: comment || null,
      total: auditTotal,
    });

    await prisma.requisition.update({
      where: { id: reqId },
      data: {
        hasAuditOverride: true,
        auditContent,
        auditAmount: auditTotal,
        auditDeptId: userDeptId || null,
        auditDeptName: actingDept?.name || null,
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'Audit Price Override',
        details: `Req #${reqId}: Audit verified table saved by ${actingDept?.name || 'Audit'}. Total: ₦${auditTotal.toLocaleString()}`
      }
    });

    const escalation = await checkAndApplyReapprovalEscalation(reqId, auditTotal, isMaterialReq, actingDept?.name || 'Audit')
      .catch(e => { logger.warn('[REAPPROVAL] Escalation check failed:', e.message); return null; });
    if (escalation) {
      await prisma.activityLog.create({
        data: { action: 'Re-Approval Required', details: `Req #${reqId}: ${escalation.reason}` }
      }).catch(() => {});
    }

    broadcastUpdate(reqId, { action: 'audit_override', fromDept: actingDept?.name || 'Audit' });
    pushToTaggedDepts(reqId, {
      title: 'Audit Verified Amount Set',
      body: `Req #${reqId} has an Audit-verified price table. Amount: ₦${auditTotal.toLocaleString()}.`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true, auditAmount: auditTotal, reapprovalRequired: !!escalation });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── AUDIT OVERRIDE CLEAR ──────────────────────────────────────────────────────
// Audit can also clear their override (e.g. if they choose comment + return instead)
app.delete('/api/requisitions/:id/audit-override', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { name: true } })
      : null;
    const isAuditDept = actingDept && /\baudit\b/i.test(actingDept.name);

    if (!isAdmin && !isAuditDept) {
      return res.status(403).json({ error: 'Only the Audit department can clear a verified table.' });
    }

    await prisma.requisition.update({
      where: { id: reqId },
      data: { hasAuditOverride: false, auditContent: null, auditAmount: null, auditDeptId: null, auditDeptName: null }
    });

    broadcastUpdate(reqId, { action: 'audit_override_cleared' });
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── ICC VETS PROTOCOL ─────────────────────────────────────────────────────────
// Mandatory gate between Account receiving a Cash/Material request and Account
// treating it. Account forwards to ICC; ICC vets (and may override the price
// table for Cash only) before returning to Account, who can then treat normally.
app.post('/api/requisitions/:id/icc-vet-forward', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;
    const isAccountDept = actingDept && /\baccount\b/i.test(actingDept.name);
    const isCeoDept = actingDept && /ceo|chairman/i.test(actingDept.name);

    // Privileged Account sub-account also allowed
    let isPrivilegedAccountSub = false;
    if (req.user.isSubAccount && req.user.parentDeptId) {
      const parentDept = await prisma.department.findUnique({ where: { id: parseInt(req.user.parentDeptId) }, select: { name: true } });
      isPrivilegedAccountSub = !!(parentDept && /\baccount\b/i.test(parentDept.name));
    }

    if (!isAdmin && !isAccountDept && !isPrivilegedAccountSub && !isCeoDept) {
      return res.status(403).json({ error: 'Only Account or CEO/Chairman can forward a request to ICC.' });
    }

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, type: true, targetDepartmentId: true, currentVettingDeptId: true, finalApprovalStatus: true, hasAuditOverride: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    const effectiveDeptId = req.user.isSubAccount ? parseInt(req.user.parentDeptId) : userDeptId;
    const accountHoldsIt = isAdmin
      || requisition.currentVettingDeptId === effectiveDeptId
      || requisition.targetDepartmentId === effectiveDeptId;
    if (!accountHoldsIt) {
      return res.status(403).json({ error: 'Your department does not currently hold this requisition.' });
    }

    if (/^memo/i.test(requisition.type || '')) {
      return res.status(400).json({ error: 'Memos do not go through the ICC Vets Protocol.' });
    }

    const allDeptsForIcc = await prisma.department.findMany({ where: { isSubAccount: false }, select: { id: true, name: true } });
    const iccDept = allDeptsForIcc.find(d => isIccDept(d.name));
    if (!iccDept) return res.status(500).json({ error: 'ICC department not found in system.' });

    const parsed = z.object({ comment: z.string().optional() }).safeParse(req.body || {});
    const comment = parsed.success ? parsed.data.comment : undefined;

    await prisma.requisition.update({
      where: { id: reqId },
      data: { currentVettingDeptId: iccDept.id, iccForwardedFromDeptId: effectiveDeptId || null }
    });

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: effectiveDeptId || 0,
        deptName: actingDept?.name || 'Account',
        action: 'icc_vet_forward',
        comment: comment || null,
        actorName: req.user?.name || actingDept?.name || 'Account',
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'ICC Vets Protocol — Forwarded',
        details: `Req #${reqId} forwarded to ICC for vetting by ${actingDept?.name || 'Account'}.`
      }
    });

    broadcastUpdate(reqId, { action: 'icc_vet_forward', fromDept: actingDept?.name || 'Account', toDept: iccDept.name });
    broadcastPushToInvolved(reqId, {
      title: 'Forwarded for ICC Vetting',
      body: `Req #${reqId} "${requisition.title || ''}" has been forwarded to ICC for vetting.`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/requisitions/:id/icc-vet-return', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;

    if (!isAdmin && !isIccDept(actingDept?.name)) {
      return res.status(403).json({ error: 'Only the ICC department can return a request from vetting.' });
    }

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, type: true, currentVettingDeptId: true, iccForwardedFromDeptId: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    if (!isAdmin && requisition.currentVettingDeptId !== userDeptId) {
      return res.status(403).json({ error: 'ICC does not currently hold this requisition for vetting.' });
    }

    const parsed = z.object({
      comment: z.string().optional(),
      overrideItems: z.array(z.object({
        description: z.string().min(1),
        qty: z.union([z.number(), z.string()]).transform(v => Number(v)),
        amount: z.union([z.number(), z.string()]).transform(v => parseFloat(String(v))),
      })).optional(),
      overrideComment: z.string().optional(),
    }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload.' });
    const { comment, overrideItems, overrideComment } = parsed.data;

    const isMaterialOrMemo = /^material|^memo/i.test(requisition.type || '');
    if (overrideItems && overrideItems.length > 0 && isMaterialOrMemo) {
      return res.status(400).json({ error: 'Price table override is only available for Cash/Fund requests.' });
    }

    const updateData = {
      iccVettingCleared: true,
      iccVettingNote: comment || null,
      iccVettingAt: new Date(),
      iccVettingByDeptId: userDeptId || null,
    };

    let iccTotal = null;
    if (overrideItems && overrideItems.length > 0) {
      const verifiedItems = overrideItems.map(item => ({
        description: item.description,
        qty: item.qty,
        amount: item.amount,
        lineTotal: parseFloat((item.qty * item.amount).toFixed(2)),
      }));
      iccTotal = parseFloat(verifiedItems.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2));
      updateData.hasIccOverride = true;
      updateData.iccOverrideContent = JSON.stringify({ itemized: true, items: verifiedItems, comment: overrideComment || null, total: iccTotal });
      updateData.iccOverrideAmount = iccTotal;
      updateData.iccOverrideDeptName = actingDept?.name || 'ICC';
    }

    // Return to whichever department forwarded this to ICC (Account or CEO/Chairman).
    // Falls back to Account for legacy in-flight requests forwarded before this field existed.
    const allDepts = await prisma.department.findMany({ where: { isSubAccount: false }, select: { id: true, name: true } });
    const returnDept = (requisition.iccForwardedFromDeptId && allDepts.find(d => d.id === requisition.iccForwardedFromDeptId))
      || allDepts.find(d => /\baccount\b/i.test(d.name));
    if (!returnDept) return res.status(500).json({ error: 'Could not resolve which department to return this requisition to.' });
    updateData.currentVettingDeptId = returnDept.id;

    await prisma.requisition.update({ where: { id: reqId }, data: updateData });

    let escalation = null;
    if (iccTotal != null) {
      escalation = await checkAndApplyReapprovalEscalation(reqId, iccTotal, isMaterialOrMemo, actingDept?.name || 'ICC')
        .catch(e => { logger.warn('[REAPPROVAL] Escalation check failed:', e.message); return null; });
    }

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: actingDept?.name || 'ICC',
        action: 'icc_vet_return',
        comment: comment || null,
        actorName: req.user?.name || actingDept?.name || 'ICC',
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'ICC Vets Protocol — Returned',
        details: `Req #${reqId} returned to ${returnDept.name} by ICC.${iccTotal != null ? ` ICC verified total: ₦${iccTotal.toLocaleString()}.` : ''}`
      }
    });
    if (escalation) {
      await prisma.activityLog.create({
        data: { action: 'Re-Approval Required', details: `Req #${reqId}: ${escalation.reason}` }
      }).catch(() => {});
    }

    broadcastUpdate(reqId, { action: 'icc_vet_return', fromDept: actingDept?.name || 'ICC', toDept: returnDept.name });
    notifyDepartmentHead({
      departmentId: returnDept.id,
      subject: `ICC Vetting Complete — Req #${reqId}`,
      lines: [
        `ICC has completed vetting and returned this request to ${returnDept.name} for treatment.`,
        iccTotal != null ? `ICC Verified Amount: ₦${iccTotal.toLocaleString()}` : null,
        comment ? `ICC Note: ${comment}` : null,
      ].filter(Boolean),
    }).catch(() => {});
    broadcastPushToInvolved(reqId, {
      title: 'ICC Vetting Complete',
      body: `Req #${reqId} "${requisition.title || ''}" has been returned to ${returnDept.name} for treatment.`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true, iccAmount: iccTotal, reapprovalRequired: !!escalation });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── ICC GLOBAL OBSERVER ROUTES ───────────────────────────────────────────────

// ICC Comment — leave a non-blocking annotation on any request at any stage
app.post('/api/requisitions/:id/icc-comment', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;

    if (!isAdmin && !isIccDept(actingDept?.name)) {
      return res.status(403).json({ error: 'Only the ICC department can use this action.' });
    }

    const parsed = z.object({ comment: z.string().min(1) }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Comment text is required.' });

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, departmentId: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: actingDept?.name || 'ICC',
        action: 'icc_comment',
        comment: parsed.data.comment,
        actorName: actingDept?.name || 'ICC'
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'ICC Comment',
        details: `Req #${reqId}: ICC comment posted by ${actingDept?.name || 'ICC'}.`
      }
    });

    broadcastUpdate(reqId, { action: 'icc_comment', fromDept: actingDept?.name || 'ICC' });
    broadcastPushToInvolved(reqId, {
      title: 'ICC Comment',
      body: `ICC has commented on Req #${reqId}: "${requisition.title || ''}"`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ICC Freeze — freeze the request; blocks ALL actions by any other dept
app.post('/api/requisitions/:id/icc-freeze', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;

    if (!isAdmin && !isIccDept(actingDept?.name)) {
      return res.status(403).json({ error: 'Only the ICC department can freeze a request.' });
    }

    const parsed = z.object({ note: z.string().min(1, 'A reason is required to freeze a request.') }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Freeze reason is required.' });

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, departmentId: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    await prisma.requisition.update({
      where: { id: reqId },
      data: {
        iccFrozen: true,
        iccFreezeNote: parsed.data.note,
        iccFreezeAt: new Date(),
        iccFreezeBy: actingDept?.name || 'ICC'
      }
    });

    // Log as a vetting event so it appears in the request history
    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: actingDept?.name || 'ICC',
        action: 'icc_freeze',
        comment: parsed.data.note,
        actorName: actingDept?.name || 'ICC'
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'ICC Freeze',
        details: `Req #${reqId} FROZEN by ${actingDept?.name || 'ICC'}. Reason: ${parsed.data.note}`
      }
    });

    broadcastUpdate(reqId, { action: 'icc_freeze', fromDept: actingDept?.name || 'ICC' });
    broadcastPushToInvolved(reqId, {
      title: '🔒 Request Frozen by ICC',
      body: `Req #${reqId} "${requisition.title || ''}" has been frozen by ICC. Reason: ${parsed.data.note}`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ICC Unfreeze — lift the freeze; restores full action capability
app.post('/api/requisitions/:id/icc-unfreeze', authenticateToken, async (req, res) => {
  try {
    const reqId = parseInt(req.params.id);
    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    const actingDept = userDeptId
      ? await prisma.department.findUnique({ where: { id: userDeptId }, select: { id: true, name: true } })
      : null;

    if (!isAdmin && !isIccDept(actingDept?.name)) {
      return res.status(403).json({ error: 'Only the ICC department can unfreeze a request.' });
    }

    const requisition = await prisma.requisition.findUnique({
      where: { id: reqId },
      select: { id: true, title: true, departmentId: true }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });

    await prisma.requisition.update({
      where: { id: reqId },
      data: { iccFrozen: false, iccFreezeNote: null, iccFreezeAt: null, iccFreezeBy: null }
    });

    await prisma.vettingEvent.create({
      data: {
        requisitionId: reqId,
        deptId: userDeptId || 0,
        deptName: actingDept?.name || 'ICC',
        action: 'icc_unfreeze',
        comment: 'ICC freeze lifted — processing may resume.',
        actorName: actingDept?.name || 'ICC'
      }
    });

    await prisma.activityLog.create({
      data: {
        userId: getNumericUserId(req.user) || null,
        action: 'ICC Unfreeze',
        details: `Req #${reqId} unfrozen by ${actingDept?.name || 'ICC'}.`
      }
    });

    broadcastUpdate(reqId, { action: 'icc_unfreeze', fromDept: actingDept?.name || 'ICC' });
    broadcastPushToInvolved(reqId, {
      title: '🔓 ICC Freeze Lifted',
      body: `Req #${reqId} "${requisition.title || ''}" has been unfrozen by ICC. Processing may resume.`,
      url: `/?req=${reqId}`
    });

    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── PUBLISH MEMO TO ALL DEPARTMENTS ──────────────────────────────────────────
app.post('/api/requisitions/:id/publish-memo', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const reqId = parseInt(id);
    if (await blockIfIccFrozen(reqId, res)) return;
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const dept = deptId ? await prisma.department.findUnique({ where: { id: deptId } }) : null;
    const deptName = dept?.name || req.user.name || '';
    const canPublish = /\bhr\b|human\s*resource|general\s*manager|\bgm\b|ceo|chairman/i.test(deptName)
      || req.user.role === 'global_admin';
    if (!canPublish) return res.status(403).json({ error: 'Only HR, GM, or Chairman/CEO can publish memos' });

    const memo = await prisma.requisition.findUnique({ where: { id: reqId } });
    if (!memo) return res.status(404).json({ error: 'Memo not found' });

    const scheduleParsed = z.object({
      publishStartAt: z.string().optional().nullable(),
      publishEndAt: z.string().optional().nullable(),
    }).safeParse(req.body || {});
    const scheduleData = scheduleParsed.success ? scheduleParsed.data : {};

    await prisma.requisition.update({
      where: { id: reqId },
      data: {
        finalApprovalStatus: 'published',
        status: 'approved',
        publishStartAt: scheduleData.publishStartAt ? new Date(scheduleData.publishStartAt) : null,
        publishEndAt: scheduleData.publishEndAt ? new Date(scheduleData.publishEndAt) : null,
      }
    });

    const allDepts = await prisma.department.findMany({ where: { NOT: { name: 'Super Admin' } } });
    const memoTitle = memo.title || (memo.description || '').slice(0, 60) || 'Untitled Memo';
    await Promise.all(allDepts.map(async d => {
      try {
        await prisma.notification.create({
          data: {
            departmentId: d.id,
            content: `📋 Memo Published: "${memoTitle}" — by ${deptName || 'Administration'}`,
            link: `/memos/${reqId}`,
          }
        });
      } catch (_) { }
    }));

    try { await logAudit(req, 'Memo Published', `Memo #${reqId} published to all depts by ${deptName}`); } catch (_) { }
    res.json({ ok: true, published: allDepts.length });
  } catch (err) { sendError(res, 500, err.message); }
});

app.post('/api/requisitions/:id/approve', authenticateToken, approvalLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (await blockIfIccFrozen(parseInt(id), res)) return;
    const parsed = z.object({ remarks: z.string().optional() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid approval payload' });
    const updated = await processApprovalAction({ requisitionId: parseInt(id), action: 'approved', remarks: parsed.data.remarks, user: req.user });
    broadcastUpdate(parseInt(id), { action: 'approved', fromDept: req.user?.name || 'Department' });
    pushToTaggedDepts(parseInt(id), { title: 'Requisition Approved', body: `Req #${id} has been approved at a workflow stage.`, url: `/?req=${id}` });
    res.json(updated);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/requisitions/:id/reject', authenticateToken, approvalLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    if (await blockIfIccFrozen(parseInt(id), res)) return;
    const parsed = z.object({ remarks: z.string().optional() }).safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid rejection payload' });
    const updated = await processApprovalAction({ requisitionId: parseInt(id), action: 'rejected', remarks: parsed.data.remarks, user: req.user });
    broadcastUpdate(parseInt(id), { action: 'rejected', fromDept: req.user?.name || 'Department' });
    pushToTaggedDepts(parseInt(id), { title: 'Requisition Rejected', body: `Req #${id} has been rejected.`, url: `/?req=${id}` });
    res.json(updated);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Backward compatible status endpoint
app.post('/api/requisitions/:id/status', authenticateToken, approvalLimiter, async (req, res) => {
  try {
    if (await blockIfIccFrozen(parseInt(req.params.id), res)) return;
    const { status, remarks } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported status change' });
    }
    const updated = await processApprovalAction({ requisitionId: parseInt(req.params.id), action: status, remarks, user: req.user });
    res.json(updated);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/api/requisitions/:id/signed-pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const requisition = await prisma.requisition.findUnique({ where: { id: parseInt(id) } });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found.' });
    if (!(await canReadRequisition(requisition, req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!requisition.signedPdfKey) {
      return res.status(404).json({ error: 'This requisition does not have a signed copy yet. It must be fully approved before a signed document is generated.' });
    }
    const stream = await getObjectStream(requisition.signedPdfKey);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="signed-requisition-${id}.pdf"`);
    stream.pipe(res);
  } catch (error) {
    logger.error('[SIGNED PDF] Error:', error.message);
    res.status(500).json({ error: 'Unable to retrieve the signed document. Please try again.' });
  }
});

// Shared helper for verifying a signature record
async function verifySignatureRecord(record) {
  const signatureValid = verifyHashHex(record.payloadHash, record.signature, record.publicKey.publicKey);
  const hasPdf = !!(record.approval?.requisition?.signedPdfKey && record.approval?.requisition?.signedPdfHash);
  let pdfValid = null;
  if (hasPdf) {
    const pdfBytes = await getObjectBuffer(record.approval.requisition.signedPdfKey);
    pdfValid = sha256Hex(pdfBytes) === record.approval.requisition.signedPdfHash;
  }
  return {
    signatureValid,
    pdfValid,           // true/false if PDF was checked, null if no signed PDF exists yet
    pdfChecked: hasPdf  // explicit flag so callers know whether pdfValid was evaluated
  };
}

// Verification (Admin only)
app.get('/api/verify/:code', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { code } = req.params;
    const record = await prisma.signatureRecord.findUnique({
      where: { verificationCode: code },
      include: { publicKey: true, approval: { include: { requisition: true } } }
    });
    if (!record) return res.status(404).json({ error: 'Verification code not found' });
    const { signatureValid, pdfValid, pdfChecked } = await verifySignatureRecord(record);
    res.json({
      verificationCode: code,
      signatureValid,
      pdfValid,
      pdfChecked,
      requisitionId: record.approval?.requisitionId,
      approvedAt: record.approval?.createdAt
    });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── DEPARTMENT PROFILE & GOVERNANCE ROUTES ───────────────────────────────────

app.get('/api/department/profile', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'department' || !req.user.deptId) {
      return res.status(403).json({ error: 'Only department accounts can access this profile' });
    }
    const dept = await prisma.department.findUnique({
      where: { id: req.user.deptId }
    });
    // Determine if head official signature is ready
    const headUser = dept?.headEmail ? await prisma.user.findFirst({
      where: { email: dept.headEmail },
      include: { signature: true }
    }) : null;

    res.json({
      ...dept,
      hasSignature: !!headUser?.signature
    });
  } catch (error) { sendError(res, 500, error.message); }
});

app.put('/api/department/profile', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'department' || !req.user.deptId) return res.status(403).json({ error: 'Forbidden' });
    // Name, Email, Phone, and Staff ID are identity fields locked to the registered head/
    // sub-account — only ICT/Super Admin can change them (via Department Manager or
    // Sub-Accounts). Self-service here only covers Job Title and Address.
    const { headTitle, address } = req.body;
    const updated = await prisma.department.update({
      where: { id: req.user.deptId },
      data: { headTitle, address }
    });
    res.json(updated);
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/department/signature', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'department' || !req.user.deptId) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'No signature file uploaded' });

    const dept = await prisma.department.findUnique({ where: { id: req.user.deptId } });
    if (!dept.headEmail) return res.status(400).json({ error: 'Please set a head official email first' });

    // Find or create the user for this email to attach the signature
    let headUser = await prisma.user.findFirst({ where: { email: dept.headEmail } });
    if (!headUser) {
      // Create a placeholder user if they don't exist
      headUser = await prisma.user.create({
        data: {
          email: dept.headEmail,
          name: dept.headName || 'Department Head',
          role: 'department',
          departmentId: dept.id,
          password: crypto.randomBytes(8).toString('hex') // placeholder
        }
      });
    }

    const storageKey = generateStorageKey(`signatures/head-${dept.id}`, req.file.originalname);
    await putObject({ key: storageKey, body: req.file.buffer, contentType: req.file.mimetype });

    await prisma.userSignature.upsert({
      where: { userId: headUser.id },
      update: { imageKey: storageKey },
      create: { userId: headUser.id, imageKey: storageKey }
    });

    res.json({ success: true, message: 'Department head signature updated successfully' });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── GET department signature image (dept sees own; admin sees any) ────────────
app.get('/api/department/signature/image', authenticateToken, async (req, res) => {
  try {
    const deptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    if (!deptId) return res.status(403).json({ error: 'Forbidden' });
    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { headEmail: true } });
    if (!dept?.headEmail) return res.status(404).json({ error: 'No signature on file' });
    const headUser = await prisma.user.findFirst({ where: { email: dept.headEmail }, include: { signature: true } });
    if (!headUser?.signature?.imageKey) return res.status(404).json({ error: 'No signature on file' });
    const buf = await getObjectBuffer(headUser.signature.imageKey);
    const ext = headUser.signature.imageKey.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    res.set({ 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.send(buf);
  } catch (error) { sendError(res, 500, error.message); }
});

// 1×1 transparent PNG used as a silent fallback when no signature is on file
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

app.get('/api/departments/:id/signature/image', authenticateToken, async (req, res) => {
  try {
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const deptId = parseInt(req.params.id);
    const requesterDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    if (!isAdmin && requesterDeptId !== deptId) {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.send(TRANSPARENT_PNG);
    }
    const dept = await prisma.department.findUnique({ where: { id: deptId }, select: { headEmail: true } });
    if (!dept?.headEmail) {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.send(TRANSPARENT_PNG);
    }
    const headUser = await prisma.user.findFirst({ where: { email: dept.headEmail }, include: { signature: true } });
    if (!headUser?.signature?.imageKey) {
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.send(TRANSPARENT_PNG);
    }
    const buf = await getObjectBuffer(headUser.signature.imageKey);
    const ext = headUser.signature.imageKey.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    res.set({ 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.send(buf);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Admin override: upload signature for any department ──────────────────────
app.post('/api/departments/:id/signature', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (normalizeRole(req.user.role) !== 'global_admin') return res.status(403).json({ error: 'Admin only' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const deptId = parseInt(req.params.id);
    const dept = await prisma.department.findUnique({ where: { id: deptId } });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    if (!dept.headEmail) return res.status(400).json({ error: 'Department has no head email set — set it first' });

    let headUser = await prisma.user.findFirst({ where: { email: dept.headEmail } });
    if (!headUser) {
      headUser = await prisma.user.create({
        data: {
          email: dept.headEmail,
          name: dept.headName || 'Department Head',
          role: 'department',
          departmentId: deptId,
          password: crypto.randomBytes(8).toString('hex')
        }
      });
    }

    const storageKey = generateStorageKey(`signatures/head-${deptId}`, req.file.originalname);
    await putObject({ key: storageKey, body: req.file.buffer, contentType: req.file.mimetype });
    await prisma.userSignature.upsert({
      where: { userId: headUser.id },
      update: { imageKey: storageKey },
      create: { userId: headUser.id, imageKey: storageKey }
    });

    // Notify the department that admin has set/replaced their signature
    await prisma.notification.create({
      data: {
        departmentId: deptId,
        content: `⚠️ Your official signature has been set/updated by the system administrator. It will be used on all PDF documents going forward.`,
        link: '/dept_profile'
      }
    }).catch(() => {});

    res.json({ success: true, message: `Signature updated for ${dept.name}` });
  } catch (error) { sendError(res, 500, error.message); }
});

// ── END GOVERNANCE ROUTES ───────────────────────────────────────────────────

// Public verification endpoint (rate-limited, no auth required)
app.get('/api/public-verify/:code', publicVerifyLimiter, async (req, res) => {
  try {
    const { code } = req.params;
    const record = await prisma.signatureRecord.findUnique({
      where: { verificationCode: code },
      include: { publicKey: true, approval: { include: { requisition: true } } }
    });
    if (!record) return res.status(404).json({ error: 'Verification code not found' });
    const { signatureValid, pdfValid, pdfChecked } = await verifySignatureRecord(record);
    res.json({
      verificationCode: code,
      signatureValid,
      pdfValid,
      pdfChecked,
      requisitionId: record.approval?.requisitionId,
      approvedAt: record.approval?.createdAt
    });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/requisitions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const requisition = await prisma.requisition.findUnique({
      where: { id: parseInt(id) },
      include: {
        department: { select: { name: true, code: true, headName: true, headEmail: true } },
        targetDepartment: { select: { name: true, code: true, headEmail: true, headName: true } },
        creator: { select: { name: true } },
        currentStage: true,
        attachments: {
          include: {
            uploadedBy: { select: { name: true, department: { select: { name: true } } } }
          }
        },
        approvals: {
          include: {
            stage: true,
            user: { select: { name: true, role: true } },
            signature: { select: { verificationCode: true, payloadHash: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        forwardEvents: {
          include: {
            fromDepartment: { select: { name: true, code: true } },
            toDepartment: { select: { name: true, code: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });
    // Fetch extra columns not in Prisma schema — split into two independent queries so that
    // a missing column in one set never silently drops access-control fields from the other.
    let ext = {};
    try {
      const extRows = await prisma.$queryRaw`
        SELECT "finalApprovalStatus", "finalApprovedByDeptId", "finalApprovedAt",
               "finalApprovedNote", "currentVettingDeptId", "treatedByDeptId", "treatedAt",
               "hasAuditOverride", "auditContent", "auditAmount", "auditDeptId", "auditDeptName"
        FROM "Requisition" WHERE id = ${parseInt(id)} LIMIT 1
      `;
      ext = extRows?.[0] || {};
    } catch (_) { /* columns not yet migrated — ignore */ }
    // ICC Vets Protocol fields — separate try/catch so a missing column never breaks anything above
    try {
      const iccVetRows = await prisma.$queryRaw`
        SELECT "iccVettingCleared", "iccVettingNote", "iccVettingAt", "iccVettingByDeptId",
               "iccForwardedFromDeptId",
               "hasIccOverride", "iccOverrideContent", "iccOverrideAmount", "iccOverrideDeptName"
        FROM "Requisition" WHERE id = ${parseInt(id)} LIMIT 1
      `;
      Object.assign(ext, iccVetRows?.[0] || {});
    } catch (_) { /* ICC Vets Protocol columns not yet migrated — default: not cleared */ }
    // Re-approval escalation fields — separate try/catch so a missing column never breaks anything above
    try {
      const reapprovalRows = await prisma.$queryRaw`
        SELECT "needsReapproval", "reapprovalAuthority", "reapprovalReason", "reapprovedAt", "reapprovedByDeptId"
        FROM "Requisition" WHERE id = ${parseInt(id)} LIMIT 1
      `;
      Object.assign(ext, reapprovalRows?.[0] || {});
    } catch (_) { /* reapproval columns not yet migrated — default: not flagged */ }
    // Self-healing re-check — catches records whose override was saved before this control
    // existed (or any other reason the flag drifted from the current effective amount),
    // without needing a one-off backfill migration. Cheap: only writes when state changes.
    try {
      const effectiveAmount = getEffectiveReqAmount({ ...requisition, ...ext });
      const isMaterialForCheck = /^material/i.test(requisition.type || '');
      const escalation = await checkAndApplyReapprovalEscalation(parseInt(id), effectiveAmount, isMaterialForCheck, ext.hasIccOverride ? (ext.iccOverrideDeptName || 'ICC') : (ext.auditDeptName || 'Audit'));
      if (escalation) {
        ext.needsReapproval = true;
        ext.reapprovalAuthority = escalation.requiredTier;
        ext.reapprovalReason = escalation.reason;
      } else if (ext.needsReapproval) {
        ext.needsReapproval = false;
        ext.reapprovalAuthority = null;
        ext.reapprovalReason = null;
      }
    } catch (_) { /* escalation re-check is best-effort — never block viewing the requisition */ }
    // ICC freeze fields — separate try/catch so a missing column never breaks access control above
    try {
      const iccRows = await prisma.$queryRaw`
        SELECT "iccFrozen", "iccFreezeNote", "iccFreezeAt", "iccFreezeBy"
        FROM "Requisition" WHERE id = ${parseInt(id)} LIMIT 1
      `;
      Object.assign(ext, iccRows?.[0] || {});
    } catch (_) { /* ICC columns not yet migrated — default: not frozen */ }

    if (!(await canReadRequisition({ ...requisition, ...ext }, req.user))) {
      return res.status(403).json({ error: 'You do not have permission to view this requisition.' });
    }
    // Attach vetting events — safe fallback
    let vettingEvents = [];
    try {
      vettingEvents = await prisma.$queryRaw`
        SELECT * FROM "VettingEvent" WHERE "requisitionId" = ${parseInt(id)} ORDER BY "createdAt" ASC
      `;
    } catch (_) { /* VettingEvent table not yet created */ }

    // Self-healing backfill — forward-for-reapproval/reapprove used to only log to the
    // admin-only Activity Log, never to VettingEvent, so requests that already went
    // through a re-approval cycle before that fix shipped are missing those steps from
    // their Vetting Chain trail (and therefore the printed PDF too). Reconstruct them
    // once, the next time anyone views this requisition.
    if (ext.reapprovedAt && !vettingEvents.some(e => e.action === 'reapproved')) {
      try {
        const logs = await prisma.activityLog.findMany({
          where: { details: { contains: `Req #${id}` }, action: { in: ['Forwarded for Re-Approval', 'Re-Approved'] } },
          orderBy: { timestamp: 'asc' },
        });
        const accountDept = await prisma.department.findFirst({ where: { name: { contains: 'account', mode: 'insensitive' }, isSubAccount: false }, select: { id: true, name: true } });
        const reapprovedDept = ext.reapprovedByDeptId
          ? await prisma.department.findUnique({ where: { id: ext.reapprovedByDeptId }, select: { id: true, name: true } })
          : null;
        for (const log of logs) {
          if (log.action === 'Forwarded for Re-Approval' && accountDept) {
            await prisma.vettingEvent.create({
              data: { requisitionId: parseInt(id), deptId: accountDept.id, deptName: accountDept.name, action: 'forwarded_for_reapproval', actorName: accountDept.name, createdAt: log.timestamp }
            }).catch(() => {});
          } else if (log.action === 'Re-Approved' && reapprovedDept) {
            const noteMatch = log.details.match(/Note:\s*(.+?)(?:\s*Routed back for treatment\.)?$/i);
            await prisma.vettingEvent.create({
              data: { requisitionId: parseInt(id), deptId: reapprovedDept.id, deptName: reapprovedDept.name, action: 'reapproved', comment: noteMatch ? noteMatch[1].trim() : null, actorName: reapprovedDept.name, createdAt: log.timestamp }
            }).catch(() => {});
          }
        }
        vettingEvents = await prisma.$queryRaw`
          SELECT * FROM "VettingEvent" WHERE "requisitionId" = ${parseInt(id)} ORDER BY "createdAt" ASC
        `;
      } catch (_) { /* backfill is best-effort — never block viewing the requisition */ }
    }
    // Fetch tags + isTagged
    let tags = [];
    let isTagged = false;
    try {
      tags = await prisma.requisitionTag.findMany({ where: { requisitionId: parseInt(id) }, select: { deptId: true, taggedByDeptId: true, taggedAt: true } });
      if (req.user.role === 'department' && req.user.deptId) {
        isTagged = tags.some(t => t.deptId === parseInt(req.user.deptId));
      }
    } catch (_) {}
    res.json({ ...requisition, ...ext, vettingEvents: vettingEvents || [], tags, isTagged });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/requisitions/:id/dynamic-pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const upToEventId = req.query.upToEventId || null; // Optional stage filter

    const requisition = await prisma.requisition.findUnique({
      where: { id: parseInt(id) },
      include: {
        department: { include: { stamp: true } },
        targetDepartment: { include: { stamp: true } },
        approvals: {
          include: {
            stage: true,
            user: { include: { signature: true } }
          },
          orderBy: { createdAt: 'asc' }
        },
        forwardEvents: {
          include: {
            fromDepartment: { include: { stamp: true } },
            toDepartment: { include: { stamp: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!requisition) return res.status(404).json({ error: 'Requisition not found' });
    if (!(await canReadRequisition(requisition, req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // ── Stage filtering ────────────────────────────────
    let filteredApprovals = requisition.approvals || [];
    let filteredEvents = requisition.forwardEvents || [];

    if (upToEventId) {
      if (upToEventId.startsWith('fwd-')) {
        const eventId = parseInt(upToEventId.replace('fwd-', ''));
        const cutIdx = filteredEvents.findIndex(e => e.id === eventId);
        if (cutIdx >= 0) filteredEvents = filteredEvents.slice(0, cutIdx + 1);
      } else if (upToEventId.startsWith('app-')) {
        const appId = parseInt(upToEventId.replace('app-', ''));
        const cutIdx = filteredApprovals.findIndex(a => a.id === appId);
        if (cutIdx >= 0) filteredApprovals = filteredApprovals.slice(0, cutIdx + 1);
      }
    }

    // ── Load vetting events ────────────────────────────
    let vettingEvents = [];
    try {
      vettingEvents = await prisma.vettingEvent.findMany({
        where: { requisitionId: parseInt(id) },
        orderBy: { createdAt: 'asc' }
      });
    } catch (_) {}

    // Resolve each vetting event's acting department to its head's name/title —
    // VettingEvent only stores deptId, no relation, so look these up in one batch.
    const vettingDeptIds = [...new Set(vettingEvents.map(e => e.deptId).filter(Boolean))];
    const vettingDeptMap = vettingDeptIds.length
      ? Object.fromEntries((await prisma.department.findMany({
          where: { id: { in: vettingDeptIds } },
          select: { id: true, headName: true, headTitle: true }
        })).map(d => [d.id, d]))
      : {};

    // "By [Full Name] [Title/Position]" — falls back to just the name if no title is
    // set, and to the department/actorName string if no head has been registered at all.
    const formatActorLabel = (headName, headTitle, fallback) => {
      if (headName) return headTitle ? `${headName} (${headTitle})` : headName;
      return fallback || 'Department';
    };

    // ── PDF Setup ──────────────────────────────────────
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const A4_W = 595.28, A4_H = 841.89;
    const margin = 50;
    const contentWidth = A4_W - margin * 2;
    const isMemo = requisition.type === 'Memo';
    const isFinancial = requisition.type === 'Cash' || (requisition.amount && requisition.amount > 0);
    let pageNumber = 0;
    let page, y;

    // ── Helper: Add new page with header ────────────────
    const addPage = () => {
      pageNumber++;
      page = pdfDoc.addPage([A4_W, A4_H]);
      y = A4_H - margin;
      // footer on every page
      return page;
    };

    // ── Helper: Check remaining space, add page if needed ──
    const ensureSpace = (needed = 40) => {
      if (y < margin + needed) {
        // page footer
        const pgText = `Page ${pageNumber}`;
        page.drawText(pgText, { x: A4_W / 2 - font.widthOfTextAtSize(pgText, 8) / 2, y: 20, size: 8, font: italicFont, color: rgb(0.5, 0.5, 0.5) });
        addPage();
        return true;
      }
      return false;
    };

    // ── Helper: Draw wrapped text block ─────────────────
    const drawWrappedText = (text, opts = {}) => {
      const { fontSize = 10, textFont = font, indent = 0, lineHeight = 14, maxWidth = contentWidth - indent } = opts;
      const charsPerLine = Math.floor(maxWidth / (textFont.widthOfTextAtSize('M', fontSize) * 0.55));
      const words = text.split(/\s+/);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        if (testLine.length > charsPerLine && currentLine) {
          ensureSpace(lineHeight + 5);
          page.drawText(currentLine, { x: margin + indent, y, size: fontSize, font: textFont });
          y -= lineHeight;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) {
        ensureSpace(lineHeight + 5);
        page.drawText(currentLine, { x: margin + indent, y, size: fontSize, font: textFont });
        y -= lineHeight;
      }
    };

    // ── Helper: Sanitize text for pdf-lib standard fonts (WinAnsi only) ────
    // Standard fonts (Helvetica etc.) only support Latin-1 / WinAnsi.
    // Any character outside that range causes a hard crash. Replace common
    // offenders and strip anything else outside the printable Latin-1 range.
    const sanitizeText = (str) => {
      if (!str) return '';
      return String(str)
        .replace(/₦/g, 'NGN')
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/–/g, '-')
        .replace(/—/g, '-')
        .replace(/…/g, '...')
        .replace(/•/g, '-')
        .replace(/[^\x20-\xFF\n\r]/g, '?'); // replace any remaining non-WinAnsi, allowing newlines/returns
    };

    // ── Helper: Strip HTML tags to plain text ────────────
    const stripHtml = (html) => {
      if (!html) return '';
      return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    // ── Helper: Draw a horizontal rule ──────────────────
    const drawHR = (thickness = 0.5, color = rgb(0.7, 0.7, 0.7)) => {
      page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness, color });
      y -= 15;
    };

    // ── Helper: Embed image safely ──────────────────────
    const embedSafe = async (bytes) => {
      if (!bytes) return null;
      try { return await pdfDoc.embedPng(bytes); }
      catch (_) {
        try { return await pdfDoc.embedJpg(bytes); }
        catch (__) { return null; }
      }
    };

    // ── Load Custom Seal Stamp image for processing chain ───
    const sealBgPath = path.join(__dirname, 'rms_frontend', 'public', 'SEAL STAMP.png');
    let sealBgBytes = null;
    try { if (fs.existsSync(sealBgPath)) sealBgBytes = fs.readFileSync(sealBgPath); } catch { }
    let sealBgImg = null;
    if (sealBgBytes) sealBgImg = await embedSafe(sealBgBytes);

    // ── Global show-stamp + show-signature settings ──────────
    let showStampOnPdf = true;
    let showSignatureOnPdf = true;
    try {
      const [stampRows, sigRows] = await Promise.all([
        prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'show_stamp_on_pdf' LIMIT 1`,
        prisma.$queryRaw`SELECT "value" FROM "SystemSetting" WHERE "key" = 'show_signature_on_pdf' LIMIT 1`,
      ]);
      showStampOnPdf = (stampRows?.[0]?.value ?? 'true') !== 'false';
      showSignatureOnPdf = (sigRows?.[0]?.value ?? 'true') !== 'false';
    } catch { /* default true */ }

    // ── Load dept head signatures for processing + vetting chains ───
    // Collect unique dept IDs from forward events AND vetting events
    const evtDeptIds = new Set([
      ...filteredEvents.flatMap(e => [e.fromDeptId, e.toDeptId]),
      ...vettingEvents.map(e => e.deptId)
    ].filter(Boolean));
    const deptSigMap = new Map(); // deptId → { headName, headTitle, sigBytes }
    if (evtDeptIds.size > 0) {
      const deptRows = await prisma.department.findMany({
        where: { id: { in: [...evtDeptIds] } },
        select: { id: true, headName: true, headTitle: true, headEmail: true }
      });
      const headEmails = deptRows.filter(d => d.headEmail).map(d => d.headEmail);
      const headUserRows = headEmails.length > 0
        ? await prisma.user.findMany({
          where: { email: { in: headEmails } },
          select: { email: true, name: true, signature: { select: { imageKey: true } } }
        })
        : [];
      const headUserByEmail = new Map(headUserRows.map(u => [u.email, u]));
      for (const dept of deptRows) {
        const hu = dept.headEmail ? headUserByEmail.get(dept.headEmail) : null;
        let sigBytes = null;
        if (hu?.signature?.imageKey) {
          sigBytes = await getObjectBuffer(hu.signature.imageKey).catch(() => null);
        }
        deptSigMap.set(dept.id, {
          headName: sanitizeText(dept.headName || hu?.name || ''),
          headTitle: sanitizeText(dept.headTitle || ''),
          sigBytes
        });
      }
    }

    // ── Helper: Draw auto-generated circular seal ─────────
    // Draws a CSS Farms-branded seal at (cx, cy) with dept name + date
    const drawSeal = async (pg, cx, cy, deptName, dateStr) => {
      const r = 38; // outer ring radius
      const r2 = 31; // second outer ring (double-ring effect)
      const ir = 21; // inner ring radius
      const green = rgb(0.1, 0.36, 0.1);
      const nameUpper = sanitizeText((deptName || '').toUpperCase());
      const nameDisp = nameUpper.length > 20 ? nameUpper.substring(0, 18) + '..' : nameUpper;
      const nameFontSz = nameDisp.length > 14 ? 4.5 : 5.5;

      // Helper: Draw curved text along a radial path
      const drawTextAlongArc = (text, arcRadius, centerAngleRad, isTop = true, fontSize = 5) => {
        const textToDraw = sanitizeText(text).toUpperCase();
        const chars = textToDraw.split('');
        const charWidths = chars.map(c => boldFont.widthOfTextAtSize(c, fontSize));
        const totalWidth = charWidths.reduce((a, b) => a + b, 0);
        const totalAngleRad = totalWidth / arcRadius;

        // Current angle position
        let currentAngle = isTop
          ? centerAngleRad + totalAngleRad / 2
          : centerAngleRad - totalAngleRad / 2;

        chars.forEach((char, i) => {
          const charAngle = charWidths[i] / arcRadius;
          const angleAtChar = isTop
            ? currentAngle - charAngle / 2
            : currentAngle + charAngle / 2;

          const x = cx + arcRadius * Math.cos(angleAtChar);
          const y = cy + arcRadius * Math.sin(angleAtChar);

          const charRotation = isTop ? angleAtChar - Math.PI / 2 : angleAtChar + Math.PI / 2;

          pg.drawText(char, {
            x, y,
            size: fontSize,
            font: boldFont,
            color: green,
            rotate: radians(charRotation),
          });

          currentAngle = isTop ? currentAngle - charAngle : currentAngle + charAngle;
        });
      };

      // Draw the seal background image if available
      if (sealBgImg) {
        const sw = 84, sh = 84;
        pg.drawImage(sealBgImg, { x: cx - sw / 2, y: cy - sh / 2, width: sw, height: sh });

        // ── White Mask ──
        // 1. Ring Mask: cover the top/bottom text bands
        pg.drawCircle({
          x: cx, y: cy,
          size: 30, // Radius of the mask
          borderColor: rgb(1, 1, 1),
          borderWidth: 10,
          opacity: 0.9
        });

        // 2. Date Mask: cover the hardcoded template date in the center-bottom
        pg.drawRectangle({
          x: cx - 25, y: cy - 18,
          width: 50, height: 12,
          color: rgb(1, 1, 1),
          opacity: 0.95
        });
      }

      // 1. Top Arc: Department Name (e.g., "ICT SOLUTIONS")
      const topRadius = 31;
      drawTextAlongArc(nameUpper, topRadius, Math.PI / 2, true, nameFontSz);

      // 2. Bottom Arc: "DEPARTMENT" Label
      const bottomRadius = 31;
      drawTextAlongArc('DEPARTMENT', bottomRadius, 3 * Math.PI / 2, false, 4.5);

      // 3. Date in the middle
      const dw = boldFont.widthOfTextAtSize(dateStr, 4);
      pg.drawText(dateStr, { x: cx - dw / 2, y: cy - 11, size: 4, font: boldFont, color: green });
    };

    // ══════════════════════════════════════════════════════
    // PAGE 1: DOCUMENT HEADER
    // ══════════════════════════════════════════════════════
    addPage();

    // ── Logo ────────────────────────────────────────────
    try {
      const logoPath = findBrandLogoPath();
      if (logoPath && fs.existsSync(logoPath)) {
        const logoBytes = fs.readFileSync(logoPath);
        const logoImage = await embedSafe(logoBytes);
        if (logoImage) {
          const logoBox = { width: 70, height: 43 };
          const logoScale = Math.min(logoBox.width / logoImage.width, logoBox.height / logoImage.height);
          const logoDims = logoImage.scale(logoScale);
          page.drawImage(logoImage, {
            x: margin + 6,
            y: y - logoDims.height - 2,
            width: logoDims.width,
            height: logoDims.height
          });
        }
      }
    } catch (e) { /* logo skip */ }

    // ── Company Header ──────────────────────────────────
    page.drawText('CSS GROUP OF COMPANIES', { x: 150, y: y - 5, size: 14, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
    page.drawText('Km 10, Abuja-Keffi Expressway, Salamu Road, Gora, Nasarawa State.', { x: 150, y: y - 20, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('www.cssgroup.com.ng  |  info@cssgroup.com.ng  |  +234 702 603 3333', { x: 150, y: y - 32, size: 8, font, color: rgb(0.3, 0.3, 0.3) });

    y -= 55;
    page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 2, color: rgb(0.1, 0.22, 0.43) });
    y -= 25;

    // ── Document Title ──────────────────────────────────
    const docTitle = isMemo ? 'INTERNAL MEMORANDUM' : 'REQUISITION VOUCHER';
    const titleWidth = boldFont.widthOfTextAtSize(docTitle, 16);
    page.drawText(docTitle, { x: A4_W / 2 - titleWidth / 2, y, size: 16, font: boldFont });
    y -= 8;
    // Underline
    page.drawLine({ start: { x: A4_W / 2 - titleWidth / 2 - 5, y }, end: { x: A4_W / 2 + titleWidth / 2 + 5, y }, thickness: 1, color: rgb(0.1, 0.1, 0.1) });
    y -= 30;

    // ══════════════════════════════════════════════════════
    // META BLOCK
    // ══════════════════════════════════════════════════════
    const deptCode = (requisition.department?.code || 'CSS').toUpperCase();
    const createdDate = new Date(requisition.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();

    // ── Compute FROM / TO based on the filtered chain ──────
    // FROM: always the original creator
    const fromDeptName = sanitizeText((requisition.department?.name || 'ORIGIN DEPARTMENT').toUpperCase());

    // TO: all unique external departments that appear in filteredEvents (ordered by first appearance),
    // joined with "/" so a chain ISAC→FPP→HR shows "FPP/HR" regardless of returns/tossing.
    const originDeptId = requisition.departmentId;
    const externalDeptMap = new Map(); // deptId → dept object, insertion-ordered
    for (const evt of filteredEvents) {
      if (evt.toDeptId && evt.toDeptId !== originDeptId && evt.toDepartment && !externalDeptMap.has(evt.toDeptId)) {
        externalDeptMap.set(evt.toDeptId, evt.toDepartment);
      }
      if (evt.fromDeptId && evt.fromDeptId !== originDeptId && evt.fromDepartment && !externalDeptMap.has(evt.fromDeptId)) {
        externalDeptMap.set(evt.fromDeptId, evt.fromDepartment);
      }
    }
    const externalDepts = [...externalDeptMap.values()];
    const toDeptName = externalDepts.length > 0
      ? sanitizeText(externalDepts.map(d => d.name).join('/').toUpperCase())
      : sanitizeText((requisition.targetDepartment?.name || 'PROCESSING DEPARTMENT').toUpperCase());

    // All signatories: originating dept + every external dept in the chain (deduped, ordered)
    const signatoryDepts = [requisition.department, ...externalDepts].filter(Boolean);

    if (isMemo) {
      // Memo-style header
      const memoRef = requisition.refCode || `CSSG/${deptCode}/MO/${String(id).padStart(3, '0')}`;
      const memoFields = [
        { label: 'REF:', value: memoRef },
        { label: 'DATE:', value: createdDate },
        { label: 'TO:', value: toDeptName },
        { label: 'FROM:', value: fromDeptName },
        { label: 'SUBJECT:', value: sanitizeText((requisition.title || 'Untitled').toUpperCase()) },
      ];
      for (const f of memoFields) {
        page.drawText(f.label, { x: margin, y, size: 10, font: boldFont });
        page.drawText(f.value, { x: margin + 70, y, size: 10, font: f.label === 'SUBJECT:' ? boldFont : font });
        y -= 18;
      }
      y -= 5;
      page.drawLine({ start: { x: margin, y }, end: { x: A4_W - margin, y }, thickness: 1.5 });
      y -= 20;
    } else {
      // Requisition Voucher header
      const creatorName = sanitizeText(requisition.department?.headName || '');
      const refValue = requisition.refCode || `#${id}`;
      const leftFields = [
        { label: 'Reference No:', value: refValue },
        { label: 'From:', value: sanitizeText(requisition.department?.name || 'Origin Department') },
        { label: 'To:', value: sanitizeText(externalDepts.length > 0 ? externalDepts.map(d => d.name).join('/') : (requisition.targetDepartment?.name || 'Processing Department')) },
        { label: 'Title:', value: sanitizeText(requisition.title || 'Untitled') },
        { label: 'Type:', value: sanitizeText(requisition.type || 'General') },
        { label: 'Urgency:', value: (requisition.urgency || 'normal').toUpperCase() },
        ...(creatorName ? [{ label: 'Created by:', value: creatorName }] : []),
      ];
      // Right side: Date + Amount
      page.drawText(`Date: ${createdDate}`, { x: A4_W - margin - 200, y, size: 10, font: boldFont });
      if (isFinancial) {
        // ICC's post-approval override (via the ICC Vets Protocol) takes priority over Audit's
        // earlier pre-approval override — mirrors getEffectiveReqAmount used elsewhere.
        const _iccAmt   = (requisition.hasIccOverride && requisition.iccOverrideAmount != null) ? Number(requisition.iccOverrideAmount) : null;
        const _auditAmt = (requisition.hasAuditOverride && requisition.auditAmount != null) ? Number(requisition.auditAmount) : null;
        const _overrideAmt = _iccAmt ?? _auditAmt;
        const _displayAmt = _overrideAmt ?? Number(requisition.amount || 0);
        page.drawText(`Amount: NGN ${_displayAmt.toLocaleString()}`, { x: A4_W - margin - 200, y: y - 18, size: 11, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
        if (_overrideAmt != null) {
          page.drawText(`Originally: NGN ${Number(requisition.amount || 0).toLocaleString()}`, { x: A4_W - margin - 200, y: y - 32, size: 8, font: italicFont, color: rgb(0.5, 0.5, 0.5) });
        }
      }

      for (const f of leftFields) {
        page.drawText(`${f.label}`, { x: margin, y, size: 10, font: boldFont });
        page.drawText(f.value, { x: margin + 85, y, size: 10, font });
        y -= 17;
      }
      y -= 10;
      drawHR(1);
    }

    // ══════════════════════════════════════════════════════
    // CONTENT BODY
    // ══════════════════════════════════════════════════════
    const _hasAuditOverride = !isMemo && !!requisition.hasAuditOverride && !!requisition.auditContent;
    let _auditOverrideParsed = null;
    if (_hasAuditOverride) { try { _auditOverrideParsed = JSON.parse(requisition.auditContent); } catch {} }
    const _hasIccOverride = !isMemo && !!requisition.hasIccOverride && !!requisition.iccOverrideContent;
    let _iccOverrideParsed = null;
    if (_hasIccOverride) { try { _iccOverrideParsed = JSON.parse(requisition.iccOverrideContent); } catch {} }
    const _hasAnyOverride = _hasAuditOverride || _hasIccOverride;

    ensureSpace(60);
    const _contentLabel = isMemo ? 'BODY:' : (_hasAnyOverride ? "CREATOR'S ESTIMATE (ORIGINAL):" : 'DESCRIPTION / CONTENT:');
    page.drawText(_contentLabel, { x: margin, y, size: 10, font: boldFont, color: rgb(0.2, 0.2, 0.2) });
    if (_hasAnyOverride) {
      page.drawText('FOR REFERENCE', { x: margin + boldFont.widthOfTextAtSize(_contentLabel, 10) + 8, y: y + 1, size: 8, font: italicFont, color: rgb(0.5, 0.3, 0.7) });
    }
    y -= 18;

    // Prefer rich HTML content (from Document Studio), fallback to plain description
    let rawContent = requisition.content || requisition.description || 'No content provided.';

    // Smart Parsing for JSON content (Cash/Material separation)
    let parsedContent = null;
    if (rawContent.startsWith('{')) {
      try { parsedContent = JSON.parse(rawContent); } catch (e) { /* fallback */ }
    }

    const hasItems = parsedContent && Array.isArray(parsedContent.items) && parsedContent.items.length > 0;

    if (hasItems) {
      // ── Itemized Table for Cash Requests ──────────────────────────────────
      const items = parsedContent.items;
      const itemComment = parsedContent.comment ? sanitizeText(parsedContent.comment) : null;
      if (itemComment) { drawWrappedText(itemComment, { indent: 5 }); y -= 10; }

      // Column widths — S/N | Item Description | Quantity | Unit Price | Total (N | K)
      // Total contentWidth = 495
      const snW = 28, descW = 230, qtyW = 55, upW = 85, totNW = 67, totKW = 30;
      const snX   = margin;
      const descX = snX + snW;
      const qtyX  = descX + descW;
      const upX   = qtyX + qtyW;
      const totNX = upX + upW;
      const totKX = totNX + totNW;
      const tableRight = totKX + totKW;
      const rowH = 18, headerH = 20;
      const tableH = headerH + rowH * (items.length + 1); // +1 for total row

      ensureSpace(tableH + 20);
      const tableTop = y;

      // Header background
      page.drawRectangle({ x: snX, y: tableTop - headerH, width: tableRight - snX, height: headerH, color: rgb(0.92, 0.94, 0.98), opacity: 1 });

      // Outer border
      const borderC = rgb(0.15, 0.15, 0.15);
      page.drawLine({ start: { x: snX, y: tableTop }, end: { x: tableRight, y: tableTop }, thickness: 0.8, color: borderC });
      page.drawLine({ start: { x: snX, y: tableTop - tableH }, end: { x: tableRight, y: tableTop - tableH }, thickness: 0.8, color: borderC });
      page.drawLine({ start: { x: snX, y: tableTop }, end: { x: snX, y: tableTop - tableH }, thickness: 0.8, color: borderC });
      page.drawLine({ start: { x: tableRight, y: tableTop }, end: { x: tableRight, y: tableTop - tableH }, thickness: 0.8, color: borderC });

      // Header bottom line
      page.drawLine({ start: { x: snX, y: tableTop - headerH }, end: { x: tableRight, y: tableTop - headerH }, thickness: 0.8, color: borderC });

      // Vertical column separators (full table height)
      for (const colX of [descX, qtyX, upX, totNX, totKX]) {
        page.drawLine({ start: { x: colX, y: tableTop }, end: { x: colX, y: tableTop - tableH }, thickness: 0.5, color: rgb(0.35, 0.35, 0.35) });
      }

      // Column header labels
      const hdrY = tableTop - headerH + 6;
      page.drawText('S/N',              { x: snX + 5,               y: hdrY, size: 9, font: boldFont });
      page.drawText('Item Description', { x: descX + 5,             y: hdrY, size: 9, font: boldFont });
      page.drawText('Quantity',         { x: qtyX + 4,              y: hdrY, size: 9, font: boldFont });
      page.drawText('Unit Price',       { x: upX + 5,               y: hdrY, size: 9, font: boldFont });
      page.drawText('N',  { x: totNX + totNW / 2 - boldFont.widthOfTextAtSize('N', 9) / 2, y: hdrY, size: 9, font: boldFont });
      page.drawText('K',  { x: totKX + totKW / 2 - boldFont.widthOfTextAtSize('K', 9) / 2, y: hdrY, size: 9, font: boldFont });

      // Data rows
      const maxDescChars = Math.floor(descW / (font.widthOfTextAtSize('M', 9) * 0.58));
      let rowY = tableTop - headerH;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const unitPrice = item.amount || 0;
        const lineTotal = item.lineTotal != null ? item.lineTotal : (item.qty || 1) * unitPrice;
        const totNaira = Math.floor(lineTotal);
        const totKobo = Math.round((lineTotal - totNaira) * 100);
        rowY -= rowH;
        page.drawLine({ start: { x: snX, y: rowY }, end: { x: tableRight, y: rowY }, thickness: 0.3, color: rgb(0.55, 0.55, 0.55) });
        const cellY = rowY + 5;
        page.drawText(String(i + 1), { x: snX + 10, y: cellY, size: 9, font });
        const desc = sanitizeText(item.description || '');
        const truncDesc = desc.length > maxDescChars ? desc.substring(0, maxDescChars - 2) + '..' : desc;
        page.drawText(truncDesc, { x: descX + 5, y: cellY, size: 9, font });
        const qtyStr = String(item.qty ?? 1);
        page.drawText(qtyStr, { x: qtyX + qtyW / 2 - font.widthOfTextAtSize(qtyStr, 9) / 2, y: cellY, size: 9, font });
        const upStr = Number(Math.floor(unitPrice)).toLocaleString();
        page.drawText(upStr, { x: upX + upW - font.widthOfTextAtSize(upStr, 9) - 4, y: cellY, size: 9, font });
        const totNStr = Number(totNaira).toLocaleString();
        page.drawText(totNStr, { x: totNX + totNW - font.widthOfTextAtSize(totNStr, 9) - 4, y: cellY, size: 9, font });
        page.drawText(totKobo > 0 ? String(totKobo).padStart(2, '0') : '00', { x: totKX + 5, y: cellY, size: 9, font });
      }

      // Total row
      rowY -= rowH;
      page.drawLine({ start: { x: snX, y: rowY + rowH }, end: { x: tableRight, y: rowY + rowH }, thickness: 0.8, color: borderC });
      const grandTotal = items.reduce((sum, it) => sum + (it.lineTotal != null ? it.lineTotal : (it.qty || 1) * (it.amount || 0)), 0);
      const totalNaira = Math.floor(grandTotal);
      const totalKobo = Math.round((grandTotal - totalNaira) * 100);
      const totalLabel = 'TOTAL';
      page.drawText(totalLabel, { x: totNX - boldFont.widthOfTextAtSize(totalLabel, 10) - 8, y: rowY + 5, size: 10, font: boldFont });
      const totalNairaStr = Number(totalNaira).toLocaleString();
      page.drawText(totalNairaStr, { x: totNX + totNW - boldFont.widthOfTextAtSize(totalNairaStr, 10) - 4, y: rowY + 5, size: 10, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
      page.drawText(totalKobo > 0 ? String(totalKobo).padStart(2, '0') : '00', { x: totKX + 5, y: rowY + 5, size: 10, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
      y = rowY - 15;

    } else {
      // ── Plain text fallback ────────────────────────────────────────────────
      if (parsedContent) rawContent = parsedContent.description || parsedContent.comment || rawContent;
      const plainContent = sanitizeText(stripHtml(rawContent));
      const paragraphs = plainContent.split(/\n+/).filter(Boolean);
      for (const para of paragraphs) {
        ensureSpace(20);
        drawWrappedText(para, { indent: isMemo ? 20 : 5 });
        y -= 5;
      }

      // ── Amount block (for Requisition Voucher only) ─────
      if (!isMemo && isFinancial) {
        y -= 10;
        ensureSpace(40);
        page.drawLine({ start: { x: margin, y: y + 8 }, end: { x: A4_W - margin, y: y + 8 }, thickness: 0.5 });
        const amtLabel = 'TOTAL AMOUNT:';
        const amtValue = `NGN ${Number(requisition.amount).toLocaleString()}`;
        page.drawText(amtLabel, { x: margin, y, size: 12, font: boldFont });
        page.drawText(amtValue, { x: A4_W - margin - boldFont.widthOfTextAtSize(amtValue, 12), y, size: 12, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
        y -= 25;
      }

      // ── Payment Summary (only when Account has treated / partially paid) ─────
      if (!isMemo && requisition.amountDisbursed != null) {
        const reqAmt   = Number(requisition.amount || 0);
        const disbursed = Number(requisition.amountDisbursed);
        const remaining = reqAmt > 0 ? Math.max(0, reqAmt - disbursed) : null;
        const isPartialTreatment = requisition.treatmentType === 'partial' || (remaining !== null && remaining > 0);
        const isAdjusted = requisition.treatmentType === 'adjusted';
        const payBoxColor = isPartialTreatment ? rgb(0.95, 0.60, 0.1) : rgb(0.1, 0.50, 0.2);
        const payLabelColor = isPartialTreatment ? rgb(0.55, 0.3, 0.0) : rgb(0.05, 0.30, 0.1);

        ensureSpace(80);
        y -= 8;
        // Header bar
        page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 18, color: isPartialTreatment ? rgb(1.0, 0.93, 0.80) : rgb(0.88, 0.97, 0.88) });
        const payHdrText = isPartialTreatment ? 'PARTIAL PAYMENT RECORD' : isAdjusted ? 'ADJUSTED PAYMENT RECORD' : 'PAYMENT RECORD — FULLY TREATED';
        page.drawText(payHdrText, { x: margin + 6, y: y + 3, size: 10, font: boldFont, color: payBoxColor });
        y -= 22;

        // Amount Requested
        if (reqAmt > 0) {
          page.drawText('Amount Requested:', { x: margin + 6, y, size: 10, font });
          const reqTxt = `NGN ${reqAmt.toLocaleString()}`;
          page.drawText(reqTxt, { x: A4_W - margin - font.widthOfTextAtSize(reqTxt, 10), y, size: 10, font });
          y -= 16;
        }

        // Amount Disbursed
        page.drawText('Amount Disbursed:', { x: margin + 6, y, size: 11, font: boldFont, color: payLabelColor });
        const disbTxt = `NGN ${disbursed.toLocaleString()}`;
        page.drawText(disbTxt, { x: A4_W - margin - boldFont.widthOfTextAtSize(disbTxt, 11), y, size: 11, font: boldFont, color: payLabelColor });
        y -= 16;

        // Remaining Balance (only if partial and original amount known)
        if (isPartialTreatment && remaining !== null) {
          page.drawText('Balance Outstanding:', { x: margin + 6, y, size: 11, font: boldFont, color: rgb(0.7, 0.2, 0.0) });
          const balTxt = `NGN ${remaining.toLocaleString()}`;
          page.drawText(balTxt, { x: A4_W - margin - boldFont.widthOfTextAtSize(balTxt, 11), y, size: 11, font: boldFont, color: rgb(0.7, 0.2, 0.0) });
          y -= 16;
          page.drawText('(Partial payment — balance pending disbursement)', { x: margin + 6, y, size: 8, font: italicFont, color: rgb(0.6, 0.3, 0.0) });
          y -= 14;
        } else if (!isPartialTreatment) {
          page.drawText(isAdjusted ? '(Treated with adjusted/negotiated amount)' : '(Fully disbursed — no outstanding balance)', { x: margin + 6, y, size: 8, font: italicFont, color: rgb(0.1, 0.4, 0.1) });
          y -= 14;
        }
        y -= 8;
      }
    }

    // ══════════════════════════════════════════════════════
    // AUDIT VERIFIED ITEMS TABLE
    // ══════════════════════════════════════════════════════
    if (_hasAuditOverride && _auditOverrideParsed?.items?.length > 0) {
      const auditItems = _auditOverrideParsed.items;
      const auditComment = _auditOverrideParsed.comment ? sanitizeText(_auditOverrideParsed.comment) : null;
      const auditHdrColor = rgb(0.35, 0.1, 0.55);

      y -= 10;
      ensureSpace(30);
      page.drawText('AUDIT VERIFIED AMOUNT', { x: margin, y, size: 10, font: boldFont, color: auditHdrColor });
      const _auditBadgeText = _hasIccOverride ? 'SUPERSEDED BY ICC' : 'EFFECTIVE FOR APPROVAL & PAYMENT';
      page.drawText(_auditBadgeText, {
        x: margin + boldFont.widthOfTextAtSize('AUDIT VERIFIED AMOUNT', 10) + 8, y: y + 1, size: 8, font: italicFont, color: _hasIccOverride ? rgb(0.5, 0.5, 0.5) : auditHdrColor
      });
      y -= 14;
      page.drawText('Verified by: Audit', { x: margin, y, size: 9, font: italicFont, color: rgb(0.45, 0.15, 0.65) });
      y -= 14;

      if (auditComment) { drawWrappedText(auditComment, { indent: 5, textFont: italicFont, fontSize: 9 }); y -= 5; }

      const asnW = 28, adescW = 230, aqtyW = 55, aupW = 85, atotNW = 67, atotKW = 30;
      const asnX = margin, adescX = asnX + asnW, aqtyX = adescX + adescW;
      const aupX = aqtyX + aqtyW, atotNX = aupX + aupW, atotKX = atotNX + atotNW;
      const atableRight = atotKX + atotKW;
      const arowH = 18, aheaderH = 20;
      const atableH = aheaderH + arowH * (auditItems.length + 1);

      ensureSpace(atableH + 20);
      const atableTop = y;

      page.drawRectangle({ x: asnX, y: atableTop - aheaderH, width: atableRight - asnX, height: aheaderH, color: rgb(0.93, 0.88, 0.97), opacity: 1 });
      const aborderC = auditHdrColor;
      page.drawLine({ start: { x: asnX, y: atableTop }, end: { x: atableRight, y: atableTop }, thickness: 0.8, color: aborderC });
      page.drawLine({ start: { x: asnX, y: atableTop - atableH }, end: { x: atableRight, y: atableTop - atableH }, thickness: 0.8, color: aborderC });
      page.drawLine({ start: { x: asnX, y: atableTop }, end: { x: asnX, y: atableTop - atableH }, thickness: 0.8, color: aborderC });
      page.drawLine({ start: { x: atableRight, y: atableTop }, end: { x: atableRight, y: atableTop - atableH }, thickness: 0.8, color: aborderC });
      page.drawLine({ start: { x: asnX, y: atableTop - aheaderH }, end: { x: atableRight, y: atableTop - aheaderH }, thickness: 0.8, color: aborderC });
      for (const colX of [adescX, aqtyX, aupX, atotNX, atotKX]) {
        page.drawLine({ start: { x: colX, y: atableTop }, end: { x: colX, y: atableTop - atableH }, thickness: 0.5, color: rgb(0.45, 0.2, 0.6) });
      }

      const ahdrY = atableTop - aheaderH + 6;
      page.drawText('S/N',              { x: asnX + 5,   y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });
      page.drawText('Item Description', { x: adescX + 5, y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });
      page.drawText('Quantity',         { x: aqtyX + 4,  y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });
      page.drawText('Unit Price',       { x: aupX + 5,   y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });
      page.drawText('N', { x: atotNX + atotNW / 2 - boldFont.widthOfTextAtSize('N', 9) / 2, y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });
      page.drawText('K', { x: atotKX + atotKW / 2 - boldFont.widthOfTextAtSize('K', 9) / 2, y: ahdrY, size: 9, font: boldFont, color: auditHdrColor });

      const amaxDescChars = Math.floor(adescW / (font.widthOfTextAtSize('M', 9) * 0.58));
      let arowY = atableTop - aheaderH;
      for (let i = 0; i < auditItems.length; i++) {
        const item = auditItems[i];
        const unitPrice = item.amount || 0;
        const lineTotal = item.lineTotal != null ? item.lineTotal : (item.qty || 1) * unitPrice;
        const totNaira = Math.floor(lineTotal);
        const totKobo = Math.round((lineTotal - totNaira) * 100);
        arowY -= arowH;
        page.drawLine({ start: { x: asnX, y: arowY }, end: { x: atableRight, y: arowY }, thickness: 0.3, color: rgb(0.55, 0.35, 0.7) });
        const acellY = arowY + 5;
        page.drawText(String(i + 1), { x: asnX + 10, y: acellY, size: 9, font });
        const desc = sanitizeText(item.description || '');
        page.drawText(desc.length > amaxDescChars ? desc.substring(0, amaxDescChars - 2) + '..' : desc, { x: adescX + 5, y: acellY, size: 9, font });
        const qtyStr = String(item.qty ?? 1);
        page.drawText(qtyStr, { x: aqtyX + aqtyW / 2 - font.widthOfTextAtSize(qtyStr, 9) / 2, y: acellY, size: 9, font });
        const upStr = Number(Math.floor(unitPrice)).toLocaleString();
        page.drawText(upStr, { x: aupX + aupW - font.widthOfTextAtSize(upStr, 9) - 4, y: acellY, size: 9, font });
        const totNStr = Number(totNaira).toLocaleString();
        page.drawText(totNStr, { x: atotNX + atotNW - font.widthOfTextAtSize(totNStr, 9) - 4, y: acellY, size: 9, font });
        page.drawText(totKobo > 0 ? String(totKobo).padStart(2, '0') : '00', { x: atotKX + 5, y: acellY, size: 9, font });
      }

      arowY -= arowH;
      page.drawLine({ start: { x: asnX, y: arowY + arowH }, end: { x: atableRight, y: arowY + arowH }, thickness: 0.8, color: aborderC });
      const agrandTotal = auditItems.reduce((sum, it) => sum + (it.lineTotal != null ? it.lineTotal : (it.qty || 1) * (it.amount || 0)), 0);
      const atotalNaira = Math.floor(agrandTotal);
      const atotalKobo = Math.round((agrandTotal - atotalNaira) * 100);
      const atotalLabel = 'GRAND TOTAL';
      page.drawText(atotalLabel, { x: atotNX - boldFont.widthOfTextAtSize(atotalLabel, 10) - 8, y: arowY + 5, size: 10, font: boldFont, color: auditHdrColor });
      const atotalNairaStr = Number(atotalNaira).toLocaleString();
      page.drawText(atotalNairaStr, { x: atotNX + atotNW - boldFont.widthOfTextAtSize(atotalNairaStr, 10) - 4, y: arowY + 5, size: 10, font: boldFont, color: auditHdrColor });
      page.drawText(atotalKobo > 0 ? String(atotalKobo).padStart(2, '0') : '00', { x: atotKX + 5, y: arowY + 5, size: 10, font: boldFont, color: auditHdrColor });
      y = arowY - 15;
    }

    // ══════════════════════════════════════════════════════
    // ICC VERIFIED ITEMS TABLE (ICC Vets Protocol) — always the effective amount when present
    // ══════════════════════════════════════════════════════
    if (_hasIccOverride && _iccOverrideParsed?.items?.length > 0) {
      const iccItems = _iccOverrideParsed.items;
      const iccComment = _iccOverrideParsed.comment ? sanitizeText(_iccOverrideParsed.comment) : null;
      const iccHdrColor = rgb(0.45, 0.25, 0.75);

      y -= 10;
      ensureSpace(30);
      page.drawText('ICC VERIFIED AMOUNT', { x: margin, y, size: 10, font: boldFont, color: iccHdrColor });
      page.drawText('EFFECTIVE FOR APPROVAL & PAYMENT', {
        x: margin + boldFont.widthOfTextAtSize('ICC VERIFIED AMOUNT', 10) + 8, y: y + 1, size: 8, font: italicFont, color: iccHdrColor
      });
      y -= 14;
      page.drawText(`Verified by: ${sanitizeText(requisition.iccOverrideDeptName || 'ICC')}`, { x: margin, y, size: 9, font: italicFont, color: rgb(0.35, 0.2, 0.6) });
      y -= 14;

      if (iccComment) { drawWrappedText(iccComment, { indent: 5, textFont: italicFont, fontSize: 9 }); y -= 5; }

      const isnW = 28, idescW = 230, iqtyW = 55, iupW = 85, itotNW = 67, itotKW = 30;
      const isnX = margin, idescX = isnX + isnW, iqtyX = idescX + idescW;
      const iupX = iqtyX + iqtyW, itotNX = iupX + iupW, itotKX = itotNX + itotNW;
      const itableRight = itotKX + itotKW;
      const irowH = 18, iheaderH = 20;
      const itableH = iheaderH + irowH * (iccItems.length + 1);

      ensureSpace(itableH + 20);
      const itableTop = y;

      page.drawRectangle({ x: isnX, y: itableTop - iheaderH, width: itableRight - isnX, height: iheaderH, color: rgb(0.93, 0.90, 0.98), opacity: 1 });
      const iborderC = iccHdrColor;
      page.drawLine({ start: { x: isnX, y: itableTop }, end: { x: itableRight, y: itableTop }, thickness: 0.8, color: iborderC });
      page.drawLine({ start: { x: isnX, y: itableTop - itableH }, end: { x: itableRight, y: itableTop - itableH }, thickness: 0.8, color: iborderC });
      page.drawLine({ start: { x: isnX, y: itableTop }, end: { x: isnX, y: itableTop - itableH }, thickness: 0.8, color: iborderC });
      page.drawLine({ start: { x: itableRight, y: itableTop }, end: { x: itableRight, y: itableTop - itableH }, thickness: 0.8, color: iborderC });
      page.drawLine({ start: { x: isnX, y: itableTop - iheaderH }, end: { x: itableRight, y: itableTop - iheaderH }, thickness: 0.8, color: iborderC });
      for (const colX of [idescX, iqtyX, iupX, itotNX, itotKX]) {
        page.drawLine({ start: { x: colX, y: itableTop }, end: { x: colX, y: itableTop - itableH }, thickness: 0.5, color: rgb(0.55, 0.4, 0.7) });
      }

      const ihdrY = itableTop - iheaderH + 6;
      page.drawText('S/N',              { x: isnX + 5,   y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });
      page.drawText('Item Description', { x: idescX + 5, y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });
      page.drawText('Quantity',         { x: iqtyX + 4,  y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });
      page.drawText('Unit Price',       { x: iupX + 5,   y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });
      page.drawText('N', { x: itotNX + itotNW / 2 - boldFont.widthOfTextAtSize('N', 9) / 2, y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });
      page.drawText('K', { x: itotKX + itotKW / 2 - boldFont.widthOfTextAtSize('K', 9) / 2, y: ihdrY, size: 9, font: boldFont, color: iccHdrColor });

      const imaxDescChars = Math.floor(idescW / (font.widthOfTextAtSize('M', 9) * 0.58));
      let irowY = itableTop - iheaderH;
      for (let i = 0; i < iccItems.length; i++) {
        const item = iccItems[i];
        const unitPrice = item.amount || 0;
        const lineTotal = item.lineTotal != null ? item.lineTotal : (item.qty || 1) * unitPrice;
        const totNaira = Math.floor(lineTotal);
        const totKobo = Math.round((lineTotal - totNaira) * 100);
        irowY -= irowH;
        page.drawLine({ start: { x: isnX, y: irowY }, end: { x: itableRight, y: irowY }, thickness: 0.3, color: rgb(0.6, 0.5, 0.75) });
        const icellY = irowY + 5;
        page.drawText(String(i + 1), { x: isnX + 10, y: icellY, size: 9, font });
        const desc = sanitizeText(item.description || '');
        page.drawText(desc.length > imaxDescChars ? desc.substring(0, imaxDescChars - 2) + '..' : desc, { x: idescX + 5, y: icellY, size: 9, font });
        const qtyStr = String(item.qty ?? 1);
        page.drawText(qtyStr, { x: iqtyX + iqtyW / 2 - font.widthOfTextAtSize(qtyStr, 9) / 2, y: icellY, size: 9, font });
        const upStr = Number(Math.floor(unitPrice)).toLocaleString();
        page.drawText(upStr, { x: iupX + iupW - font.widthOfTextAtSize(upStr, 9) - 4, y: icellY, size: 9, font });
        const totNStr = Number(totNaira).toLocaleString();
        page.drawText(totNStr, { x: itotNX + itotNW - font.widthOfTextAtSize(totNStr, 9) - 4, y: icellY, size: 9, font });
        page.drawText(totKobo > 0 ? String(totKobo).padStart(2, '0') : '00', { x: itotKX + 5, y: icellY, size: 9, font });
      }

      irowY -= irowH;
      page.drawLine({ start: { x: isnX, y: irowY + irowH }, end: { x: itableRight, y: irowY + irowH }, thickness: 0.8, color: iborderC });
      const igrandTotal = iccItems.reduce((sum, it) => sum + (it.lineTotal != null ? it.lineTotal : (it.qty || 1) * (it.amount || 0)), 0);
      const itotalNaira = Math.floor(igrandTotal);
      const itotalKobo = Math.round((igrandTotal - itotalNaira) * 100);
      const itotalLabel = 'GRAND TOTAL';
      page.drawText(itotalLabel, { x: itotNX - boldFont.widthOfTextAtSize(itotalLabel, 10) - 8, y: irowY + 5, size: 10, font: boldFont, color: iccHdrColor });
      const itotalNairaStr = Number(itotalNaira).toLocaleString();
      page.drawText(itotalNairaStr, { x: itotNX + itotNW - boldFont.widthOfTextAtSize(itotalNairaStr, 10) - 4, y: irowY + 5, size: 10, font: boldFont, color: iccHdrColor });
      page.drawText(itotalKobo > 0 ? String(itotalKobo).padStart(2, '0') : '00', { x: itotKX + 5, y: irowY + 5, size: 10, font: boldFont, color: iccHdrColor });
      y = irowY - 15;
    }

    // ══════════════════════════════════════════════════════
    // PROCESSING CHAIN (ForwardEvents)
    // ══════════════════════════════════════════════════════
    if (filteredEvents.length > 0) {
      ensureSpace(60);
      y -= 10;
      drawHR(1, rgb(0.1, 0.22, 0.43));
      page.drawText('PROCESSING CHAIN — FILE MOVEMENT HISTORY', { x: margin, y, size: 10, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
      y -= 20;

      // Layout: left column = event text (margin → margin+295)
      //         right column = signature + seal (margin+310 → A4_W-margin)
      //           sub-cols:  sig at sigColX (width 65), seal centred at sealCX
      const leftColMax = margin + 295;
      const sigColX = margin + 315;
      const sigColW = 65;
      const sealCX = sigColX + sigColW + 16 + 38; // after sig + gap + seal radius
      const minRowH = 95; // minimum pts per row so seal always fits

      for (let i = 0; i < filteredEvents.length; i++) {
        const evt = filteredEvents[i];
        ensureSpace(minRowH);

        const rowTopY = y; // top of this row in pdf-lib coords (y up)
        let textY = y; // cursor for left-column text

        const actionLabel = evt.action === 'created' ? 'CREATED'
          : evt.action === 'forwarded' ? 'FORWARDED' : 'RETURNED';
        const fromName = sanitizeText(evt.fromDepartment?.name || 'Department');
        const toName = sanitizeText(evt.toDepartment?.name || 'Sender');

        // Format comment — if JSON (like in CashRequests), extract the plain note
        let rawNote = evt.note || '';
        if (rawNote.startsWith('{')) {
          try {
            const parsed = JSON.parse(rawNote);
            rawNote = parsed.description || parsed.comment || rawNote;
          } catch { }
        }
        const evtComment = sanitizeText(rawNote);
        const evtDateStr = new Date(evt.createdAt).toLocaleString();

        // ── LEFT COLUMN: event text ───────────────────────
        page.drawText(`${i + 1}.`, { x: margin, y: textY, size: 9, font: boldFont });
        page.drawText(`[${actionLabel}]`, {
          x: margin + 15, y: textY, size: 9, font: boldFont,
          color: evt.action === 'returned' ? rgb(0.8, 0.4, 0) : rgb(0.1, 0.5, 0.2)
        });
        page.drawText(`${fromName}  ->  ${toName}`, { x: margin + 85, y: textY, size: 9, font });
        textY -= 13;

        page.drawText(`Date: ${evtDateStr}`, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
        const fwdActorLabel = formatActorLabel(evt.fromDepartment?.headName, evt.fromDepartment?.headTitle, evt.actorName);
        if (fwdActorLabel) {
          page.drawText(sanitizeText(`By: ${fwdActorLabel}`), { x: margin + 220, y: textY, size: 8, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
        }
        textY -= 13;

        if (evt.note) {
          const noteStr = sanitizeText(`Comment: "${evt.note}"`);
          const maxNC = Math.floor((leftColMax - margin - 30) / (italicFont.widthOfTextAtSize('M', 8) * 0.6));
          const words = noteStr.split(' ');
          let line = '';
          for (const w of words) {
            const t = line ? `${line} ${w}` : w;
            if (t.length > maxNC && line) {
              page.drawText(line, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.2, 0.2, 0.2) });
              textY -= 11; line = w;
            } else { line = t; }
          }
          if (line) { page.drawText(line, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.2, 0.2, 0.2) }); textY -= 11; }
        }

        // ── RIGHT COLUMN: signature + seal ───────────────
        const sigData = deptSigMap.get(evt.fromDeptId);
        const sealDate = new Date(evt.createdAt).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric'
        }).toUpperCase();

        // Signature image — positioned from row top
        let sigBot = rowTopY - 3;
        if (showSignatureOnPdf && sigData?.sigBytes) {
          try {
            const sigImg = await embedSafe(sigData.sigBytes);
            if (sigImg) {
              const scale = Math.min(sigColW / sigImg.width, 35 / sigImg.height);
              const sw = sigImg.width * scale, sh = sigImg.height * scale;
              page.drawImage(sigImg, { x: sigColX, y: sigBot - sh, width: sw, height: sh, opacity: 0.9 });
              sigBot -= sh;
            }
          } catch { }
        }

        // Head name + title below signature
        if (showSignatureOnPdf && sigData?.headName) {
          page.drawText(sigData.headName, { x: sigColX, y: sigBot - 8, size: 7, font: italicFont, color: rgb(0.15, 0.15, 0.15) });
          sigBot -= 10;
          if (sigData.headTitle) {
            const ht = sigData.headTitle.length > 30 ? sigData.headTitle.substring(0, 28) + '..' : sigData.headTitle;
            page.drawText(ht, { x: sigColX, y: sigBot - 7, size: 6, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
          }
        }

        // Auto-generated seal — centred at sealCX, 38pts below row top
        const sealCY = rowTopY - 38;
        if (showStampOnPdf) await drawSeal(page, sealCX, sealCY, evt.fromDepartment?.name || '', sealDate);

        // Advance y past both columns + breathing room
        y = Math.min(textY, showStampOnPdf ? sealCY - 38 : textY - 8) - 12;
      }
    }

    // ══════════════════════════════════════════════════════
    // VETTING CHAIN (ICC → Audit → Account movements)
    // ══════════════════════════════════════════════════════
    if (vettingEvents.length > 0) {
      ensureSpace(60);
      y -= 10;
      drawHR(1, rgb(0.35, 0.1, 0.55));
      page.drawText('VETTING CHAIN — COMPLIANCE MOVEMENT HISTORY', { x: margin, y, size: 10, font: boldFont, color: rgb(0.35, 0.1, 0.55) });
      y -= 20;

      const vLeftColMax = margin + 295;
      const vSigColX    = margin + 315;
      const vSigColW    = 65;
      const vSealCX     = vSigColX + vSigColW + 16 + 38;
      const vMinRowH    = 95;

      const vActionLabel = (action) => {
        if (action === 'sent_to_vetting')  return 'SENT TO VETTING';
        if (action === 'forward')          return 'FORWARDED';
        if (action === 'return')           return 'RETURNED';
        if (action === 'treated')          return 'TREATED';
        if (action === 'icc_vet_forward')  return 'FORWARDED TO ICC';
        if (action === 'icc_vet_return')   return 'ICC VETTING COMPLETE';
        if (action === 'forwarded_for_reapproval') return 'FORWARDED FOR RE-APPROVAL';
        if (action === 'reapproved')       return 'RE-APPROVED';
        return (action || '').toUpperCase().replace(/_/g, ' ');
      };
      const vActionColor = (action) => {
        if (action === 'treated')          return rgb(0.1, 0.5, 0.2);
        if (action === 'return')           return rgb(0.8, 0.4, 0);
        if (action === 'sent_to_vetting')  return rgb(0.35, 0.1, 0.55);
        if (action === 'icc_vet_forward')  return rgb(0.45, 0.25, 0.75);
        if (action === 'icc_vet_return')   return rgb(0.1, 0.5, 0.2);
        if (action === 'forwarded_for_reapproval') return rgb(0.8, 0.55, 0);
        if (action === 'reapproved')       return rgb(0.1, 0.5, 0.2);
        return rgb(0.1, 0.35, 0.7);
      };

      for (let i = 0; i < vettingEvents.length; i++) {
        const evt = vettingEvents[i];
        ensureSpace(vMinRowH);

        const rowTopY = y;
        let textY = y;

        const deptLabel = sanitizeText(evt.deptName || 'Department');
        const evtDateStr = new Date(evt.createdAt).toLocaleString();
        const evtComment = sanitizeText(evt.comment || '');

        // ── LEFT COLUMN: event text ──────────────────────
        page.drawText(`${i + 1}.`, { x: margin, y: textY, size: 9, font: boldFont });
        page.drawText(`[${vActionLabel(evt.action)}]`, {
          x: margin + 15, y: textY, size: 9, font: boldFont,
          color: vActionColor(evt.action)
        });
        page.drawText(deptLabel, { x: margin + 160, y: textY, size: 9, font });
        textY -= 13;

        page.drawText(`Date: ${evtDateStr}`, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
        const vDept = vettingDeptMap[evt.deptId];
        const vetActorLabel = formatActorLabel(vDept?.headName, vDept?.headTitle, evt.actorName || evt.deptName);
        if (vetActorLabel) {
          page.drawText(sanitizeText(`By: ${vetActorLabel}`), { x: margin + 220, y: textY, size: 8, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
        }
        textY -= 13;

        if (evtComment) {
          const maxNC = Math.floor((vLeftColMax - margin - 30) / (italicFont.widthOfTextAtSize('M', 8) * 0.6));
          const words = `Comment: "${evtComment}"`.split(' ');
          let line = '';
          for (const w of words) {
            const t = line ? `${line} ${w}` : w;
            if (t.length > maxNC && line) {
              page.drawText(line, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.2, 0.2, 0.2) });
              textY -= 11; line = w;
            } else { line = t; }
          }
          if (line) { page.drawText(line, { x: margin + 30, y: textY, size: 8, font: italicFont, color: rgb(0.2, 0.2, 0.2) }); textY -= 11; }
        }

        // ── RIGHT COLUMN: signature + seal ──────────────
        const sigData = evt.deptId ? deptSigMap.get(evt.deptId) : null;
        const sealDate = new Date(evt.createdAt).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric'
        }).toUpperCase();

        let sigBot = rowTopY - 3;
        if (showSignatureOnPdf && sigData?.sigBytes) {
          try {
            const sigImg = await embedSafe(sigData.sigBytes);
            if (sigImg) {
              const scale = Math.min(vSigColW / sigImg.width, 35 / sigImg.height);
              const sw = sigImg.width * scale, sh = sigImg.height * scale;
              page.drawImage(sigImg, { x: vSigColX, y: sigBot - sh, width: sw, height: sh, opacity: 0.9 });
              sigBot -= sh;
            }
          } catch { }
        }
        if (showSignatureOnPdf && sigData?.headName) {
          page.drawText(sigData.headName, { x: vSigColX, y: sigBot - 8, size: 7, font: italicFont, color: rgb(0.15, 0.15, 0.15) });
          sigBot -= 10;
          if (sigData.headTitle) {
            const ht = sigData.headTitle.length > 30 ? sigData.headTitle.substring(0, 28) + '..' : sigData.headTitle;
            page.drawText(ht, { x: vSigColX, y: sigBot - 7, size: 6, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
          }
        }

        const vSealCY = rowTopY - 38;
        if (showStampOnPdf) await drawSeal(page, vSealCX, vSealCY, evt.deptName || '', sealDate);

        y = Math.min(textY, showStampOnPdf ? vSealCY - 38 : textY - 8) - 12;
      }
    }

    // ══════════════════════════════════════════════════════
    // APPROVAL TRAIL (Admin Workflow)
    // ══════════════════════════════════════════════════════
    if (filteredApprovals.length > 0) {
      ensureSpace(60);
      y -= 10;
      drawHR(1, rgb(0.1, 0.22, 0.43));
      page.drawText('AUTHORIZATION & APPROVAL TRAIL', { x: margin, y, size: 10, font: boldFont, color: rgb(0.1, 0.22, 0.43) });
      y -= 20;

      for (const app of filteredApprovals) {
        ensureSpace(60);
        const stamp = new Date(app.createdAt).toLocaleString();
        const stageName = app.stage?.name || 'Processed';
        const actionLabel = app.action.toUpperCase();
        const userName = app.user?.name || 'Approver';

        page.drawText(`[${actionLabel}]`, { x: margin, y, size: 9, font: boldFont, color: app.action === 'approved' ? rgb(0.1, 0.5, 0.2) : rgb(0.8, 0.1, 0.1) });
        page.drawText(sanitizeText(`${stageName} by ${userName}`), { x: margin + 80, y, size: 9, font });
        y -= 13;
        page.drawText(`Date: ${stamp}`, { x: margin + 20, y, size: 8, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
        y -= 13;

        if (app.remarks) {
          page.drawText(sanitizeText(`Remarks: "${app.remarks}"`), { x: margin + 20, y, size: 8, font: italicFont });
          y -= 13;
        }

        // Embed approver's digital signature
        const isSuperAdmin = app.user?.role === 'global_admin' || app.user?.email === SUPER_ADMIN_EMAIL;
        if (app.user?.signature?.imageKey) {
          try {
            const sigBuf = await getObjectBuffer(app.user.signature.imageKey);
            const sigImg = await embedSafe(sigBuf);
            if (sigImg) {
              ensureSpace(35);
              const dims = sigImg.scale(0.13);
              page.drawImage(sigImg, { x: A4_W - margin - dims.width - 10, y: y, width: dims.width, height: dims.height, opacity: 0.85 });
              page.drawText(`${userName}`, { x: A4_W - margin - dims.width - 10, y: y - 8, size: 6, font: italicFont, color: rgb(0.4, 0.4, 0.4) });
              if (isSuperAdmin) {
                page.drawText('TRADE MARK', { x: A4_W - margin - 50, y: y - 16, size: 5, font: boldFont, color: rgb(0.1, 0.3, 0.7) });
              }
            }
          } catch (_) { /* sig skip */ }
        } else if (isSuperAdmin) {
          // Fallback: Trade Mark seal for admin without uploaded signature
          ensureSpace(25);
          const tmText = 'GLOBAL AUTHORITY — TRADE MARK';
          const tmWidth = font.widthOfTextAtSize(tmText, 7);
          page.drawRectangle({ x: A4_W - margin - tmWidth - 20, y: y - 3, width: tmWidth + 14, height: 16, borderColor: rgb(0.1, 0.3, 0.7), borderWidth: 1, opacity: 0.8 });
          page.drawText(tmText, { x: A4_W - margin - tmWidth - 13, y: y + 2, size: 7, font: boldFont, color: rgb(0.1, 0.3, 0.7) });
        }
        y -= 15;
      }
    }

    // ── Final Footer ────────────────────────────────────
    const footerText = `Generated by RMS on ${new Date().toLocaleString()} | Page ${pageNumber}`;
    page.drawText(footerText, { x: A4_W / 2 - font.widthOfTextAtSize(footerText, 7) / 2, y: 20, size: 7, font: italicFont, color: rgb(0.5, 0.5, 0.5) });

    // ── Serve PDF ───────────────────────────────────────
    const pdfBytes = await pdfDoc.save();
    const fileName = isMemo ? `CSS-MEMO-${id}.pdf` : `CSS-REQUISITION-${id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    logger.error('Dynamic PDF Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/requisitions', authenticateToken, async (req, res) => {
  try {
    const typeAliases = {
      cash: ['Cash', 'cash', 'Cash Requisition', 'cash requisition'],
      material: ['Material', 'material', 'Material Request', 'material request'],
      memo: ['Memo', 'memo', 'Memorandum', 'memorandum'],
    };
    const requestedScope = String(req.query.scope || '').trim().toLowerCase();
    const requestedTypes = String(req.query.types || '')
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const scopeTypes =
      requestedScope === 'requisitions' || requestedScope === 'requisition' || requestedScope === 'operational'
        ? ['cash', 'material']
        : requestedScope === 'memos' || requestedScope === 'memo'
          ? ['memo']
          : requestedTypes;
    const typeValues = [...new Set(scopeTypes.flatMap(t => typeAliases[t.toLowerCase()] || [t]))];
    const typeScopeWhere = typeValues.length > 0 ? { type: { in: typeValues } } : {};
    let where = typeScopeWhere;
    // Oversight departments (configured by Super Admin): global observer — sees ALL requests
    const _oversightIds = await getOversightDeptIds().catch(() => []);
    const _isGlobalObserver = normalizeRole(req.user.role) === 'department' &&
      _oversightIds.includes(toIntOrNull(req.user?.deptId));
    if (_isGlobalObserver) {
      // Global observer sees everything — typeScopeWhere already applied above, no extra dept filter
    } else if (normalizeRole(req.user.role) === 'department' && req.user.deptId) {
      const deptId = parseInt(req.user.deptId);
      // Extra IDs from columns not in Prisma schema — safe fallback if columns don't exist yet
      let linkedReqIds = await getDepartmentLinkedRequisitionIds(deptId);
      try {
        const vettingIds = await prisma.$queryRaw`
          SELECT id FROM "Requisition"
          WHERE "currentVettingDeptId" = ${deptId}
             OR "finalApprovedByDeptId" = ${deptId}
             OR "treatedByDeptId" = ${deptId}
        `;
        linkedReqIds = [...new Set([...linkedReqIds, ...(vettingIds || []).map(r => parseInt(r.id))])];
      } catch (_) { /* columns not yet migrated — ignore */ }
      let taggedReqIds = [];
      try {
        const tagged = await prisma.requisitionTag.findMany({ where: { deptId }, select: { requisitionId: true } });
        taggedReqIds = tagged.map(t => t.requisitionId);
      } catch (_) {}
      // Parent dept also sees its sub-accounts' requisitions
      let subDeptIds = [];
      if (!req.user.isSubAccount) {
        try {
          const subDepts = await prisma.department.findMany({
            where: { parentId: deptId, isSubAccount: true },
            select: { id: true }
          });
          subDeptIds = subDepts.map(d => d.id);
        } catch (_) {}
      }
      // Sub-accounts see parent dept requests made visible to all, or specifically to them
      let parentVisibleClause = [];
      if (req.user.isSubAccount && req.user.parentDeptId) {
        parentVisibleClause = [{ departmentId: parseInt(req.user.parentDeptId), visibleToSubAccounts: true }];
        // Also include requests where this sub-account has specific visibility (junction table — may not exist yet)
        try {
          const specificVis = await prisma.requisitionSubVisibility.findMany({
            where: { subAccountId: deptId },
            select: { requisitionId: true }
          });
          const specificReqIds = specificVis.map(v => v.requisitionId);
          if (specificReqIds.length > 0) parentVisibleClause.push({ id: { in: specificReqIds } });
        } catch (_) { /* table not yet migrated — safe to skip */ }
      }

      // Privileged sub-account: additional visibility based on privilege settings
      let privilegeClause = [];
      if (req.user.isSubAccount && req.user.parentDeptId) {
        const subPriv = await getSubPrivilege(deptId);
        const parentId = parseInt(req.user.parentDeptId);

        // Cash: see requests at parent dept when cash privilege is enabled
        const cashEnabled = req.user.cashPrivilege || subPriv.cashPrivilege || req.user.privilegeAmount != null || subPriv.privilegeAmount != null;
        if (cashEnabled) {
          const cashPrivLimit = req.user.privilegeAmount != null
            ? parseFloat(req.user.privilegeAmount)
            : subPriv.privilegeAmount;
          const cashTypes = ['Cash', 'cash', 'Cash Requisition', 'cash requisition'];
          if (cashPrivLimit != null && !isNaN(cashPrivLimit)) {
            privilegeClause.push({
              targetDepartmentId: parentId,
              type: { in: cashTypes },
              OR: [
                { hasAuditOverride: false, amount: { lte: cashPrivLimit } },
                { hasAuditOverride: true, auditAmount: { lte: cashPrivLimit } }
              ]
            });
          } else {
            // No amount limit — see all cash requests at parent dept
            privilegeClause.push({ targetDepartmentId: parentId, type: { in: cashTypes } });
          }
        }

        // Memo: see memo requests at parent dept when toggle is on
        const memoOn = req.user.memoPrivilege || subPriv.memoPrivilege;
        if (memoOn) {
          const memoTypes = ['Memo', 'memo', 'Memorandum', 'memorandum'];
          privilegeClause.push({ targetDepartmentId: parentId, type: { in: memoTypes } });
        }

        // Material: see material requests at parent dept when toggle is on
        const materialOn = req.user.materialPrivilege || subPriv.materialPrivilege;
        if (materialOn) {
          const materialTypes = ['Material', 'material', 'Material Request', 'material request'];
          privilegeClause.push({ targetDepartmentId: parentId, type: { in: materialTypes } });
        }
      }

      const accessWhere = {
        OR: [
          { departmentId: deptId },
          { targetDepartmentId: deptId },
          ...(subDeptIds.length > 0 ? [{ departmentId: { in: subDeptIds } }] : []),
          ...(linkedReqIds.length > 0 ? [{ id: { in: linkedReqIds } }] : []),
          ...(taggedReqIds.length > 0 ? [{ id: { in: taggedReqIds } }] : []),
          ...parentVisibleClause,
          ...privilegeClause
        ]
      };
      where = typeValues.length > 0 ? { AND: [accessWhere, typeScopeWhere] } : accessWhere;
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [records, total] = await Promise.all([
      prisma.requisition.findMany({
        where,
        include: {
          department: { select: { name: true, isSubAccount: true, headName: true, parentId: true, parent: { select: { name: true } } } },
          targetDepartment: { select: { name: true, headEmail: true } },
          currentVettingDept: { select: { name: true } },
          treatedByDept: { select: { name: true } },
          creator: { select: { name: true } },
          currentStage: true,
          attachments: { select: { id: true, filename: true, size: true, mimeType: true } },
          tags: { select: { deptId: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.requisition.count({ where })
    ]);

    res.json({ data: records, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/audit-logs', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';
    const mineOnly = req.query.mine === 'true';

    // Non-admins can only ever see their own activity
    if (!isAdmin && !mineOnly) {
      return res.status(403).json({ error: 'Access denied. Use ?mine=true to view your own activity.' });
    }

    const userId = getNumericUserId(req.user);
    const where = (isAdmin && !mineOnly) ? {} : { userId };

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit
      }),
      prisma.activityLog.count({ where })
    ]);
    res.json({ data: logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) { sendError(res, 500, error.message); }
});

// File Attachments & Auditing
app.post('/api/requisitions/:id/attachments', authenticateToken, upload.array('files'), async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    const userId = getNumericUserId(req.user);
    const stageName = req.body?.stageName || null;
    const stageKey = req.body?.stageKey || null;
    const uploaderDept = req.body?.uploaderDept || null;
    const attachments = [];
    for (const file of files) {
      const storageKey = generateStorageKey(`attachments/${id}`, file.originalname);
      try {
        await putObject({ key: storageKey, body: file.buffer, contentType: file.mimetype });
      } catch (storageErr) {
        logger.error(`[UPLOAD] Storage failed for ${file.originalname} (req #${id}): ${storageErr.message}`, { useS3, bucket: process.env.R2_BUCKET_NAME || 'local' });
        return res.status(500).json({ error: `File storage failed: ${storageErr.message}` });
      }
      const created = await prisma.attachment.create({
        data: {
          filename: file.originalname,
          storageKey,
          mimeType: file.mimetype,
          size: file.size,
          requisitionId: parseInt(id),
          uploadedById: userId || null,
          stageName,
          stageKey,
          uploaderDept
        }
      });
      attachments.push(created);
    }

    // Log Activity
    await prisma.activityLog.create({
      data: {
        userId: userId || null,
        action: 'File Upload',
        details: `Uploaded ${files.length} files to Requisition #${id}`
      }
    });

    res.json(attachments);
  } catch (error) {
    logger.error(`[UPLOAD] Attachment endpoint error for req #${req.params.id}:`, error.message);
    sendError(res, 500, error.message);
  }
});

app.get('/api/attachments/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id: parseInt(id) },
      include: { requisition: true }
    });
    if (!attachment) return res.status(404).json({ error: 'File not found' });
    if (!(await canReadRequisition(attachment.requisition, req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Audit Log
    const accessUserId = getNumericUserId(req.user);
    if (accessUserId) {
      await prisma.fileAccessLog.create({
        data: {
          attachmentId: attachment.id,
          userId: accessUserId,
          action: 'DOWNLOAD'
        }
      });
    }

    if (!attachment.storageKey) return res.status(404).json({ error: 'File missing from storage' });
    const stream = await getObjectStream(attachment.storageKey);
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    stream.pipe(res);
  } catch (error) { sendError(res, 500, error.message); }
});

// File Preview (inline rendering instead of forced download)
app.get('/api/attachments/:id/preview', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const attachment = await prisma.attachment.findUnique({
      where: { id: parseInt(id) },
      include: { requisition: true }
    });
    if (!attachment) return res.status(404).json({ error: 'File not found' });
    if (!(await canReadRequisition(attachment.requisition, req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!attachment.storageKey) return res.status(404).json({ error: 'File missing from storage' });
    const stream = await getObjectStream(attachment.storageKey);
    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    stream.pipe(res);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── Delete Attachment (creator dept only, before any forwarding) ──────────────
app.delete('/api/attachments/:id', authenticateToken, async (req, res) => {
  try {
    const attachId = parseInt(req.params.id);
    const attachment = await prisma.attachment.findUnique({
      where: { id: attachId },
      include: { requisition: { select: { id: true, departmentId: true, forwardEvents: { select: { id: true } } } } }
    });
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    const req_ = attachment.requisition;
    if (!req_) return res.status(400).json({ error: 'Attachment has no associated requisition' });

    const userDeptId = req.user.deptId ? parseInt(req.user.deptId) : null;
    const isAdmin = normalizeRole(req.user.role) === 'global_admin';

    // Only creator dept, and only before the req has been forwarded (sent)
    if (!isAdmin) {
      if (userDeptId !== req_.departmentId) {
        return res.status(403).json({ error: 'Only the requesting department can delete attachments.' });
      }
      if (req_.forwardEvents?.length > 0) {
        return res.status(403).json({ error: 'Attachments cannot be deleted after a requisition has been submitted.' });
      }
    }

    // Remove from storage
    if (attachment.storageKey) {
      await deleteObject(attachment.storageKey).catch(() => {});
    }

    await prisma.attachment.delete({ where: { id: attachId } });
    res.json({ ok: true });
  } catch (err) { sendError(res, 500, err.message); }
});

// ── EMAIL STATUS ──
app.get('/api/email-status', authenticateToken, requireRoles(['global_admin']), (req, res) => {
  try {
    let status = { configured: false, error: null, provider: 'none' };
    try { status = getTransportStatus(); } catch (_) {}
    res.json({
      configured: status.configured,
      provider: status.provider,
      error: status.error || null,
      fromAddress: status.fromAddress || null,
    });
  } catch (err) {
    res.json({ configured: false, error: err.message, provider: 'none' });
  }
});

// ── EMAIL TEST ENDPOINT (Admin only) ──
app.post('/api/test-email', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) return res.json({ success: false, message: 'Please provide a recipient email address.' });

    logger.info(`[MAIL-TEST] to=${to} RESEND_API_KEY=${process.env.RESEND_API_KEY ? 'SET' : 'MISSING'}`);

    const { text, html } = buildEmailContent({
      title: 'CSS RMS — Email Test',
      lines: ['This is a test email from the CSS RMS platform.', `Sent at: ${new Date().toLocaleString()}`, 'If you receive this, email notifications are working correctly.'],
      actionUrl: APP_BASE_URL || '', actionLabel: 'Open RMS Dashboard'
    });

    const result = await sendEmail({ to, subject: 'CSS RMS — Email Delivery Test', text, html });
    if (result && result.skipped) {
      return res.json({ success: false, message: 'Email transport not configured.', hint: 'Set RESEND_API_KEY in Railway environment variables.' });
    }
    res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (err) {
    logger.error('[MAIL-TEST] FAILED:', err.message);
    res.json({
      success: false,
      message: err.message,
      hint: 'Check that RESEND_API_KEY is set correctly in Railway and the sending domain is verified in your Resend dashboard.'
    });
  }
});

// ── SMS TEST ENDPOINT (Admin only) ────────────────────────────────────────────
app.post('/api/test-sms', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { to, provider = 'all' } = req.body;
    if (!to) return res.json({ success: false, results: [{ provider, success: false, error: 'Phone number is required.' }] });

    const message = `CSS RMS test message — sent at ${new Date().toLocaleString('en-NG')}. If you received this, your SMS provider is working correctly.`;

    const runProvider = async (name, fn) => {
      try {
        const result = await fn({ to, message });
        if (result?.skipped) return { provider: name, success: false, skipped: true, error: 'API key not configured' };
        if (result?.error)   return { provider: name, success: false, error: typeof result.error === 'string' ? result.error : JSON.stringify(result.error) };
        return { provider: name, success: true, message: `Sent to ${to}` };
      } catch (e) {
        return { provider: name, success: false, error: e.message };
      }
    };

    let results;
    if (provider === 'all') {
      results = await Promise.all([
        runProvider('termii',   sendTermiiSms),
        runProvider('textflow', sendTextflowSms),
        runProvider('twilio',   sendTwilioSms),
      ]);
    } else if (provider === 'termii')   { results = [await runProvider('termii',   sendTermiiSms)]; }
    else if (provider === 'textflow')   { results = [await runProvider('textflow', sendTextflowSms)]; }
    else if (provider === 'twilio')     { results = [await runProvider('twilio',   sendTwilioSms)]; }
    else { return res.json({ success: false, results: [{ provider, success: false, error: 'Unknown provider' }] }); }

    const anyOk = results.some(r => r.success);
    logger.info(`[SMS-TEST] to=${to} provider=${provider} ok=${anyOk}`);
    res.json({ success: anyOk, results });
  } catch (err) {
    logger.error('[SMS-TEST] FAILED:', err.message);
    res.json({ success: false, results: [{ provider: 'unknown', success: false, error: err.message }] });
  }
});

// ── Onboarding Bulk SMS ───────────────────────────────────────────────────────
app.post('/api/onboarding/bulk-sms', authenticateToken, requireRoles(['global_admin']), batchUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) return res.status(400).json({ error: 'File is empty or unreadable.' });

    // Flexible column matching
    const findCol = (row, ...keywords) => {
      const key = Object.keys(row).find(k => keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase())));
      return key ? String(row[key]).trim() : '';
    };

    const generateEmail = (firstName, surname) => {
      const fn = firstName.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
      const sn = surname.toLowerCase().replace(/[^a-z]/g, '');
      return fn && sn ? `${fn}.${sn}@cssgroup.com.ng` : '';
    };

    const results = [];

    for (const row of rows) {
      const firstName = findCol(row, 'first name', 'firstname');
      const surname   = findCol(row, 'surname', 'last name');
      const rawPhone  = findCol(row, 'phone').replace(/\D/g, '');
      // Excel strips leading zero from Nigerian numbers — restore it
      const phone = rawPhone.startsWith('234') ? '0' + rawPhone.slice(3)
                  : rawPhone.length === 10 && !rawPhone.startsWith('0') ? '0' + rawPhone
                  : rawPhone;
      const staffId   = findCol(row, 'staff id', 'staffid');
      const dept      = findCol(row, 'department', 'dept');
      const position  = findCol(row, 'position', 'title');

      if (!phone || !firstName || !surname) {
        results.push({ name: `${firstName} ${surname}`.trim() || 'Unknown', phone, status: 'skipped', reason: 'Missing name or phone' });
        continue;
      }

      const email = generateEmail(firstName, surname);
      const displayName = `${firstName.split(' ')[0]}`;
      const defaultPwd = process.env.ONBOARDING_DEFAULT_PASSWORD || 'CssPWorD1';
      const message = `Dear ${displayName}, welcome to CSS Group! Your official email is: ${email}. Default password: ${defaultPwd}. Login at webmail.cssgroup.com.ng and change your password immediately after first login.${dept ? ` Department: ${dept}.` : ''}${position ? ` Role: ${position}.` : ''} - CSS ICT Team`;

      try {
        await sendSms({ to: phone, message });
        results.push({ name: `${firstName} ${surname}`, phone, email, staffId, dept, status: 'sent' });
      } catch (e) {
        results.push({ name: `${firstName} ${surname}`, phone, email, staffId, dept, status: 'failed', reason: e.message });
      }
    }

    const sent   = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    logger.info(`[ONBOARDING-SMS] sent=${sent} failed=${failed} skipped=${skipped}`);
    res.json({ sent, failed, skipped, total: results.length, results });
  } catch (err) {
    logger.error('[ONBOARDING-SMS]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Onboarding Bulk SMS from edited JSON rows ─────────────────────────────────
app.post('/api/onboarding/bulk-sms-send', authenticateToken, requireRoles(['global_admin']), async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided.' });

    const normalizePhone = (p) => {
      const n = String(p).replace(/\D/g, '');
      if (n.startsWith('234')) return '0' + n.slice(3);
      if (n.length === 10 && !n.startsWith('0')) return '0' + n;
      return n;
    };

    const generateEmail = (firstName, surname) => {
      const fn = String(firstName).split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
      const sn = String(surname).toLowerCase().replace(/[^a-z]/g, '');
      return fn && sn ? `${fn}.${sn}@cssgroup.com.ng` : '';
    };

    const defaultPwd = process.env.ONBOARDING_DEFAULT_PASSWORD || 'CssPWorD1';
    const results = [];

    for (const row of rows) {
      const firstName = String(row.firstName || '').trim();
      const surname   = String(row.surname || '').trim();
      const phone     = normalizePhone(row.phone || '');
      const dept      = String(row.dept || '').trim();
      const position  = String(row.position || '').trim();
      const staffId   = String(row.staffId || '').trim();
      const email     = row.email || generateEmail(firstName, surname);

      if (!phone || !firstName || !surname) {
        results.push({ name: `${firstName} ${surname}`.trim() || 'Unknown', phone, status: 'skipped', reason: 'Missing name or phone' });
        continue;
      }

      const displayName = firstName.split(' ')[0];
      const message = `Dear ${displayName}, welcome to CSS Group! Your official email is: ${email}. Default password: ${defaultPwd}. Login at webmail.cssgroup.com.ng and change your password immediately after first login.${dept ? ` Department: ${dept}.` : ''}${position ? ` Role: ${position}.` : ''} - CSS ICT Team`;

      try {
        await sendSms({ to: phone, message });
        results.push({ name: `${firstName} ${surname}`, phone, email, staffId, dept, status: 'sent' });
      } catch (e) {
        results.push({ name: `${firstName} ${surname}`, phone, email, staffId, dept, status: 'failed', reason: e.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    logger.info(`[ONBOARDING-SMS-SEND] sent=${sent} failed=${failed} skipped=${skipped}`);
    res.json({ sent, failed, skipped, total: results.length, results });
  } catch (err) {
    logger.error('[ONBOARDING-SMS-SEND]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Store Records ─────────────────────────────────────────────────────────────
function isStoreDept(name) { return /\bstore\b/i.test(name || ''); }

// List store records — sub-account: own; head: own + all sub-accounts; admin: all store records
app.get('/api/store-records', authenticateToken, async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const isAdmin = role === 'global_admin';
    const deptId = parseInt(req.user.deptId);
    const { subAccountId, startDate, endDate, search, page = 1, limit = 30 } = req.query;

    let where = {};
    if (!isAdmin) {
      if (req.user.isSubAccount) {
        where.departmentId = deptId;
      } else {
        const subDepts = await prisma.department.findMany({
          where: { parentId: deptId, isSubAccount: true, isDeleted: false },
          select: { id: true }
        });
        const subIds = subDepts.map(d => d.id);
        where.departmentId = { in: [deptId, ...subIds] };
      }
    }
    if (subAccountId && !req.user.isSubAccount) where.departmentId = parseInt(subAccountId);
    if (startDate || endDate) {
      const df = {};
      if (startDate) df.gte = new Date(startDate);
      if (endDate)   df.lte = new Date(endDate + 'T23:59:59.999Z');
      where.createdAt = df;
    }
    if (search) where.OR = [{ code: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [records, total] = await Promise.all([
      prisma.storeRecord.findMany({
        where,
        include: {
          department: { select: { name: true, isSubAccount: true, headName: true, parentId: true } },
          entries: { orderBy: { sequence: 'asc' } }
        },
        orderBy: { updatedAt: 'desc' },
        skip, take: parseInt(limit)
      }),
      prisma.storeRecord.count({ where })
    ]);
    res.json({ data: records, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { sendError(res, 500, err.message); }
});

// Get carried-forward value for a dept (last stock balance from most recent record's last entry)
app.get('/api/store-records/carried-forward', authenticateToken, async (req, res) => {
  try {
    const deptId = req.query.deptId ? parseInt(req.query.deptId) : parseInt(req.user.deptId);
    const last = await prisma.storeRecord.findFirst({
      where: { departmentId: deptId },
      orderBy: { updatedAt: 'desc' },
      include: { entries: { orderBy: { sequence: 'desc' }, take: 1 } }
    });
    res.json({ carriedForward: last?.entries?.[0]?.stockBalance ?? 0 });
  } catch (err) { sendError(res, 500, err.message); }
});

// Get sub-accounts for a store dept (used by head to populate the filter dropdown)
app.get('/api/store-records/sub-accounts', authenticateToken, async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const isAdmin = role === 'global_admin';
    let parentId = parseInt(req.user.deptId);
    if (isAdmin && req.query.parentId) parentId = parseInt(req.query.parentId);
    const subs = await prisma.department.findMany({
      where: { parentId, isSubAccount: true, isDeleted: false },
      select: { id: true, name: true, headName: true }
    });
    res.json(subs);
  } catch (err) { sendError(res, 500, err.message); }
});

// Create store record
app.post('/api/store-records', authenticateToken, async (req, res) => {
  try {
    const deptId = parseInt(req.user.deptId);
    const { code, description, location, carriedForward = 0, entries = [] } = req.body;
    if (!code?.trim() || !description?.trim()) return res.status(400).json({ error: 'Code and description are required.' });
    const record = await prisma.storeRecord.create({
      data: {
        code: code.trim(), description: description.trim(),
        location: location?.trim() || null,
        carriedForward: parseFloat(carriedForward) || 0,
        departmentId: deptId,
        entries: {
          create: entries.map((e, i) => ({
            sequence: i,
            date: e.date || null,
            openingBalance: parseFloat(e.openingBalance) || 0,
            qtyReceived: parseFloat(e.qtyReceived) || 0,
            quantityIssued: parseFloat(e.quantityIssued) || 0,
            requisitionSlipNo: e.requisitionSlipNo || null,
            stockBalance: parseFloat(e.stockBalance) || 0,
            materialsTaken: e.materialsTaken || null,
            remarks: e.remarks || null,
          }))
        }
      },
      include: { department: { select: { name: true, isSubAccount: true, headName: true } }, entries: { orderBy: { sequence: 'asc' } } }
    });
    res.status(201).json(record);
  } catch (err) { sendError(res, 500, err.message); }
});

// Get single store record
app.get('/api/store-records/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const record = await prisma.storeRecord.findUnique({
      where: { id },
      include: { department: { select: { name: true, isSubAccount: true, headName: true, parentId: true } }, entries: { orderBy: { sequence: 'asc' } } }
    });
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    const role = normalizeRole(req.user?.role);
    if (role !== 'global_admin') {
      const deptId = parseInt(req.user.deptId);
      if (record.departmentId !== deptId) {
        if (req.user.isSubAccount) return res.status(403).json({ error: 'Access denied.' });
        const sub = await prisma.department.findFirst({ where: { id: record.departmentId, parentId: deptId, isDeleted: false } });
        if (!sub) return res.status(403).json({ error: 'Access denied.' });
      }
    }
    res.json(record);
  } catch (err) { sendError(res, 500, err.message); }
});

// Update store record (replaces all entries in one transaction)
app.put('/api/store-records/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.storeRecord.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Record not found.' });
    const role = normalizeRole(req.user?.role);
    if (role !== 'global_admin') {
      const deptId = parseInt(req.user.deptId);
      if (existing.departmentId !== deptId) return res.status(403).json({ error: 'Access denied.' });
    }
    const { code, description, location, carriedForward, entries = [] } = req.body;
    await prisma.$transaction(async (tx) => {
      await tx.storeRecordEntry.deleteMany({ where: { storeRecordId: id } });
      await tx.storeRecord.update({
        where: { id },
        data: {
          code: code?.trim() ?? existing.code,
          description: description?.trim() ?? existing.description,
          location: location != null ? (location.trim() || null) : existing.location,
          carriedForward: carriedForward != null ? (parseFloat(carriedForward) || 0) : existing.carriedForward,
        }
      });
      if (entries.length > 0) {
        await tx.storeRecordEntry.createMany({
          data: entries.map((e, i) => ({
            storeRecordId: id, sequence: i,
            date: e.date || null,
            openingBalance: parseFloat(e.openingBalance) || 0,
            qtyReceived: parseFloat(e.qtyReceived) || 0,
            quantityIssued: parseFloat(e.quantityIssued) || 0,
            requisitionSlipNo: e.requisitionSlipNo || null,
            stockBalance: parseFloat(e.stockBalance) || 0,
            materialsTaken: e.materialsTaken || null,
            remarks: e.remarks || null,
          }))
        });
      }
    });
    const updated = await prisma.storeRecord.findUnique({
      where: { id },
      include: { department: { select: { name: true, isSubAccount: true, headName: true } }, entries: { orderBy: { sequence: 'asc' } } }
    });
    res.json(updated);
  } catch (err) { sendError(res, 500, err.message); }
});

// Delete store record
app.delete('/api/store-records/:id', authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.storeRecord.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Record not found.' });
    const role = normalizeRole(req.user?.role);
    if (role !== 'global_admin') {
      const deptId = parseInt(req.user.deptId);
      if (existing.departmentId !== deptId) return res.status(403).json({ error: 'Access denied.' });
    }
    await prisma.storeRecord.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) { sendError(res, 500, err.message); }
});

// ── Requisition Attachments List
app.get('/api/requisitions/:id/attachments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (normalizeRole(req.user.role) === 'department' && req.user.deptId) {
      const reqCheck = await prisma.requisition.findUnique({ where: { id: parseInt(id) } });
      if (!reqCheck) return res.status(404).json({ error: 'Requisition not found' });
      if (!(await canReadRequisition(reqCheck, req.user))) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    const attachments = await prisma.attachment.findMany({
      where: { requisitionId: parseInt(id) },
      orderBy: { createdAt: 'asc' },
      include: { uploadedBy: { select: { name: true, department: { select: { name: true } } } } }
    });
    res.json(attachments);
  } catch (error) { sendError(res, 500, error.message); }
});

// ── OpenAI per-user usage caps ────────────────────────────────────────────────
// In-memory tracker: resets automatically when a window period changes.
// Survives as long as the process is running; resets on redeploy (acceptable —
// caps are intended as intra-period guardrails, not hard lifetime limits).
const _aiUsageMap = new Map(); // userId (string) → {hourly,daily,weekly,monthly}

function _getPeriodStart(period) {
  const n = new Date();
  switch (period) {
    case 'hourly':  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours()).getTime();
    case 'daily':   return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    case 'weekly':  { const d = new Date(n.getFullYear(), n.getMonth(), n.getDate()); d.setDate(d.getDate() - d.getDay()); return d.getTime(); }
    case 'monthly': return new Date(n.getFullYear(), n.getMonth(), 1).getTime();
    default: return 0;
  }
}

const AI_PERIODS = ['hourly', 'daily', 'weekly', 'monthly'];

function _getOrInitAiEntry(userId) {
  const key = String(userId);
  if (!_aiUsageMap.has(key)) {
    _aiUsageMap.set(key, Object.fromEntries(AI_PERIODS.map(p => [p, { count: 0, windowStart: _getPeriodStart(p) }])));
  }
  const entry = _aiUsageMap.get(key);
  // Reset any expired windows
  for (const p of AI_PERIODS) {
    const current = _getPeriodStart(p);
    if (entry[p].windowStart < current) entry[p] = { count: 0, windowStart: current };
  }
  return entry;
}

async function _getAiCaps() {
  try {
    const row = await prisma.systemSetting.findFirst({ where: { key: 'ai_caps' } });
    return row?.value ? JSON.parse(row.value) : {};
  } catch { return {}; }
}

const _resetLabels = { hourly: 'at the top of the next hour', daily: 'at midnight', weekly: 'on Monday', monthly: 'on the 1st of next month' };

async function _checkAndIncrementAiUsage(userId) {
  const caps = await _getAiCaps();
  const entry = _getOrInitAiEntry(userId);
  for (const p of AI_PERIODS) {
    const cap = Number(caps[p]);
    if (cap > 0 && entry[p].count >= cap) {
      return { blocked: true, reason: `You have reached your ${p} AI usage limit (${cap} call${cap !== 1 ? 's' : ''}). Resets ${_resetLabels[p]}.` };
    }
  }
  for (const p of AI_PERIODS) entry[p].count++;
  return { blocked: false };
}

// ── AI caps admin endpoints ────────────────────────────────────────────────────
app.get('/api/admin/ai-caps', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const caps = await _getAiCaps();
    const users = [];
    for (const [uid, entry] of _aiUsageMap) {
      _getOrInitAiEntry(uid); // refresh windows
      const refreshed = _aiUsageMap.get(uid);
      let userName = `User ${uid}`;
      try {
        const u = await prisma.user.findUnique({ where: { id: parseInt(uid) }, select: { name: true, role: true } });
        if (u) userName = u.name;
      } catch {}
      users.push({ userId: uid, name: userName, usage: Object.fromEntries(AI_PERIODS.map(p => [p, refreshed[p].count])) });
    }
    res.json({ caps, users });
  } catch (err) { sendError(res, 500, err.message); }
});

app.post('/api/admin/ai-caps', authenticateToken, async (req, res) => {
  if (req.user?.role !== 'global_admin') return res.status(403).json({ error: 'Super Admin only' });
  try {
    const { hourly, daily, weekly, monthly } = req.body;
    const caps = {
      hourly:  hourly  ? parseInt(hourly)  : null,
      daily:   daily   ? parseInt(daily)   : null,
      weekly:  weekly  ? parseInt(weekly)  : null,
      monthly: monthly ? parseInt(monthly) : null,
    };
    await prisma.systemSetting.upsert({
      where: { key: 'ai_caps' },
      update: { value: JSON.stringify(caps) },
      create: { key: 'ai_caps', value: JSON.stringify(caps) },
    });
    res.json({ ok: true, caps });
  } catch (err) { sendError(res, 500, err.message); }
});

// ── AI VOICE TRANSCRIPTION (Whisper Fallback) ──
app.post('/api/ai/transcribe', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided.' });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI features are not configured.' });
    }

    const capCheck = await _checkAndIncrementAiUsage(req.user.id);
    if (capCheck.blocked) return res.status(429).json({ error: capCheck.reason });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Convert buffer to a File-like object for OpenAI SDK
    const audioFile = new File([req.file.buffer], 'recording.webm', {
      type: req.file.mimetype || 'audio/webm'
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
      response_format: 'text'
    });

    res.json({ text: transcription || '' });
  } catch (error) {
    logger.error('Whisper Transcription Error:', error);
    res.status(500).json({ error: 'Audio transcription failed.', details: error.message });
  }
});

// ── AI INTELLIGENT REFINEMENT & VALIDATION ──
app.post('/api/ai/refine-requisition', authenticateToken, async (req, res) => {
  try {
    const { rawDescription, mode } = req.body;
    if (!rawDescription || rawDescription.trim().length < 5) {
      return res.status(400).json({ error: 'Input is too short. Please describe your request more clearly before refining.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI features are not configured. Please contact the administrator.' });
    }

    const capCheck = await _checkAndIncrementAiUsage(req.user.id);
    if (capCheck.blocked) return res.status(429).json({ error: capCheck.reason });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const isProMode = mode === 'pro';
    const isReviewMode = mode === 'review';

    // Review/comment mode: no validity gating — just polish grammar and professional tone
    if (isReviewMode) {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional corporate communications editor.
Your only job is to fix spelling, grammar, and tone in a review comment or response note written by a department officer in a Requisition Management System.
Keep the original meaning exactly — do not add, remove, or change any facts or requests.
Make it polite, concise, and professional.
Return ONLY a JSON object: { "refinedDescription": string, "actionReason": string }
The actionReason should be a short one-sentence note on what you improved (e.g. "Fixed spelling and improved formal tone.").`
          },
          { role: 'user', content: rawDescription }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
      });
      const data = JSON.parse(response.choices[0].message.content);
      return res.json({
        isValid: true,
        refinedDescription: xss(data.refinedDescription || rawDescription),
        actionReason: xss(data.actionReason || 'Note professionally refined by AI.'),
        recommendedAction: 'submit',
        totalAmount: 0,
        documentType: 'Memo',
        validationMessage: ''
      });
    }

    const SYSTEM_PROMPT = isProMode
      ? `You are a senior document editor for a corporate Requisition Management System (RMS).
Your job is to review and polish a user-submitted document.

CRITICAL RULE — NO PLACEHOLDER BRACKETS:
Never write [Name], [Your Name], [Date], [reason], or any square-bracket placeholder. Only use what the user actually provided.

STEP 1 — VALIDITY CHECK:
Determine if the input is a legitimate organisational document or request. Reject it if:
- It is random characters, keyboard mashing, or clearly nonsensical (e.g. "asdfgh", "test test 123 abc")
- It is entirely personal/social content with zero work relevance
- It is too vague or short to form any coherent request (e.g. "please help me")
- It appears to be someone testing the system with fake/dummy content

STEP 2 — CLASSIFICATION:
- "Cash" → itemised procurement, budget requests, or requests for money/funds
- "Memo" → administrative notice, internal communication, leave request, policy, penalty, or any non-monetary organisational request

STEP 3 — RECOMMENDED ACTION:
Based on the content, suggest:
- "submit" → ready to be submitted and processed normally
- "forward" → requires review or input from another department before submission
- "draft" → needs more detail or clarification from the requester before submitting
- "blocked" → content is invalid, gibberish, or cannot be processed

Return ONLY a JSON object:
{
  "isValid": boolean,
  "validationMessage": string,
  "refinedDescription": string,
  "totalAmount": number,
  "documentType": "Cash" | "Memo",
  "recommendedAction": "submit" | "forward" | "draft" | "blocked",
  "actionReason": string
}`
      : `You are an intelligent corporate Requisition Management assistant for CSS Global Integrated Farms Ltd.
Your role is to validate, refine, and intelligently classify incoming requisition drafts submitted by staff.

CRITICAL RULE — NO PLACEHOLDER BRACKETS:
Never write [Name], [Manager's Name], [Your Name], [Date], [start date], [reason], or any square-bracket placeholder.
Only write what the user actually provided. If a detail is missing, leave it as a natural gap in the sentence or omit it.

STEP 1 — VALIDITY CHECK (most important):
Reject content if it is:
- Random letters, numbers, or keyboard mashing (e.g. "qwerty", "aaaaa bbb ccc", "1234567")
- Voice recordings that produced pure noise/gibberish with no recognisable words
- Completely off-topic personal content (e.g. social conversation, jokes, insults)
- A single vague word or phrase with no context (e.g. "help", "please", "urgent thing")
- Clearly a system test without real intent (e.g. "test test test", "abc xyz 123")
Set isValid to false and recommendedAction to "blocked" in these cases.

STEP 2 — CLASSIFICATION (only if valid):
- "Cash" → requests involving purchasing, procurement, budgeting, or funding (even if no price is given)
- "Memo" → administrative requests: leave applications, notices, internal communications, approvals, policies, complaints

STEP 3 — REFINEMENT (only if valid):
Write only what the user told you. Do not invent names, dates, reasons, or details.
- For Cash: format as a professional requisition using only the items/amounts the user mentioned. If no price, set totalAmount to 0.
- For Memo: write a short, direct professional statement of the request using only what was provided. Do NOT write a full letter with greeting/closing. Just a clear, formal paragraph.

STEP 4 — RECOMMENDED ACTION:
- "submit" → all key details are present (who, what, when/why) and it is ready to route
- "forward" → needs another department's involvement before it can be processed
- "draft" → the intent is clear but essential details are missing (e.g. no dates, no reason, no amounts). List exactly what is missing in actionReason.
- "blocked" → invalid or unprocessable content

For leave requests: if no start date, end date, or reason is provided → set recommendedAction to "draft".
For purchase requests: if no items or amounts are specified → set recommendedAction to "draft".

Return ONLY a JSON object (no extra text):
{
  "isValid": boolean,
  "validationMessage": string,
  "refinedDescription": string,
  "totalAmount": number,
  "documentType": "Cash" | "Memo",
  "recommendedAction": "submit" | "forward" | "draft" | "blocked",
  "actionReason": string
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawDescription }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    if (!response.choices[0]?.message?.content) {
      throw new Error('Empty response from OpenAI');
    }

    const aiData = JSON.parse(response.choices[0].message.content);

    // If the AI flagged the content as invalid, return early with a user-friendly block
    if (aiData.isValid === false || aiData.recommendedAction === 'blocked') {
      return res.status(422).json({
        blocked: true,
        validationMessage: aiData.validationMessage || 'Your input could not be processed. Please describe your request clearly and professionally.',
        actionReason: aiData.actionReason || 'The content does not appear to be a valid organisational request.'
      });
    }

    return res.json({
      isValid: true,
      refinedDescription: xss(aiData.refinedDescription || aiData.description || ''),
      totalAmount: Number(aiData.totalAmount) || 0,
      documentType: aiData.documentType === 'Memo' ? 'Memo' : 'Cash',
      recommendedAction: aiData.recommendedAction || 'submit',
      actionReason: xss(aiData.actionReason || ''),
      validationMessage: xss(aiData.validationMessage || '')
    });
  } catch (error) {
    logger.error('OpenAI Refinement Error:', error);
    console.error('[AI_REFINEMENT_ERROR]', error.message, error.stack);
    const status = error.status || 500;
    res.status(status).json({
      error: 'AI processing failed. Please try again or submit your request manually.',
      details: error.message
    });
  }
});

// ── HR PORTAL ROUTES ──────────────────────────────────────────────────────────
const hrAuth = [authenticateToken];

// ── Conspiracy / duplicate punch detection ────────────────────────────────────
// Returns flags to attach to a newly-arrived punch.
async function zkCheckPunch(staffId, punchTime) {
  const t = new Date(punchTime);
  const flags = { isDuplicate: false, isFlagged: false, flagReason: null };

  // 1. Duplicate: same staff punched within 30 seconds
  const thirtySecAgo = new Date(t.getTime() - 30_000);
  const thirtySecFwd  = new Date(t.getTime() + 30_000);
  const nearby = await prisma.zKAttendancePunch.count({
    where: { staffId, punchTime: { gte: thirtySecAgo, lte: thirtySecFwd } },
  });
  if (nearby > 0) { flags.isDuplicate = true; return flags; }

  // 2. Conspiracy: 10+ DIFFERENT employees all punched in a 60-second burst
  const sixtySecAgo = new Date(t.getTime() - 60_000);
  const burst = await prisma.zKAttendancePunch.groupBy({
    by: ['staffId'],
    where: { punchTime: { gte: sixtySecAgo, lte: t }, isDuplicate: false },
    _count: { staffId: true },
  });
  if (burst.length >= 10) {
    flags.isFlagged = true;
    flags.flagReason = `Suspicious burst: ${burst.length} different staff within 60s`;
  }
  return flags;
}

// Upsert the daily HRAttendanceRecord for a given staffId + punchTime.
async function zkUpdateDailyRecord(staffId, punchTime) {
  const date = new Date(punchTime);
  date.setHours(0, 0, 0, 0);

  const existing = await prisma.hRAttendanceRecord.findUnique({
    where: { staffId_date: { staffId, date } },
  });

  if (!existing) {
    await prisma.hRAttendanceRecord.create({
      data: {
        staffId, date,
        firstPunch: punchTime, lastPunch: punchTime,
        punchCount: 1, isPresent: true,
        hoursWorked: 0,
      },
    });
  } else {
    const first = existing.firstPunch && punchTime < existing.firstPunch ? punchTime : existing.firstPunch;
    const last  = existing.lastPunch  && punchTime > existing.lastPunch  ? punchTime : existing.lastPunch;
    const hours = first && last ? (last - first) / 3_600_000 : existing.hoursWorked;
    await prisma.hRAttendanceRecord.update({
      where: { staffId_date: { staffId, date } },
      data: { firstPunch: first, lastPunch: last, punchCount: { increment: 1 }, isPresent: true, hoursWorked: hours },
    });
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────
app.get('/api/hr/stats', hrAuth, async (req, res) => {
  try {
    const [empCount, today] = await Promise.all([
      prisma.hREmployee.count({ where: { status: 'active' } }),
      (async () => {
        const d = new Date(); d.setHours(0,0,0,0);
        const [present, total] = await Promise.all([
          prisma.hRAttendanceRecord.count({ where: { date: d, isPresent: true } }),
          prisma.hREmployee.count({ where: { status: 'active' } }),
        ]);
        return total > 0 ? Math.round((present / total) * 100) : 0;
      })(),
    ]);
    res.json({ employees: empCount, pendingLeaves: 0, attendanceRate: today, openPositions: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Employee Directory ─────────────────────────────────────────────────────────
app.get('/api/hr/employees', hrAuth, async (req, res) => {
  try {
    const { status, department, search, page = 1, limit = 200 } = req.query;
    const where = {};
    if (status) where.status = status;
    else where.status = { not: 'terminated' };
    if (department) where.department = department;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { staffId:   { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [results, total] = await Promise.all([
      prisma.hREmployee.findMany({ where, orderBy: { lastName: 'asc' }, skip, take: Number(limit) }),
      prisma.hREmployee.count({ where }),
    ]);
    res.json({ results, total, page: Number(page) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/employees', hrAuth, async (req, res) => {
  try {
    const { staffId, firstName, lastName, otherName, email, phone, department, position, joinDate } = req.body;
    if (!staffId || !firstName || !lastName) return res.status(400).json({ error: 'staffId, firstName, lastName are required' });
    const emp = await prisma.hREmployee.create({
      data: { staffId: staffId.trim().toUpperCase(), firstName, lastName, otherName, email, phone, department, position,
              joinDate: joinDate ? new Date(joinDate) : null },
    });
    res.status(201).json(emp);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Staff ID already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/hr/employees/:id', hrAuth, async (req, res) => {
  try {
    const emp = await prisma.hREmployee.findUnique({ where: { id: Number(req.params.id) } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/hr/employees/:id', hrAuth, async (req, res) => {
  try {
    const { staffId, firstName, lastName, otherName, email, phone, department, position, status, joinDate } = req.body;
    const data = {};
    if (staffId  !== undefined) data.staffId   = staffId.trim().toUpperCase();
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName  !== undefined) data.lastName  = lastName;
    if (otherName !== undefined) data.otherName = otherName;
    if (email     !== undefined) data.email     = email;
    if (phone     !== undefined) data.phone     = phone;
    if (department!== undefined) data.department= department;
    if (position  !== undefined) data.position  = position;
    if (status    !== undefined) data.status    = status;
    if (joinDate  !== undefined) data.joinDate  = joinDate ? new Date(joinDate) : null;
    const emp = await prisma.hREmployee.update({ where: { id: Number(req.params.id) }, data });
    res.json(emp);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/hr/employees/:id', hrAuth, async (req, res) => {
  try {
    await prisma.hREmployee.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/employees/:id/photo', hrAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const key = `hr-photos/${req.params.id}-${Date.now()}`;
    const s3key = await uploadToS3(req.file.buffer, key, req.file.mimetype);
    await prisma.hREmployee.update({ where: { id: Number(req.params.id) }, data: { photoKey: s3key } });
    res.json({ photoKey: s3key });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Leaves (stub — kept for UI compatibility) ──────────────────────────────────
app.get('/api/hr/leaves', hrAuth, async (req, res) => { res.json([]); });
app.post('/api/hr/leaves', hrAuth, async (req, res) => {
  res.status(201).json({ id: Date.now(), ...req.body, status: 'pending', createdAt: new Date() });
});
app.post('/api/hr/leaves/:id/approve', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, status: 'approved' });
});
app.post('/api/hr/leaves/:id/reject', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, status: 'rejected' });
});
app.get('/api/hr/leaves/balances/:employeeId', hrAuth, async (req, res) => {
  res.json({ annual: 20, sick: 10, used: 0 });
});

// ── Manual Attendance (monthly grid marks) ────────────────────────────────────
app.get('/api/hr/attendance', hrAuth, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.json([]);
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end   = new Date(Number(year), Number(month), 0, 23, 59, 59);
    const records = await prisma.hRAttendanceRecord.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });
    // Return in format AttendanceTracker expects: { employeeId, date, status }
    const emps = await prisma.hREmployee.findMany({ select: { id: true, staffId: true } });
    const idMap = Object.fromEntries(emps.map(e => [e.staffId, e.id]));
    res.json(records.map(r => ({
      id: r.id,
      employeeId: idMap[r.staffId] ?? r.staffId,
      staffId: r.staffId,
      date: r.date,
      status: r.manualStatus || (r.isPresent ? 'P' : ''),
      firstPunch: r.firstPunch,
      lastPunch: r.lastPunch,
      hoursWorked: r.hoursWorked,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/hr/attendance', hrAuth, async (req, res) => {
  try {
    const { employeeId, staffId: rawStaffId, date, status } = req.body;
    // Resolve staffId from employeeId (numeric) or rawStaffId
    let resolvedStaffId = rawStaffId;
    if (!resolvedStaffId && employeeId) {
      const emp = await prisma.hREmployee.findUnique({ where: { id: Number(employeeId) }, select: { staffId: true } });
      resolvedStaffId = emp?.staffId;
    }
    if (!resolvedStaffId || !date) return res.status(400).json({ error: 'staffId and date required' });
    const d = new Date(date); d.setHours(0,0,0,0);
    const rec = await prisma.hRAttendanceRecord.upsert({
      where: { staffId_date: { staffId: resolvedStaffId, date: d } },
      update: { manualStatus: status, isPresent: ['P','L'].includes(status) },
      create: { staffId: resolvedStaffId, date: d, manualStatus: status, isPresent: ['P','L'].includes(status) },
    });
    res.status(201).json({ id: rec.id, employeeId, staffId: resolvedStaffId, date, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/hr/attendance/:id', hrAuth, async (req, res) => {
  try {
    const { status, manualNote, manualBy } = req.body;
    const rec = await prisma.hRAttendanceRecord.update({
      where: { id: Number(req.params.id) },
      data: { manualStatus: status, manualNote, manualBy, isPresent: ['P','L'].includes(status) },
    });
    res.json(rec);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Biometric Attendance: Daily View ──────────────────────────────────────────
app.get('/api/hr/attendance/daily', hrAuth, async (req, res) => {
  try {
    const { date, department } = req.query;
    const d = date ? new Date(date) : new Date();
    d.setHours(0,0,0,0);

    const empWhere = { status: 'active' };
    if (department) empWhere.department = department;
    const employees = await prisma.hREmployee.findMany({ where: empWhere, orderBy: { lastName: 'asc' } });

    const records = await prisma.hRAttendanceRecord.findMany({ where: { date: d } });
    const recMap = Object.fromEntries(records.map(r => [r.staffId, r]));

    const result = employees.map(emp => {
      const rec = recMap[emp.staffId];
      const status = rec?.manualStatus || (rec?.isPresent ? 'P' : 'A');
      return {
        staffId:    emp.staffId,
        firstName:  emp.firstName,
        lastName:   emp.lastName,
        otherName:  emp.otherName,
        department: emp.department,
        position:   emp.position,
        isPresent:  rec?.isPresent ?? false,
        status,
        firstPunch: rec?.firstPunch ?? null,
        lastPunch:  rec?.lastPunch  ?? null,
        hoursWorked: rec?.hoursWorked ?? null,
        punchCount:  rec?.punchCount ?? 0,
        isFlagged:   rec?.isFlagged ?? false,
        flagReason:  rec?.flagReason ?? null,
      };
    });
    res.json({ date: d, results: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ZKTeco Sync Agent: bulk upload (from local PC running zk-sync-agent.js) ────
const ZKTECO_SYNC_SECRET = process.env.ZKTECO_SYNC_SECRET;
const zkSyncAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (ZKTECO_SYNC_SECRET && token !== ZKTECO_SYNC_SECRET) return res.status(401).json({ error: 'Invalid sync secret' });
  next();
};

app.post('/api/hr/zkteco/upload', zkSyncAuth, async (req, res) => {
  try {
    const { punches, deviceSerial } = req.body;
    if (!Array.isArray(punches) || punches.length === 0) return res.status(400).json({ error: 'punches array required' });

    let saved = 0, duplicates = 0, flagged = 0, errors = 0;
    for (const p of punches) {
      try {
        const { staffId, punchTime, punchType = 0, verifyType = 1 } = p;
        if (!staffId || !punchTime) { errors++; continue; }
        const sid = String(staffId).trim().toUpperCase();
        const pt  = new Date(punchTime);
        const { isDuplicate, isFlagged, flagReason } = await zkCheckPunch(sid, pt);
        if (isDuplicate) { duplicates++; continue; }
        if (isFlagged) flagged++;
        await prisma.zKAttendancePunch.upsert({
          where: { staffId_punchTime: { staffId: sid, punchTime: pt } },
          update: {},
          create: { staffId: sid, punchTime: pt, punchType, verifyType, deviceSerial, source: 'agent', isFlagged, flagReason },
        });
        if (!isDuplicate) await zkUpdateDailyRecord(sid, pt);
        saved++;
      } catch { errors++; }
    }
    res.json({ saved, duplicates, flagged, errors, total: punches.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ZKTeco ADMS Protocol (device pushes directly to Railway URL) ──────────────
// Device registers and polls
app.get('/iclock/cdata', async (req, res) => {
  const sn = req.query.SN || 'UNKNOWN';
  logger.info({ sn }, 'ZKTeco ADMS registration');
  // Tell device to push attendance in real-time with no encryption
  res.set('Content-Type', 'text/plain').send(
`GET OPTION FROM: ${sn}
ATTLOGStamp=9999
OPERLOGStamp=9999
ATTPHOTOStamp=9999
ErrorDelay=30
Delay=10
TransTimes=00:00;23:59
TransInterval=1
TransFlag=0011011000000000
Realtime=1
Encrypt=None
ServerVer=2.4.1 2015-04-14
PushProtVer=2.2.14 1.3.1
PushOptionsFlag=1
`);
});

// Device pushes attendance records
app.post('/iclock/cdata', async (req, res) => {
  try {
    const sn    = req.query.SN || req.body?.SN || 'UNKNOWN';
    const table = (req.query.table || req.body?.table || '').toUpperCase();

    // Bug fix: only skip if table is explicitly set to something OTHER than ATTLOG.
    // MB160 raw push sends no table param at all — previously this blocked everything.
    if (table && table !== 'ATTLOG') { res.set('Content-Type','text/plain').send('OK'); return; }

    // Extract raw body — three sources in priority order:
    // 1. URL-encoded form field: data=ATTLOG\t...  (some ZKTeco firmware)
    // 2. express.text() parsed string: raw text/plain body  (MB160, confirmed from device capture)
    // 3. Fallback empty string
    let rawData = (req.body && typeof req.body === 'object' && req.body.data)
      ? req.body.data
      : (typeof req.body === 'string' ? req.body : '');

    if (!rawData) {
      logger.warn({ sn, contentType: req.headers['content-type'] }, 'ADMS POST body empty — nothing to parse');
      res.set('Content-Type','text/plain').send('OK');
      return;
    }

    let saved = 0, duplicates = 0;
    for (const rawLine of rawData.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('OPLOG')) continue;

      let staffId, punchTime, punchType, verifyType;

      if (line.startsWith('ATTLOG')) {
        // Format A (URL-encoded / old firmware): ATTLOG\tPIN\tYYYY-MM-DD HH:MM:SS\tSTATUS\tVERIFY\t...
        const parts = line.split(/\t/);
        if (parts.length < 3) continue;
        staffId    = String(parts[1]).trim().toUpperCase();
        punchTime  = new Date(parts[2].trim());
        punchType  = parseInt(parts[3] || '0', 10);
        verifyType = parseInt(parts[4] || '1', 10);
      } else {
        // Format B (raw text/plain, MB160 confirmed): PIN  DATE  TIME  VERIFY  STATUS  0  0  ...
        // Captured example: 11112222  2026-07-21  11:02:20  255  1  0  0  0  00  0
        const parts = line.split(/\s+/);
        if (parts.length < 3) continue;
        staffId    = String(parts[0]).trim().toUpperCase();
        punchTime  = new Date(`${parts[1]} ${parts[2]}`);
        // parts[3] = verify mode (255 = fingerprint auto), parts[4] = in/out status
        verifyType = parseInt(parts[3] || '1', 10);
        punchType  = parseInt(parts[4] || '0', 10);
      }

      if (!staffId || isNaN(punchTime.getTime())) continue;

      const { isDuplicate, isFlagged, flagReason } = await zkCheckPunch(staffId, punchTime);
      if (isDuplicate) { duplicates++; continue; }
      try {
        await prisma.zKAttendancePunch.upsert({
          where:  { staffId_punchTime: { staffId, punchTime } },
          update: {},
          create: { staffId, punchTime, punchType, verifyType, deviceSerial: sn, source: 'adms', isFlagged, flagReason },
        });
        await zkUpdateDailyRecord(staffId, punchTime);
        saved++;
      } catch {}
    }
    logger.info({ sn, saved, duplicates }, 'ADMS punch batch');
    res.set('Content-Type','text/plain').send('OK');
  } catch (e) {
    logger.error(e, 'ADMS cdata error');
    res.set('Content-Type','text/plain').send('OK'); // Always ACK — device must not retry forever
  }
});

// Device polls for pending commands (heartbeat)
app.get('/iclock/getrequest', (req, res) => {
  res.set('Content-Type','text/plain').send('OK');
});

// Device sends command result
app.post('/iclock/devicecmd', (req, res) => {
  res.set('Content-Type','text/plain').send('OK');
});

// ── ZKTeco status & punch log ─────────────────────────────────────────────────
app.get('/api/hr/zkteco/status', hrAuth, async (req, res) => {
  try {
    const last = await prisma.zKAttendancePunch.findFirst({ orderBy: { punchTime: 'desc' } });
    const today = new Date(); today.setHours(0,0,0,0);
    const [todayCount, flaggedCount, totalPunches] = await Promise.all([
      prisma.zKAttendancePunch.count({ where: { punchTime: { gte: today }, isDuplicate: false } }),
      prisma.zKAttendancePunch.count({ where: { isFlagged: true } }),
      prisma.zKAttendancePunch.count({ where: { isDuplicate: false } }),
    ]);
    res.json({
      lastPunchAt: last?.punchTime ?? null,
      lastDevice:  last?.deviceSerial ?? null,
      lastSource:  last?.source ?? null,
      todayPunches: todayCount,
      flaggedPunches: flaggedCount,
      totalPunches,
      admsEndpoint: `${process.env.APP_BASE_URL || ''}/iclock/cdata`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hr/zkteco/punches', hrAuth, async (req, res) => {
  try {
    const { date, staffId, flagged } = req.query;
    const where = {};
    if (date) { const d = new Date(date); d.setHours(0,0,0,0); const d2 = new Date(d); d2.setDate(d2.getDate()+1); where.punchTime = { gte: d, lt: d2 }; }
    if (staffId) where.staffId = staffId;
    if (flagged === 'true') where.isFlagged = true;
    const punches = await prisma.zKAttendancePunch.findMany({
      where, orderBy: { punchTime: 'desc' }, take: 500,
    });
    res.json(punches);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Payroll (stub) ────────────────────────────────────────────────────────────
app.get('/api/hr/payroll', hrAuth, async (req, res) => { res.json([]); });
app.post('/api/hr/payroll/process', hrAuth, async (req, res) => {
  res.json({ processed: 0, message: 'No payroll engine configured yet' });
});
app.put('/api/hr/payroll/:id/paid', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, status: 'paid' });
});

// ── Recruitment (stub) ────────────────────────────────────────────────────────
app.get('/api/hr/jobs', hrAuth, async (req, res) => { res.json([]); });
app.post('/api/hr/jobs', hrAuth, async (req, res) => {
  res.status(201).json({ id: Date.now(), ...req.body, status: 'open', createdAt: new Date() });
});
app.put('/api/hr/jobs/:id', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, ...req.body });
});
app.post('/api/hr/jobs/:id/close', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, status: 'closed' });
});
app.delete('/api/hr/jobs/:id', hrAuth, async (req, res) => {
  res.json({ success: true });
});
app.get('/api/hr/jobs/:id/applicants', hrAuth, async (req, res) => { res.json([]); });
app.post('/api/hr/jobs/:id/applicants', hrAuth, async (req, res) => {
  res.status(201).json({ id: Date.now(), jobId: req.params.id, ...req.body, stage: 'applied', createdAt: new Date() });
});
app.put('/api/hr/applicants/:id/stage', hrAuth, async (req, res) => {
  res.json({ id: req.params.id, stage: req.body.stage });
});

// ── FRONTEND SERVING ──
// Health check (must be before static + SPA fallback)
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/logo.png', (req, res) => {
  const logoPath = findBrandLogoPath();
  if (!logoPath) return res.status(404).type('text/plain').send('Logo not found');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(logoPath);
});
app.get('/logo.svg', (req, res) => {
  const logoPath = path.join(__dirname, 'samples', 'logo.svg');
  if (!fs.existsSync(logoPath)) return res.status(404).type('text/plain').send('Logo SVG not found');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('image/svg+xml').sendFile(logoPath);
});

const distPath = path.join(__dirname, 'rms_frontend', 'dist');
const assetsPath = path.join(distPath, 'assets');
const indexPath = path.join(distPath, 'index.html');

// ── Static downloads (APK etc.) — served through /api/downloads/:file ──────
// Nginx proxies /api/ to this Express server, so no Nginx config change needed.
const downloadsPath = path.join(__dirname, 'downloads');
app.get('/api/downloads/:file', (req, res) => {
  const file = path.basename(req.params.file); // strip any path traversal
  const full = path.join(downloadsPath, file);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  res.download(full, file);
});

function verifyFrontendBuild() {
  if (!fs.existsSync(indexPath)) {
    logger.error({ indexPath }, '[FRONTEND] Missing build output. Run npm run build before starting the server.');
    return;
  }

  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    const assetRefs = [...html.matchAll(/(?:src|href)=["']\/(assets\/[^"']+)["']/g)]
      .map(match => match[1]);
    const missingAssets = assetRefs.filter(asset => !fs.existsSync(path.join(distPath, asset)));

    if (missingAssets.length > 0) {
      logger.error({ missingAssets }, '[FRONTEND] Built index.html references missing asset files.');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '[FRONTEND] Could not verify build assets.');
  }
}

verifyFrontendBuild();

app.use('/assets', express.static(assetsPath, {
  fallthrough: false,
  immutable: isProd,
  index: false,
  maxAge: isProd ? '1y' : 0,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

app.use('/assets', (err, req, res, next) => {
  const status = err.status || err.statusCode;
  if (status === 404) {
    logger.warn({ path: req.originalUrl }, '[FRONTEND] Missing static asset requested.');
    return res.status(404).type('text/plain').send('Static asset not found. Redeploy the latest frontend build.');
  }
  next(err);
});

app.use(express.static(distPath, {
  index: false,
  maxAge: isProd ? '1h' : 0,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const fileName = path.basename(filePath);
    if (fileName === 'index.html' || fileName === 'sw.js' || fileName === 'registerSW.js' || fileName === 'manifest.webmanifest') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
  if (!fs.existsSync(indexPath)) {
    return res.status(500).type('text/plain').send('Frontend build output is missing. Run npm run build before starting the server.');
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexPath);
});

// ── Global error handler — catches errors thrown by middleware (multer file-type/size
// rejections, JSON parse failures, etc.) before they reach Express's default HTML/stack
// trace response. Every API error becomes a clean JSON message, never raw or silent.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isMulterError = err?.name === 'MulterError';
  const status = err?.status || (isMulterError && err.code === 'LIMIT_FILE_SIZE' ? 413 : err?.statusCode) || 400;
  let message = err?.message || 'Request failed. Please try again.';
  if (isMulterError && err.code === 'LIMIT_FILE_SIZE') message = 'File is too large. Please upload a smaller file.';
  logger.warn(`[ERROR] ${req.method} ${req.path} → ${status}: ${message}`);
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
  logger.info(`🚀 CSS RMS Unified Node listening on port ${PORT}`);

  // Background Boot Sequence (Allows instant PORT binding for Railway health checks)
  const { exec } = require('child_process');
  const runSetup = (cmd) => new Promise((resolve) => {
    const p = exec(cmd);
    p.stdout.pipe(process.stdout);
    p.stderr.pipe(process.stderr);
    p.on('exit', () => resolve());
  });

  try {
    if (process.env.SKIP_DB_BOOT === 'true') {
      logger.info('[BOOT] Skipping DB sync as requested');
      isSystemReady = true;
    } else {
      // Schema migrations already ran via `prisma migrate deploy` in the `npm start`
      // script, before this process even launched - nothing left to sync here.
      logger.info('[BOOT] Seeding core authority records...');
      await runSetup('node rms_backend/prisma/seed.js');

      // One-time data fix: rename ICC department if it was created with the old incorrect name
      try {
        const iccFixed = await prisma.department.updateMany({
          where: { name: { in: ['Internal consult and control (ICC)', 'Internal consult and control'] } },
          data: { name: 'Internal Control & Compliance (ICC)' }
        });
        if (iccFixed.count > 0) {
          logger.info(`[BOOT] Renamed ${iccFixed.count} ICC department(s) to correct full name.`);
        }
      } catch (e) {
        logger.warn('[BOOT] ICC name fix skipped:', e.message);
      }

      // Secondary setup tasks already in serve.js logic
      try {
        await ensureActivePublicKey();
        logger.info('[BOOT] Active signing key ensured');
      } catch (e) {
        logger.warn('[BOOT] Signing key check deferred:', e.message);
      }

      isSystemReady = true;
      logger.info('✅ [SYSTEM READY] Requisition Management Service fully operational.');
    }
  } catch (err) {
    logger.error('[BOOT CRITICAL] Database sync failed:', err.message);
    // Allowing the server to stay up allows the user to see logs
  }
});

const gracefulShutdown = (signal) => {
  logger.info(`[SHUTDOWN] ${signal} received — closing server gracefully...`);
  server.close(async () => {
    try { await prisma.$disconnect(); } catch (_) { }
    logger.info('[SHUTDOWN] Database disconnected. Exiting.');
    process.exit(0);
  });
  // Force-kill if still not done after 10 s
  setTimeout(() => { logger.error('[SHUTDOWN] Timeout — forcing exit.'); process.exit(1); }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
