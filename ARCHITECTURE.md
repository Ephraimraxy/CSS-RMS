# CSS RMS — Architecture & Operations Guide

> **Who this is for:** anyone touching this codebase for the first time — a new developer with no memory of past sessions, or the project owner coming back after months away. Assume zero prior context.
>
> **How this file stays useful:** this file is maintained by hand as part of normal development — there is no automated process that rewrites it from code changes. The in-app Documentation page always renders whatever is *currently* in this file (read live from disk, no caching), so once this file is updated and deployed, the change shows up immediately with no extra step. If you make a structural change and don't see it reflected here, it means the person/assistant who made the change forgot to update this file — treat that as a bug in the change, not in the page.

---

## 1. What this system is

**CSS RMS** ("Requisition Management System") is the internal operations portal for CSS Group. It runs:
- **Requisitions** — Cash and Material spending requests that move through a multi-department approval/vetting chain before money or materials are released.
- **Memos** — Internal documents routed between departments, separate from the spending workflow.
- **Document Studio** — An in-browser Word/Excel/PowerPoint-equivalent for drafting memos and requisition content, with offline autosave and export to real Office file formats.
- **HR Portal** — Employee directory, leave, attendance, payroll, recruitment (a largely separate module under the same login).
- **Departments & Sub-Accounts** — Every login is a "Department" record (including the Super Admin, which is itself a Department row named "Super Admin" — see §6 gotcha). Departments can spawn Sub-Accounts (delegated sub-units with restricted privileges).
- **ICC (Internal Control & Compliance) Oversight** — A department with special global-observer powers that can freeze/vet any requisition regardless of normal routing. ICC review of cash payments is configurable: by default, ICC must clear every cash payment before Account can disburse; the Super Admin can set a per-actor direct-pay limit (Account, CEO/Chairman) so that payments below that threshold bypass ICC automatically.
- **Audit Override / Re-approval Escalation** — Audit or ICC can revise a requisition's price before or after approval; if the revision pushes the amount above the original approver's authority, the system force-routes it to a higher authority tier automatically.
- **Department Self-Approval** — An optional setting that lets small cash requests (below a configured limit) be auto-approved at department level, skipping the HR/GM/CEO chain entirely. Smart escalation applies: if Audit later raises the amount above the limit, the system automatically flags it and blocks treatment until the correct authority confirms.

**How to classify this system:**
CSS RMS is a **SaaS** (Software as a Service) application — hosted, browser-based, no installation needed. Within the enterprise software taxonomy it sits in the **Procure-to-Pay (P2P) / Expenditure Authorization** category: its job is managing *who can approve what spending, in what order*, not tracking physical stock. It is **not** an Inventory Management System — the "Material Request" module covers the approval workflow for requesting materials (who authorizes it, how much it costs), not tracking warehouse quantities or stock levels. An IMS sits downstream: after CSS RMS approves and pays for something, an IMS would track where those goods go.

---

## 2. Tech stack

### Backend
| Piece | What | Why it matters |
|---|---|---|
| Runtime | Node.js ≥ 20 | — |
| Framework | Express 5 | Single server, all routes in one file (`serve.js`) |
| Database | PostgreSQL | Hosted on Railway |
| ORM | Prisma 6 | Schema at `rms_backend/prisma/schema.prisma` |
| Auth | `jsonwebtoken` + `bcryptjs` | JWT in an httpOnly cookie (`cookie-parser`) |
| File storage | AWS S3 (`@aws-sdk/client-s3`) | Attachments, signatures |
| PDF generation | `pdf-lib` | Requisition/memo print records, generated server-side |
| Email | `nodemailer` | Notifications |
| SMS | Termii or Twilio (switchable in System Settings) | Activation codes, notifications |
| AI | OpenAI (`openai`) | Draft refinement, grammar/metadata extraction |
| Security | `helmet`, `express-rate-limit`, `xss`, `zod` (validation) | — |
| Logging | `pino` / `pino-http` | — |
| Hosting | Railway | `css-rms.up.railway.app` |

### Frontend
| Piece | What | Why it matters |
|---|---|---|
| Framework | React 19 + Vite | `rms_frontend/` |
| Styling | Tailwind CSS | Utility classes everywhere, no CSS-in-JS |
| Routing | Custom — `window.location.hash` + a `views` object map in `App.jsx` | Not React Router. See §6 gotcha. |
| Word editor | **TipTap** (ProseMirror-based) | Migrated from raw `contentEditable` + `execCommand` — see §7 |
| Spreadsheet editor | **`@fortune-sheet/react`** | A full Excel-clone engine — ships its **own** complete toolbar (formulas, conditional formatting, sort/filter, etc.) out of the box. Don't rebuild what it already has. |
| Presentation editor | **Quill** | Rich-text only — no shapes/canvas/object model. Don't expect PowerPoint-style Drawing/Arrange features without a full engine swap (Fabric.js/Konva). |
| Office exports | `xlsx` (SheetJS), `pptxgenjs`, `jspdf` + `html2canvas`, `file-saver` | Real `.doc`/`.xlsx`/`.csv`/`.pptx`/`.pdf` downloads |
| Offline storage | `localforage` (IndexedDB) | Document Studio drafts persist offline |
| Markdown rendering | `react-markdown` | Used by the in-app Documentation page (this file) |
| Notifications | `react-hot-toast` | — |
| Icons | `lucide-react` | — |
| PWA | `vite-plugin-pwa` | Service worker, installable |

### Deployment
- **Railway**, single service running `npm start` from the repo root, which runs `prisma migrate deploy && node serve.js` (see §5).
- The frontend is built (`vite build`) into `rms_frontend/dist` and served as static files by the same Express server in production.
- **Two environments**: `dev` branch → Railway **staging**, `main` branch → Railway **production**. See §32 for the full CI/CD pipeline.

---

## 3. Project structure

```
Pro-RMS/
├── serve.js                     ← THE backend. ~9,000 lines, every API route lives here.
├── package.json                 ← root scripts: build / start / seed / deploy-sync
├── .env                         ← secrets (DATABASE_URL, JWT secret, API keys) — gitignored, never commit
├── .env.example                 ← template showing what .env needs
├── ARCHITECTURE.md              ← this file
│
├── rms_backend/
│   └── prisma/
│       ├── schema.prisma        ← THE database schema, source of truth for structure
│       ├── seed.js               ← initial data seeding script
│       └── migrations/           ← versioned migration history (see §5) — DO commit this folder
│
└── rms_frontend/
    ├── src/
    │   ├── App.jsx               ← top-level router: hash-based view switching, role gating
    │   ├── index.css             ← global styles, Tailwind base + custom overrides
    │   ├── components/           ← ~33 components, one file per page/major feature (flat, no subfolders)
    │   │   ├── Layout.jsx         ← sidebar nav, top bar, mobile bottom nav — ~1,900+ lines
    │   │   ├── Dashboard.jsx      ← "Oversight Command" home screen
    │   │   ├── RequisitionsPage.jsx  ← the requisition list + detail modal — ~5,600 lines, the biggest single feature file
    │   │   ├── DocumentStudio.jsx ← Document Studio orchestrator only (drafts, tab switching) — ~390 lines
    │   │   ├── documentStudio/    ← the three editors, each lazy-loaded as its own bundle chunk (shared.jsx, RichTextEditor.jsx [TipTap], SpreadsheetEditor.jsx [Fortune-sheet], PresentationEditor.jsx [Quill+pptxgenjs], SendToWorkflowModal.jsx)
    │   │   ├── DepartmentManager.jsx, SubAccountsPanel.jsx, WorkflowBuilder.jsx, AuditLogs.jsx, IccOversightPage.jsx, ...
    │   │   └── (HR module) HRDashboard.jsx, EmployeeDirectory.jsx, LeaveManagement.jsx, AttendanceTracker.jsx, PayrollOverview.jsx, RecruitmentPipeline.jsx
    │   ├── lib/
    │   │   ├── store.jsx          ← frontend data layer: wraps API calls, caches to localforage, normalizes records
    │   │   ├── api.js             ← raw fetch wrappers per API resource
    │   │   ├── templates.js       ← Document Studio's Memo/Material Request templates
    │   │   ├── tiptapFindReplace.js ← custom TipTap extension (Find & Replace, built on ProseMirror decorations)
    │   │   └── featureFlag.js     ← cached feature-flag loader (fails to last-known-good, not fail-open)
    │   └── context/               ← React context providers (AI features toggle, etc.)
    └── public/                    ← static assets (logo, manifest, etc.)
```

**Where to look for X:**
- A bug in how a requisition is displayed/listed → `RequisitionsPage.jsx` first, but check `Dashboard.jsx` too — **the same display logic is currently duplicated across both files**, not shared (see §8).
- A bug in an API response → `serve.js`, search for the route path string.
- A bug in the Word/Excel/PowerPoint editors → `DocumentStudio.jsx`. Word = `RichTextEditor` (TipTap), Excel = `SpreadsheetEditor` (Fortune-sheet), PowerPoint = `PresentationEditor` (Quill) — all three are components inside this one file.
- A database field that doesn't seem to exist → check `schema.prisma` first, then check if the API route actually `select`s it (a recurring bug class this project has had: a field exists in the schema but a specific endpoint's Prisma `select` clause forgot to include it, so the frontend silently receives `undefined` for it).

---

## 4. The core domain model (how a Requisition actually moves)

A `Requisition` is Cash, Material, or (for the Memo subtype) just a routed document. Key fields and what they mean:

| Field | Meaning |
|---|---|
| `status` | Coarse lifecycle: `draft`, `pending`, `approved`, `rejected` |
| `finalApprovalStatus` | Fine-grained stage: `none` → `vetting` → `approved` → `treated`/`published` (or `rejected` at any point) |
| `targetDepartmentId` | Where the request was last **forwarded** through the normal approval chain |
| `currentVettingDeptId` | Where the request **actually is right now** if it's gone through an ICC/Audit vetting detour. **This is different from `targetDepartmentId` and the two can disagree** — see the gotcha in §6. |
| `hasAuditOverride` / `auditAmount` | Audit revised the amount pre-approval |
| `hasIccOverride` / `iccOverrideAmount` | ICC revised the amount post-approval — **takes priority over Audit's figure when both exist**. On the **frontend**, this precedence is centralized in `rms_frontend/src/lib/requisitionDisplay.js`'s `getEffectiveAmount(req)` — every component that needs to show "what's the real amount" should call this, not re-derive it. On the **backend**, `getEffectiveReqAmount()` in `rms_backend/lib/businessRules.js` mirrors the same rule. If this priority ever changes, update both. |
| `isSelfApproved` | `true` when the dept self-approval feature auto-approved the request — the requesting department bypassed HR/GM/CEO. The re-approval escalation logic uses this flag to check against the system's `dept_self_approval_limit` setting instead of normal authority bands. |
| `needsReapproval` / `reapprovalAuthority` | Set when a price revision pushes the amount above the original approver's authority tier (or above the self-approval limit for self-approved requests) — blocks treatment until the correct tier confirms. The reason string is descriptive and appears verbatim in the UI. |
| `treatedByDeptId` / `treatedAt` | Final disbursement/fulfillment recorded |

**The vetting detour, explained simply:** normally a requisition flows Creator → Department A → Department B → ... → Final Approver → Treated. ICC (and Audit, for price checks) can intercept this at any point and pull the request into a side-loop for verification. While it's in that loop, `currentVettingDeptId` tracks its real location, but `targetDepartmentId` stays frozen at whatever it was before the detour started. **Any UI that shows "where is this request right now" must check `currentVettingDeptId` first and only fall back to `targetDepartmentId` if the request isn't currently in a vetting detour and hasn't been treated/published.** This exact bug (showing the frozen `targetDepartmentId` instead of the live location) was found and fixed independently in three different places before being unified — see `getLiveTrailDepartment(req, departments)` in `rms_frontend/src/lib/requisitionDisplay.js`, which is now the single source of truth for this on the frontend.

---

## 5. Database changes — the migration workflow (read this before touching `schema.prisma`)

**This changed recently.** It used to be: edit `schema.prisma`, deploy, and `prisma db push --accept-data-loss` would silently force the live database to match — no history, no warnings, just "make it so." That's gone.

**Current process — every single time you change `schema.prisma`:**

1. Make sure `.env` at the repo root has a working `DATABASE_URL` pointing at the **real** database (get it from Railway → Postgres service → Variables tab). Never commit this file — it's gitignored.
2. Edit `schema.prisma`.
3. Run, from the repo root:
   ```
   npx prisma migrate dev --schema=rms_backend/prisma/schema.prisma --name describe_your_change
   ```
   This connects to the real database, diffs it against your schema change, generates a new timestamped folder under `rms_backend/prisma/migrations/`, and applies it immediately to the database you're connected to.
4. Commit the new migration folder along with your `schema.prisma` change — **in the same commit**. A schema change without its migration file is a broken commit.
5. Deploy normally (push to `main`). Railway will run `prisma migrate deploy` (via the `start` script) which applies only the new migration(s) — it never tries to guess or force anything.

**If `migrate dev` ever reports unexpected drift** (says there are changes you didn't make), stop and figure out why before proceeding — it usually means someone changed the live database directly (e.g. via a SQL console) without going through this process. Don't blindly accept whatever Prisma proposes in that situation.

**The migration logbook:** every applied migration is recorded by Prisma itself in a special table (`_prisma_migrations`) inside the database. The in-app admin Documentation page's "Migration Logbook" tab reads this table directly and shows it read-only — that part of the page is **fully automatic**, no maintenance needed, it always reflects database reality.

---

## 6. Structural gotchas — things that look like bugs but are deliberate, and things that actually are landmines

These are the ones worth knowing before you go looking for a "bug" that's actually expected behavior, or before you accidentally trip a real landmine:

1. **Super Admin is a Department row.** The Super Admin login is backed by a real `Department` named "Super Admin." Any logic that gates on `!userDeptId` to mean "this is the admin" is wrong — admin has a `deptId` like everyone else. Gate on `role === 'global_admin'` instead.
2. **Departments are partly identified by name-pattern regex, not a type field.** HR, Store, and ICC departments are detected in places via `/\bhr\b/i.test(name)`-style regex against the department's *name string*, not a dedicated `departmentType` column. Renaming "HR" department to something without "hr" in it would silently break HR-specific access logic. This is fragile by design — be careful renaming departments in production.
3. **`targetDepartmentId` ≠ "where the request is now."** Covered in §4. Always prefer `currentVettingDeptId` when a vetting detour is active.
4. **ICC's override beats Audit's override, not the reverse.** If both `hasAuditOverride` and `hasIccOverride` are set, the effective amount is ICC's, because ICC acts later (post-approval) in the real-world process.
5. **Routing uses `window.location.hash` + a hand-rolled view map, not React Router.** `App.jsx`'s `VALID_VIEWS` array and `views` object are the entire router. Adding a new top-level page means adding it to both, plus a nav entry in `Layout.jsx`, plus (if admin-only) adding it to the `isAdminView` check.
6. **Tailwind's preflight CSS sets `img { display: block }` globally.** A parent's `text-align: center` does nothing for an `<img>` because of this — center images with `display:block; margin:0 auto` directly on the `<img>` itself, not via a wrapping container's `text-align`.
7. **A lingering CSS `transform` on any ancestor traps `position: fixed` descendants inside it instead of the real viewport.** This has bitten multiple modals (Edit Department, Document Studio's template-replace confirmation). The fix pattern: either don't use `animation-fill-mode: forwards` on ancestor animations, or render the modal through a React portal to `document.body` (the more bulletproof fix — see `ConfirmModal.jsx`).
8. **TipTap's Table extension takes over *any* `<table>` tag** in HTML you feed it via `setContent`/paste — it coerces it into its own structured table-node schema, which only preserves `colspan`/`rowspan`/`colwidth` on cells and **silently strips other inline styles** (custom borders, text-align, widths). If you need a `<table>`-looking layout that *isn't* meant to be a real editable data grid (e.g. a letterhead's field rows), build it with flex/grid `<div>`s instead — see `lib/templates.js`.
9. **TipTap v3's `setContent(content, options)` takes an options *object* as the second argument, not a boolean.** `setContent(html, false)` does not do what it looks like it does (it gets destructured against a non-object and silently falls back to defaults). Use `setContent(html, { emitUpdate: false })`.
10. **`prisma db push` is gone — see §5.** If you're reading old conversation history or old docs that mention it, that information is stale.
11. **TipTap's Image node only preserves `src`/`alt`/`title`/`width`/`height` — not arbitrary inline `style`.** Same lesson as #8 but for images: any unrecognized HTML tag (no registered extension) gets silently dropped entirely during `setContent` parsing, and even recognized nodes only keep the attributes their extension explicitly tracks. Center/size images via real HTML attributes + global CSS (`.editor-paper img { ... }`), not inline `style`.
12. **`authenticateToken` does a DB lookup for every department-role request, not just admin/User-table logins.** This is deliberate: `Department.tokenVersion` is embedded in every department/sub-account JWT at sign time and checked against the live DB value on each request, so a Security Reset (Department Manager → the rose KeyRound icon) can force-log-out every device that department is signed into instantly, without tracking individual tokens. The check fails *open* on a transient DB error (a connectivity blip shouldn't lock out every department session at once) — this is defense-in-depth layered on top of the JWT signature check, not a replacement for it. If you add a new way to issue a department JWT, you must include `tokenVersion: dept.tokenVersion || 0` in its payload, or that login path will silently bypass force-logout (the comparison falls back to `0` and never matches a department that's ever been reset).

---

## 7. Notable past architectural decisions (so you don't re-litigate or accidentally undo them)

- **Document Studio's Word editor was migrated from raw `contentEditable` + `document.execCommand` to TipTap.** This was deliberate: `execCommand` is deprecated, can't reliably reflect active formatting state at the cursor, and made building real Find & Replace / Clear Formatting impractical. Don't migrate it back.
- **The Spreadsheet and Presentation editors were deliberately left on their existing engines** (Fortune-sheet, Quill) rather than also being rewritten, because Fortune-sheet already ships a complete Excel-equivalent toolbar natively, and a true PowerPoint-style rebuild of the Presentation editor (shapes, canvas, Arrange, Design themes, Animations) would require swapping Quill for a canvas engine entirely — a much bigger, separately-scoped project that hasn't been started.
- **Offline drafts use `localforage`, not direct server saves**, so Document Studio works without a network connection; autosave persists to IndexedDB and only reaches the server when the user explicitly sends it into the workflow.
- **Feature flags fail to "last known good value" (cached), not fail-open to `true`.** A network blip must never silently re-expose a Super-Admin-disabled feature.

---

## 8. Known weak spots (be honest with yourself about these before assuming the code is correct)

- **An automated test suite exists, but only covers a thin slice so far.** Vitest is set up in both the root (backend) and `rms_frontend/` (frontend) — run `npm test` in either directory. Currently covered: the pure business-rule functions in `rms_backend/lib/businessRules.js` (authority-tier bands, override precedence — 20 tests) and `rms_frontend/src/lib/requisitionDisplay.js` (effective amount, live trail location — 15 tests). **Not yet covered:** anything touching the database (no integration tests exist yet), the vetting/approval state machine end-to-end, any React component rendering, and the vast majority of `serve.js`'s ~9,000 lines (most of it is still inline route handlers, not extracted into testable pure functions). Before this, every fix in this project's history was verified by `node --check` (syntax only), `npm run build` (compiles), and then the user manually finding the next bug in production — that's still true for anything outside the two files above. Treat anything not covered by an actual test as unverified, no matter how confident a past commit message sounds. **When you extract more business logic out of `serve.js` or a frontend component, write its test in the same commit** — that's how this slice grows instead of staying frozen at "the two files someone happened to touch on one particular day."
- **Business display logic was duplicated, not shared — now fixed.** "What's the effective amount for this requisition," "where is this requisition right now," and the per-record field-flattening helper (`normalizeReq`) used to be implemented independently across `RequisitionsPage.jsx` (list table + detail modal) and `Dashboard.jsx` (two places) — five separate copies of three rules, each needing its own bugfix, and `normalizeReq`'s two copies had already drifted apart (one had four extra fields the other lacked). All three are now unified into `rms_frontend/src/lib/requisitionDisplay.js` (`getEffectiveAmount`, `getLiveTrailDepartment`, `normalizeReq`) and every call site imports from there instead of re-deriving it. **General rule going forward:** when you fix a display bug involving these two files, grep for the same pattern in the other before assuming you're done — and check `requisitionDisplay.js` first, since the answer to "how do I compute X" may already live there.
- **`serve.js` (~9,000 lines) and `RequisitionsPage.jsx` (~5,600 lines) are both still monolithic files.** No service/repository layering on the backend; routes call Prisma directly. `DocumentStudio.jsx` was split this way (see §3, `documentStudio/`) as a proof of pattern, but `serve.js` and `RequisitionsPage.jsx` have NOT been — they're larger and riskier to split safely without more test coverage than currently exists. Be cautious about large refactors here until the test suite covers more of their behavior.
- **Full CI/CD pipeline exists** (`.github/workflows/ci.yml`) — runs backend syntax check + both test suites + a full frontend build on every push to `dev`/`main` and every PR to `main`. CI must pass before a PR can merge to `main` (branch protection enforces this). Merges to `main` trigger a production deploy only after a manual approval step in GitHub Environments. See §32 for the complete flow.
- **The `DocumentStudio` bundle was split** (see §3) — `RichTextEditor`/`SpreadsheetEditor`/`PresentationEditor` now lazy-load as separate chunks instead of one ~3.8MB bundle for all three. Opening Word or PowerPoint now downloads ~520KB instead of 3.8MB; Excel still pulls Fortune-sheet's own ~2.7MB bundle on its own merits (that engine is genuinely large), but no longer drags the other two along with it. Other large chunks (`RequisitionsPage`, `WorkflowBuilder`, etc.) have not been similarly split yet.

---

## 9. Backup & disaster recovery

The database and uploaded files live on Railway and Cloudflare respectively — neither is under this project's own control. If either had an outage, locked the account, or simply disappeared, anything that only lived there would be gone. Files are already safe from this (they're on Cloudflare R2, not Railway's disk — see §2/§3), but the database had no independent copy anywhere until this was added.

**Two independent, automated daily backups**, neither depending on the other or on Railway:

1. **Cloudflare R2** (`backups/db/` in the same bucket files already use) — a plain `pg_dump` snapshot.
2. **The super admin's personal Google Drive** — the same snapshot, but AES-256 encrypted first, so it's unreadable to anyone (including Google) without the encryption key.

Both run via `.github/workflows/db-backup.yml`, daily at 02:00 UTC, on GitHub's own infrastructure — deliberately independent of Railway, so the backup still runs even if Railway itself is the thing that's down. Either destination alone is enough to fully reconstruct the database from scratch on any fresh Postgres instance, anywhere — that's what makes this a real disaster-recovery story rather than just "Railway has its own snapshot feature."

- `scripts/backup-db.js` — dumps + uploads the plain copy to R2.
- `scripts/backup-db-to-drive.js` — dumps, encrypts (`scripts/backup-crypto.js`, AES-256-GCM), uploads to Drive. Talks to Google's REST APIs directly over plain `https` rather than through the `googleapis` package's own request layer — that layer's internal use of Node's built-in `fetch` produced a reproducible `Premature close` error on two different Google endpoints when run inside GitHub Actions' containers (not transient flakiness — it failed identically every time on the affected endpoint). Confirmed fix: bypass that transport entirely.
- `scripts/decrypt-backup.js`, `scripts/encrypt-backup.js`, `scripts/generate-backup-key.js`, `scripts/get-google-refresh-token.js` — restore and one-time setup helpers, not part of the daily run.

**Full setup instructions, the architecture diagram, and exact restore commands for both destinations are in `admin_user_manual.md`** (the "Database Backups & Disaster Recovery" section) — written for a new admin with zero prior context.

One gotcha if this is ever touched again: GitHub Actions runs *outside* Railway's private network, so its `DATABASE_URL` secret must be the external `ballast.proxy.rlwy.net` proxy address — `postgres.railway.internal` only resolves from inside Railway's own network and will silently fail to connect from anywhere else (including GitHub Actions or a local machine).

---

## 10. Quick reference — common commands

```bash
# Install everything (run from repo root)
npm run build              # generates Prisma client + installs/builds frontend

# Run the backend locally (needs .env with a real DATABASE_URL)
node serve.js

# Run the frontend dev server (separate terminal, from rms_frontend/)
npm run dev

# Apply a schema change safely (see §5 for the full procedure)
npx prisma migrate dev --schema=rms_backend/prisma/schema.prisma --name your_change_name

# Check what migrations exist / are pending
npx prisma migrate status --schema=rms_backend/prisma/schema.prisma

# Seed initial data
npm run seed

# Run backend tests (root) — pure business-rule functions, no DB needed
npm test

# Run frontend tests (from rms_frontend/) — shared display logic, no DB needed
npm test
```

---

## 11. Authentication — two separate login systems

There are **two completely different auth flows** that share the same JWT middleware but issue tokens in very different ways. Mixing them up is a common source of confusion.

### System A — User / Admin login (`/api/auth/login`)

Standard email + password. Issues a JWT containing `{ id, role, email, name, ... }`. Used by the Super Admin (`global_admin`) and any regular User-table accounts. Tokens are stateless — there is no server-side session, and force-logout is not possible for these accounts (no `tokenVersion` check exists for User-table logins). Role is embedded in the token and also re-read from the database on sensitive admin routes.

### System B — Department login (`/api/auth/dept-login`)

Department accounts do **not** have passwords in the traditional sense. They use a numeric **access code** (set at creation or changed by admin). The login flow:

1. Department enters their access code → server verifies → checks if the department is `activated`.
2. **If not yet activated:** an SMS OTP is sent to the department head's phone via Termii/Twilio. Department enters the OTP at `/api/departments/activate` → account becomes activated, first JWT issued.
3. **If already activated:** JWT is issued immediately (no OTP needed on subsequent logins).

The JWT contains `{ deptId, role: 'department', name, tokenVersion }`. The `tokenVersion` field is what enables **force-logout** — see gotcha §6.12.

### Security Reset (`/api/departments/:id/security-reset`)

Admin-only. Increments `tokenVersion` in the database for that department. Every subsequent request from any device holding the old token will fail the `tokenVersion` check and be rejected, effectively logging out every active session for that department simultaneously — no token blacklist or session store needed.

### Token storage

Both token types are returned in the response body (not set as httpOnly cookies despite `cookie-parser` being installed — it's available but not used for auth tokens). The frontend stores the JWT in `localforage` and sends it as `Authorization: Bearer <token>` on every request.

---

## 12. Real-time: SSE + Web Push notifications

### Server-Sent Events (`/api/events`)

A persistent SSE endpoint that keeps a long-lived HTTP connection open for each connected client. Used to push real-time updates (new requisitions, approvals, chat messages, notifications) to the browser without polling. Each client registers by connecting; the server stores the response object and broadcasts to it on relevant events.

`/api/events/ticket` issues a short-lived one-time auth ticket used to authenticate the SSE connection (since `EventSource` in the browser can't send custom headers, the ticket is passed as a query param and validated server-side).

### Web Push (`/api/push/subscribe`)

VAPID-based Web Push for background notifications (works even when the tab is closed, if the user granted notification permission). Setup requires generating a VAPID key pair:

```bash
npx web-push generate-vapid-keys
```

Add to Railway environment:
```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_EMAIL=mailto:admin@cssgrouprms.com
```

The public key is served at `/api/push/vapid-public` (no auth required — the frontend fetches it to register the service worker subscription). Subscriptions are stored in the database per-user. `/api/push/subscribe` upserts the subscription; `/api/push/subscribe` (DELETE) removes it.

---

## 13. Internal Chat system

A full department-to-department messaging system. Two modes:

| Mode | Endpoint | Description |
|---|---|---|
| Group chat | `/api/chat/group` | All departments in one shared channel |
| Direct message | `/api/chat/dm/:deptId` | One-to-one between any two departments |

Other endpoints:
- `/api/chat/send` — send a message (text or with a file attachment)
- `/api/chat/upload` — upload a file to attach to a chat message (stored in R2)
- `/api/chat/media` — fetch all media shared in chat (images, files)
- `/api/chat/read` — mark messages as read (drives the unread badge count)
- `/api/chat/messages/:id` (PATCH) — edit a sent message
- `/api/chat/conversations` — fetch the conversation list with last-message preview

Chat messages are delivered in real-time over SSE (the same `/api/events` stream). New messages are broadcast immediately; clients update the UI without refreshing.

---

## 14. Workflow Builder & System Feature Settings

The Workflow Builder (`WorkflowBuilder.jsx`) is the Super Admin control panel for two things: (1) the approval stage chain, and (2) a broad set of system-wide feature flags stored in the `SystemSetting` table.

### 14.1 Approval stages

The approval chain is not hardcoded — it is configured by the Super Admin. A "stage" is one step in the chain, referencing a department that must act (approve/forward/reject) before the request moves to the next stage.

- `/api/workflow-stages` (GET) — fetch the current ordered stage list
- `/api/workflow-stages` (POST) — create or reorder stages (admin only)
- `/api/requisition-types` — create/delete named requisition types (e.g. "Cash Advance", "Material Request") that appear in the "Type" dropdown when creating a requisition

**Important:** the workflow is global — one chain for the entire system. There is no per-department or per-type routing yet. If this changes, the domain model in §4 will need to be re-read carefully because `targetDepartmentId` and `currentVettingDeptId` semantics are built around a single linear chain.

### 14.2 Authority tiers (hardcoded in `rms_backend/lib/businessRules.js`)

Cash requisition approval authority is tiered by amount. These thresholds are hardcoded (not DB-stored) in `checkFinalApproveAuthority()` and `requiredAuthorityTier()`:

| Tier | Dept name pattern | Cash amount band |
|---|---|---|
| HR | `/\bhr\b|human\s*resource/i` | ≤ ₦50,000 |
| GM | `/general\s*manager|\bgm\b/i` | ₦50,001 – ₦100,000 |
| CEO/Chairman | `/ceo|chairman/i` | Any amount (full authority) |

Material requests have no cash threshold — any tier can approve regardless of amount.

**Dept self-approval (configurable):** An optional tier below the authority chain. When enabled via System Settings, cash requests at or below the configured limit are auto-approved by the requesting department itself — `finalApprovalStatus` is set to `'approved'` and `isSelfApproved` to `true` at submission time. The request then flows directly to Audit → ICC → Account. Smart escalation: if Audit raises the amount above the limit, `needsReapproval` is set automatically and treatment is blocked until the correct tier (HR/GM/CEO) re-approves. Logic lives in `checkAndApplyReapprovalEscalation()` in `serve.js`.

### 14.3 System Settings (feature flags)

All stored as key/value rows in `SystemSetting`. Managed via `settingsAPI.get/set`. Key settings:

| Setting key | What it controls |
|---|---|
| `dept_self_approval_enabled` | `'true'` / `'false'` — enables the department self-approval feature |
| `dept_self_approval_limit` | The ₦ ceiling for self-approval (e.g. `'20000'`). Only applies when enabled. |
| `icc_bypass_account_enabled` | Whether Account can pay without ICC for small amounts |
| `icc_bypass_account_threshold_amount` | ₦ limit for Account's ICC bypass (Account pays directly up to this amount) |
| `icc_bypass_ceo_enabled` | Whether CEO/Chairman can pay without ICC for small amounts |
| `icc_bypass_ceo_threshold_amount` | ₦ limit for CEO's ICC bypass |
| `document_studio_enabled` | Show/hide Document Studio for all users |
| `hr_portal_enabled` | Show/hide HR Portal for department users |
| `hr_portal_admin_enabled` | Show/hide HR Portal for the Super Admin |
| `store_records_enabled` | Enable the Store Records module |
| `heads_can_manage_subaccounts` | Let department heads manage their own sub-accounts |
| `heads_can_set_subaccount_privileges` | Let heads set privileges on their sub-accounts |
| `icc_oversight_enabled` | Global ICC observer mode |
| `oversight_departments` | JSON array of dept IDs with oversight access |
| `dept_creation_head_details_enabled` | Whether creating a department prompts for head details |
| `admin_create_fund_enabled` | Allow Super Admin to submit fund requests directly |
| `admin_create_material_enabled` | Allow Super Admin to submit material requests directly |
| `admin_create_memo_enabled` | Allow Super Admin to submit memos directly |
| `login_style` | `'standard'` or `'premium'` login page style |

**ICC gate for cash payments (how it works):** ICC review applies only to cash requests, never memos or material requests. By default ICC must clear every cash payment before Account or CEO/Chairman can disburse. The `icc_bypass_*` settings allow bypassing ICC up to a threshold — below the threshold the actor pays directly; above it ICC is still required. If both `icc_bypass_account_enabled` and `icc_bypass_account_threshold_amount` are set with a positive value, Account can pay directly for any request whose effective amount is at or below that threshold.

---

## 15. Sub-Accounts

Sub-Accounts are delegated sub-units under a Department. A department head can create sub-accounts that operate with a subset of their department's privileges.

**Permissions hierarchy:**
- Super Admin → can do anything to any sub-account
- Department Head → can manage their own department's sub-accounts (if `allowSubAccountManagement` is enabled for that department)
- Sub-account → scoped to whatever privileges are explicitly granted

**Key operations:**

| Endpoint | What |
|---|---|
| `POST /api/sub-accounts` | Create a single sub-account |
| `POST /api/sub-accounts/batch-upload` | CSV bulk-create (for large departments) |
| `PATCH /api/sub-accounts/:id` | Edit name/details |
| `PATCH /api/sub-accounts/:id/toggle` | Enable / disable |
| `PATCH /api/sub-accounts/:id/move` | Move to a different parent department |
| `DELETE /api/sub-accounts/:id` | Delete |
| `POST /api/sub-accounts/:id/reactivate` | Re-activate a deactivated sub-account |
| `POST /api/sub-accounts/:id/reset-code` | Generate a new access code |
| `PUT /api/sub-accounts/:id/privilege` | Set what this sub-account can see/do |
| `GET /api/sub-accounts/:id/users` | List users assigned to this sub-account |
| `POST/DELETE /api/sub-accounts/:id/users` | Assign / remove users |
| `GET /api/sub-accounts/:id/requisitions` | Requisitions visible to this sub-account |

**Visibility control:** `PATCH /api/requisitions/:id/sub-account-visibility` controls whether a specific requisition is visible to sub-accounts under its department. `GET /api/requisitions/:id/sub-visibility` checks that flag.

---

## 16. Additional requisition actions (beyond basic CRUD)

Beyond create/edit/delete, a requisition supports many lifecycle actions. Most require specific role/department checks server-side.

| Action | Endpoint | Who can do it |
|---|---|---|
| Forward to next stage | `POST /api/requisitions/:id/forward` | Current stage's department |
| Approve (stage-level) | `POST /api/requisitions/:id/approve` | Current approver |
| Reject | `POST /api/requisitions/:id/reject` | Current approver |
| Final approve | `POST /api/requisitions/:id/final-approve` | Final authority |
| KIV (Keep in View) | `POST /api/requisitions/:id/kiv` | Reviewer — flags for follow-up without acting |
| Un-KIV | `POST /api/requisitions/:id/un-kiv` | Same |
| Creator comment | `POST /api/requisitions/:id/creator-comment` | Originating department only |
| Forward for re-approval | `POST /api/requisitions/:id/forward-for-reapproval` | After a price revision pushes amount above authority |
| Re-approve | `POST /api/requisitions/:id/reapprove` | Higher authority receiving the re-routed item |
| Send to vetting | `POST /api/requisitions/:id/send-to-vetting` | ICC or Audit |
| Vetting action | `POST /api/requisitions/:id/vetting-action` | ICC/Audit — approve/reject/return from vetting detour |
| Audit price override | `POST /api/requisitions/:id/audit-override` | Audit department |
| Delete audit override | `DELETE /api/requisitions/:id/audit-override` | Audit department |
| ICC vet-forward | `POST /api/requisitions/:id/icc-vet-forward` | ICC — passes to another dept for vetting |
| ICC vet-return | `POST /api/requisitions/:id/icc-vet-return` | ICC — returns from vetting back to chain |
| ICC comment | `POST /api/requisitions/:id/icc-comment` | ICC |
| ICC freeze | `POST /api/requisitions/:id/icc-freeze` | ICC — stops all action on a request |
| ICC unfreeze | `POST /api/requisitions/:id/icc-unfreeze` | ICC |
| Publish memo | `POST /api/requisitions/:id/publish-memo` | For Memo subtype only |
| Add/get tags | `POST/GET /api/requisitions/:id/tag` | Any authenticated user |
| Bulk delete | `POST /api/requisitions/bulk-delete` | Admin |

---

## 17. Store Records

A separate module (distinct from Requisitions) for tracking physical store inventory movements. Used by the Store department.

- `GET /api/store-records` — list all store records
- `GET /api/store-records/carried-forward` — items carried forward from a previous period
- `GET /api/store-records/sub-accounts` — sub-account breakdown view
- `POST /api/store-records` — create a new record
- `GET/PUT/DELETE /api/store-records/:id` — read, update, or delete a single record

Store Records are separate from requisitions in both the schema and UI (they live on the Store department's own view). They are not part of the approval chain.

---

## 18. AI features

Two AI capabilities powered by OpenAI. Requires `OPENAI_API_KEY` in Railway environment.

### Voice transcription (`POST /api/ai/transcribe`)

Accepts an audio file upload (recorded in-browser via the microphone). Sends it to OpenAI Whisper → returns the transcribed text. Used on the "Create Requisition" form to let a user dictate their requisition description rather than type it.

### Draft refinement (`POST /api/ai/refine-requisition`)

Takes a raw requisition description and sends it to GPT to produce a cleaner, more professional version (corrects grammar, improves clarity, preserves the meaning). The user sees the suggestion in a diff-style view and can accept or reject it.

Both features can be **disabled system-wide** by the Super Admin via the Feature Flags toggle in System Settings (the `featureFlag.js` cache on the frontend picks this up within one page refresh — see §3).

---

## 19. System Settings — full catalog

`GET/PUT /api/system-settings/:key` — read or write any setting by key. Admin-only write. The following keys are in active use:

| Key | What it controls |
|---|---|
| `login_style` | Login page appearance — `default` or `minimal` (also served unauthenticated at `/api/public/login-style`) |
| `support_phone` | Support phone number shown on the login page and footer |
| `sms_provider` | `termii` or `twilio` — which SMS gateway to use for OTPs |
| `ai_features_enabled` | `true`/`false` — enables/disables voice transcription and AI draft refinement |
| `allow_sub_account_management` | Whether department heads can manage sub-accounts |
| `max_attachment_size_mb` | File upload limit for requisition attachments |
| `ref_pattern` | Reference number format (see §20) |
| `print_access` | Who can print requisition PDFs (see §21) |

Settings are stored in a `SystemSettings` table (key/value pairs). Fetching an unknown key returns `null` — the server never errors on a missing key, so adding new keys is safe without a migration.

---

## 20. Reference number pattern

Requisition reference numbers (e.g. `CSS/REQ/2024/001`) are configurable.

- `GET /api/settings/ref-pattern` — fetch the current pattern
- `PATCH /api/settings/ref-pattern` — update the pattern (admin only)

The pattern is a string template with tokens like `{ORG}`, `{TYPE}`, `{YEAR}`, `{SEQ}` that the server expands when a new requisition is created. If the pattern is changed mid-year, existing requisition reference numbers are NOT retroactively changed — only new ones use the new pattern.

---

## 21. Print settings and signed PDFs

### Print access control (`/api/settings/print-access`, `/api/admin/print-settings`)

The Super Admin can restrict who is allowed to print/download PDFs of requisitions. Options are typically: everyone, department heads only, admin only. The frontend checks this before showing the print button.

### Signed PDF (`/api/requisitions/:id/signed-pdf`)

Generates a PDF of the requisition that includes:
- All approval signatures (fetched from each approving department's stored signature image)
- Department stamps (if a stamp has been uploaded for that department)
- A QR verification code (links to `/api/public-verify/:code` — see §22)

### Dynamic PDF (`/api/requisitions/:id/dynamic-pdf`)

An alternative PDF renderer that builds the document from the current database state at request time (vs. a stored/cached PDF). Used when the requisition is still in-flight and signatures may change.

---

## 22. QR Code public verification

Every printed requisition PDF contains a QR code. Scanning it opens a public URL that requires no login.

- `GET /api/public-verify/:code` — unauthenticated. Given a short verification code embedded in the QR, returns the requisition's key fields (reference number, status, approvers, amounts) in a read-only view. Used by external parties (vendors, auditors) to confirm a requisition is genuine without needing a system login.
- `GET /api/verify/:code` — authenticated, admin only. Same but returns full internal detail.

The verification code is a short hash stored on the requisition at creation time. It cannot be guessed — it's cryptographically generated.

---

## 23. Department Stamps and Signatures

### Department signature (`/api/department/signature`, `/api/departments/:id/signature`)

Each department can have a signature image (PNG/JPG) stored in R2. Used to stamp the signed PDF. A department head uploads their own signature through their profile; the admin can upload or override any department's signature via the admin panel.

### Department stamp (`/api/departments/:id/stamp`)

A separate image (official rubber-stamp scan). Admin-only upload. Appears on PDFs alongside the signature for departments that have one configured.

### User signature (`/api/users/:id/signature`)

Individual user-level signatures, separate from department-level ones. Used where a specific named person's signature is required (e.g. the approver's personal sign, not just the department seal).

---

## 24. Attachments

Requisitions can have file attachments (supporting documents, quotes, invoices, etc.).

- `POST /api/requisitions/:id/attachments` — upload one or more files (multipart, multiple files allowed in one request)
- `GET /api/requisitions/:id/attachments` — list all attachments for a requisition
- `GET /api/attachments/:id/download` — download a specific attachment
- `GET /api/attachments/:id/preview` — preview in-browser (returns the file with appropriate Content-Type)
- `DELETE /api/attachments/:id` — delete an attachment

Files are stored in Cloudflare R2 (under `attachments/` prefix). The database stores the R2 object key; downloads are served by the backend via a signed or direct R2 URL depending on whether the bucket is public.

---

## 25. Soft-deleted records and recovery

Certain records (requisitions in particular) are soft-deleted (a `deletedAt` field is set) rather than permanently removed. The admin can view and recover them:

- `GET /api/admin/deleted-records` — list all soft-deleted records
- `DELETE /api/admin/deleted-records/:id` — permanently delete a soft-deleted record (no recovery after this)

Recovery (restoring a soft-deleted record to active) must be done via a direct database query — there is no "restore" button in the UI yet. To restore: set `deletedAt = NULL` on the relevant row via Railway's SQL console.

---

## 26. Audit Logs

Every significant action in the system (requisition created, forwarded, approved, rejected, department edited, user login, etc.) is written to an `AuditLog` table.

- `GET /api/audit-logs` — fetch the full audit log (admin only). Supports filters by date range, department, action type.

Displayed in the admin UI's "Audit Logs" page. This is entirely separate from the database Migration Logbook (§5 / Documentation tab) — that tracks schema changes; this tracks operational events.

---

## 27. Email and SMS — operational checks

### Email health

- `GET /api/email-status` — returns whether the SMTP connection is working (admin only)
- `POST /api/test-email` — sends a test email to a specified address (admin only). Use this to verify SMTP config after changing credentials.

Required Railway environment variables for email (Nodemailer SMTP):
```
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

### SMS balance

- `GET /api/admin/sms-balance` — queries the active SMS provider (Termii or Twilio) and returns the current credit balance. Use this to check if OTP sending will work before onboarding a large batch of departments.

Required environment variables:
```
# Termii
TERMII_API_KEY=
TERMII_SENDER_ID=

# Twilio (if sms_provider = twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

---

## 28. Complete environment variables reference

All variables required in Railway (or `.env` for local development). Variables marked **critical** will crash the server on startup if missing.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | **critical** | Railway Postgres connection string |
| `JWT_SECRET` | **critical** | Random string for signing JWTs — never change in production without force-logging out all users |
| `OPENAI_API_KEY` | optional | Required for AI transcription and draft refinement (§18) |
| `TERMII_API_KEY` | required for SMS | OTP delivery for department activation |
| `TERMII_SENDER_ID` | required for SMS | Sender name shown on SMS |
| `TWILIO_ACCOUNT_SID` | alternative SMS | Use instead of Termii if `sms_provider = twilio` |
| `TWILIO_AUTH_TOKEN` | alternative SMS | — |
| `TWILIO_PHONE_NUMBER` | alternative SMS | — |
| `SMTP_HOST` | required for email | — |
| `SMTP_PORT` | required for email | Usually `465` (SSL) or `587` (TLS) |
| `SMTP_USER` | required for email | — |
| `SMTP_PASS` | required for email | — |
| `SMTP_FROM` | required for email | The "From" address on system emails |
| `R2_ACCESS_KEY_ID` | required for files | Cloudflare R2 — see §29 |
| `R2_SECRET_ACCESS_KEY` | required for files | — |
| `R2_ACCOUNT_ID` | required for files | — |
| `R2_BUCKET_NAME` | required for files | — |
| `R2_PUBLIC_URL` | required for files | Public base URL for serving stored files |
| `VAPID_PUBLIC_KEY` | required for push | Web Push — generate with `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | required for push | — |
| `VAPID_EMAIL` | required for push | `mailto:admin@cssgrouprms.com` |
| `GOOGLE_CLIENT_ID` | required for Drive backup | Google OAuth for encrypted DB backup to Drive |
| `GOOGLE_CLIENT_SECRET` | required for Drive backup | — |
| `GOOGLE_REFRESH_TOKEN` | required for Drive backup | Long-lived token — generate once with `scripts/get-google-refresh-token.js` |
| `BACKUP_ENCRYPTION_KEY` | required for Drive backup | AES-256 key — generate once with `scripts/generate-backup-key.js`, store in a password manager |
| `NODE_ENV` | recommended | Set to `production` on Railway |
| `PORT` | set by Railway | Do not set manually — Railway injects this |

---

## 29. Hard Reset — WARNING

```
POST /api/admin/hard-reset
```

**This wipes the entire operational database.** It deletes all requisitions, departments, sub-accounts, users, workflow stages, attachments references, notifications, chat messages, and audit logs. It does **not** delete the Railway Postgres instance itself or the R2 bucket — just the data inside the application tables.

It exists for resetting a staging/demo instance back to a clean slate. It should never be run against the live production database.

There is no confirmation dialog beyond the single API call. The only recovery path is restoring from a backup (§9). Before touching this endpoint for any reason, verify you are not connected to the production `DATABASE_URL`.

---

## 30. HR Module — current status (stub)

The HR portal (Employee Directory, Leave Management, Attendance, Payroll, Recruitment Pipeline) has a full frontend UI built in `rms_frontend/src/components/` (HRDashboard.jsx, EmployeeDirectory.jsx, LeaveManagement.jsx, AttendanceTracker.jsx, PayrollOverview.jsx, RecruitmentPipeline.jsx) and all API routes are defined in `serve.js` under the `hrAuth` middleware.

**However, every HR API route currently returns an empty array or no-op response.** The backend for HR is not yet implemented — the routes exist as stubs to prevent 404 errors and to define the interface, but no data is read from or written to the database through them.

The HR module is UI-complete but backend-incomplete. Do not treat any HR data shown in the frontend as real — it is either demo/seeded data or just an empty state. Building the HR backend is a separate, clearly bounded project that has not been started.

---

## 31. Cloudflare R2 + Railway Setup Guide

> **cssgrouprms.com | RMS Project | Storage & Custom Domain Configuration**

### Part 1 — Cloudflare R2 Storage Setup

**Goal:** obtain five environment variables (`R2_ACCESS_KEY_ID`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_SECRET_ACCESS_KEY`) and add them to Railway.

#### Step 1 — Create the R2 bucket

Cloudflare Dashboard → R2 Object Storage → Create bucket. Bucket created and named **cssrms**. This name is used directly as `R2_BUCKET_NAME`.

#### Step 2 — Get the Account ID

On the R2 Overview page, the Account Details panel (bottom right) shows the Account ID with a copy icon. This value is `R2_ACCOUNT_ID`.

#### Step 3 — Create an Account API Token

R2 → Manage API Tokens → **Account API Tokens** section (chosen over "User API Tokens" because account-level tokens stay active even if a team member leaves the organisation — better suited for production).

- Clicked **Create Account API Token**
- Token name: `railway-cssrms-access`
- Permissions: **Object Read & Write**
- Specify bucket(s): Apply to specific buckets only → selected **cssrms**
- TTL: **Forever**
- Client IP filtering: left blank
- Clicked **Create API Token**

Cloudflare displayed the following values **one time only** (copied immediately):

| Variable | Source |
|---|---|
| `R2_ACCESS_KEY_ID` | Access Key ID shown after token creation |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key shown after token creation |

#### Step 4 — Note (not used): the S3 API endpoint

Found under the bucket's General settings tab:

```
https://6b7b15a3c6f5f6cc60c8b57919fc8f96.r2.cloudflarestorage.com/cssrms
```

This is the S3-compatible API endpoint used internally by SDKs. It is **not** one of the five required variables and is **not** the same as the public URL — it can be reconstructed from `R2_ACCOUNT_ID` if ever needed in code.

#### Step 5 — Enable the Public Development URL

Bucket **cssrms** → Settings → Public Development URL → clicked **Enable** → confirmed the public-access warning. Cloudflare generated a URL in the form `https://pub-xxxxxxxx.r2.dev`. This is `R2_PUBLIC_URL`.

#### Result — All five R2 variables

```
R2_ACCESS_KEY_ID=<from Step 3>
R2_ACCOUNT_ID=<from Step 2>
R2_BUCKET_NAME=cssrms
R2_PUBLIC_URL=<from Step 5>
R2_SECRET_ACCESS_KEY=<from Step 3>
```

#### Step 6 — Add variables to Railway

- Open the project in Railway → select the service
- Go to the **Variables** tab
- Use **Raw Editor** to paste all five lines at once, or add them individually
- Click **Deploy** to redeploy the service with the new variables active

---

### Part 2 — Railway Custom Domain (`rms.cssgrouprms.com`)

**Goal:** point the subdomain `rms.cssgrouprms.com` to the Railway-hosted app, verified through DNS records added at the domain registrar (Smart Web).

#### Step 1 — Request a custom domain in Railway

In the Railway service → Settings → Networking / Custom Domain → entered `rms.cssgrouprms.com`. Railway generated two DNS records that must be added at the domain's DNS provider.

| Type | Name | Value |
|---|---|---|
| CNAME | `rms` | `yz51hg3b.up.railway.app` |
| TXT | `_railway-verify.rms` | `railway-verify=53118dcce2ace7333164...` (full value from Railway) |

#### Step 2 — Add the records at Smart Web (registrar) DNS Management

`cssgrouprms.com` was purchased through Smart Web, whose client portal uses a WHMCS-style DNS Management page (Host Name / Record Type / Address / Priority). The domain's DNS is managed here rather than in Cloudflare, so records are entered directly in this panel.

**Record 1 — CNAME:**
- Host Name: `rms`
- Record Type: `CNAME`
- Address: `yz51hg3b.up.railway.app`
- Priority: left blank (N/A)

**Record 2 — TXT:**
- Host Name: `_railway-verify.rms`
- Record Type: `TXT`
- Address: full `railway-verify=...` value copied exactly from Railway
- Priority: left blank (N/A)

Click **Save Changes** in Smart Web after both records are entered. Copy the TXT value directly from Railway's popup rather than typing it — it is long and must match exactly for verification to succeed.

#### Step 3 — Wait for verification

DNS propagation can take anywhere from a few minutes to a few hours. Railway will show a green checkmark / verified status on both records once propagation completes and the domain is confirmed.

#### Notes for the future

- `cssgrouprms.com` currently manages DNS through Smart Web's own panel, **not** through Cloudflare nameservers. This is fine for the Railway custom domain (a simple CNAME/TXT add), but if a branded custom domain is later wanted for R2 storage itself (e.g. `cdn.cssgrouprms.com`) instead of the free `pub-xxxx.r2.dev` URL, the same approach applies: get the CNAME from Cloudflare's Custom Domains section and add it in Smart Web the same way.

---

## 32. CI/CD Pipeline & Branch Strategy

This section documents the complete deployment lifecycle — how code moves from a developer's machine to the live production system safely, with automated checks at every step and a manual approval gate before anything reaches clients.

---

### 32.1 Branch structure

| Branch | Purpose | Railway environment |
|---|---|---|
| `dev` | Active development, staging testing | **Staging** — a separate Railway service |
| `main` | Production-only, protected | **Production** — the live client-facing app |

**Rule:** nobody pushes directly to `main`. All work goes to `dev` first. When ready for production, open a Pull Request from `dev` → `main` on GitHub. The PR cannot be merged unless CI passes (enforced by branch protection).

---

### 32.2 The full flow, step by step

```
Developer pushes to dev
        │
        ▼
GitHub Actions — CI runs automatically
  ├── Install backend deps
  ├── Generate Prisma client
  ├── node --check serve.js  (syntax check)
  ├── npm test               (backend unit tests)
  ├── Install frontend deps
  ├── npm test               (frontend unit tests)
  └── npm run build          (full Vite production build)
        │
        ├── CI fails → ✗ deploy is blocked, fix the issue first
        │
        └── CI passes ✓
                │
                ▼
        GitHub Actions triggers Railway staging deploy hook
                │
                ▼
        Staging app is live — test everything here
        (separate Railway service, separate database, separate R2 bucket)
```

When staging looks good, open a PR `dev → main`:

```
Pull Request opened: dev → main
        │
        ▼
GitHub Actions — CI runs again on the PR
        │
        ├── CI fails → ✗ PR cannot be merged (branch protection blocks it)
        │
        └── CI passes ✓ → PR is mergeable
                │
                ▼
        Developer (or reviewer) merges the PR
                │
                ▼
        GitHub Actions — deploy-production job fires
                │
                ▼
        ⏸  MANUAL APPROVAL GATE
        GitHub sends an email: "Production deploy is waiting for approval"
        Someone with reviewer access clicks Approve in GitHub
                │
                └── Approved ✓
                        │
                        ▼
                GitHub Actions triggers Railway production deploy hook
                        │
                        ▼
                Production app is live — clients see the update
```

---

### 32.3 Workflow file

Everything above is encoded in a single file: `.github/workflows/ci.yml`.

- **`build-and-test` job** — runs on every push to `dev`/`main` and every PR to `main`. This is the gate.
- **`deploy-staging` job** — runs only on push to `dev`, only if `build-and-test` passed. Fires the Railway staging deploy hook.
- **`deploy-production` job** — runs only on push to `main` (i.e. after a PR merge), only if `build-and-test` passed. Pauses at the GitHub `production` environment for manual approval, then fires the Railway production deploy hook.

The daily database backup workflow (`.github/workflows/db-backup.yml`) runs independently of this — it targets production only, regardless of which branch was last pushed.

---

### 32.4 GitHub configuration (one-time setup)

#### Branch protection on `main`

GitHub → CssRms/RMS → Settings → Branches → Add rule → Branch name: `main`

- ✅ Require a pull request before merging
- ✅ Require status checks to pass → add **Build & Test** (appears after the first CI run)
- ✅ Do not allow bypassing the above settings

This means: no direct push to `main` is possible. The only way to get code into production is via a PR that passes CI.

#### GitHub Environments

GitHub → CssRms/RMS → Settings → Environments

Create **`staging`** — no restrictions needed (auto-deploys after CI passes on `dev`).

Create **`production`** → enable **Required reviewers** → add the project owner → Save.
This is the manual approval gate. Every production deploy will pause here and send an email. Without approval, production never deploys — even if CI is green and the PR was merged.

#### GitHub Secrets (Settings → Secrets and variables → Actions)

| Secret | Where to get it |
|---|---|
| `RAILWAY_STAGING_DEPLOY_HOOK` | Railway → staging service → Settings → Deploy Hooks → create one → copy URL |
| `RAILWAY_PRODUCTION_DEPLOY_HOOK` | Railway → production service → Settings → Deploy Hooks → create one → copy URL |
| `DATABASE_URL` | Railway production DB → Variables tab → copy the external proxy URL (`ballast.proxy.rlwy.net`) — **not** the internal `railway.internal` URL, which only works inside Railway's network |
| `R2_ACCOUNT_ID` | Cloudflare → R2 → account details |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → Manage API Tokens |
| `R2_SECRET_ACCESS_KEY` | Same — shown once at token creation |
| `R2_BUCKET_NAME` | Your production bucket name (e.g. `cssrms`) |
| `BACKUP_ENCRYPTION_KEY` | Run `node scripts/generate-backup-key.js` once — store the output in a password manager |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → your OAuth 2.0 app |
| `GOOGLE_CLIENT_SECRET` | Same |
| `GOOGLE_REFRESH_TOKEN` | Run `node scripts/get-google-refresh-token.js` once — long-lived token |
| `GOOGLE_DRIVE_FOLDER_ID` | The Google Drive folder ID where encrypted backups are stored |

---

### 32.5 Railway staging environment setup

The staging environment is a second Railway service that mirrors production but points at a separate database and a separate R2 bucket — so test data and test uploads never pollute the live system.

#### Create the staging service

Railway → your project → **New Environment** → name it `staging` → connect it to the `dev` branch.

**Disable Railway auto-deploy** on the staging service. GitHub Actions controls when staging deploys (after CI passes), not Railway's own push-triggered auto-deploy. This ensures staging never deploys broken code.

#### Staging environment variables

Set the same variables as production with these differences:

| Variable | Staging value |
|---|---|
| `DATABASE_URL` | A **separate** Railway Postgres service created for staging — not the production database |
| `R2_BUCKET_NAME` | `cssrms-staging` (a separate bucket — see §32.6) |
| `NODE_ENV` | `production` (same — staging still runs the production build) |
| All others | Same as production |

#### Get the staging deploy hook

Railway → staging service → Settings → Deploy Hooks → **Create hook** → copy the URL → add it as `RAILWAY_STAGING_DEPLOY_HOOK` in GitHub secrets (§32.4).

---

### 32.6 R2 staging bucket

File uploads in staging should go to a completely separate bucket so test files don't mix with production files.

**Create the bucket:**

Cloudflare Dashboard → R2 → Create bucket → name it `cssrms-staging`.

Use the **same API token** (`railway-cssrms-access`) — just update its bucket permissions to cover both `cssrms` and `cssrms-staging` (R2 → Manage API Tokens → edit the existing token → add `cssrms-staging` to the allowed buckets list).

Enable the public development URL on `cssrms-staging` (bucket Settings → Public Development URL → Enable) to get `R2_PUBLIC_URL` for the staging env var.

The staging Railway service then uses:
```
R2_BUCKET_NAME=cssrms-staging
R2_PUBLIC_URL=https://pub-<staging-id>.r2.dev
```
Everything else (account ID, access key, secret key) stays identical to production.

---

### 32.7 Day-to-day developer workflow

```bash
# Always work on dev
git checkout dev

# Make your changes, then push
git add <files>
git commit -m "feat: describe your change"
git push
# → CI starts automatically, staging deploys if CI passes

# Test your change on the staging URL
# If something's wrong, fix it and push again to dev — repeat

# When staging looks good, create a PR on GitHub
# GitHub: dev → main → "Create pull request"
# Wait for CI to go green on the PR
# Merge the PR

# GitHub Actions will email you: "Production deploy awaiting approval"
# Click the link → approve → production deploys
```

**Never push directly to `main`.** If you find yourself needing to, it means something is wrong with the process — investigate before bypassing.

---

### 32.8 Recovering from a broken production deploy

If a bad deploy reaches production despite the gates (e.g. a bug that tests didn't catch):

1. **Immediate rollback:** Railway → production service → Deployments tab → find the last known-good deploy → click **Redeploy**. This is the fastest path — no code change needed.
2. **Code fix:** fix the bug on `dev`, push, let it pass staging, then PR → merge → approve as normal.
3. **Database rollback (if a migration was involved):** restore from the most recent backup (§9). The backup from 02:00 UTC the same day is the starting point — you will lose any data written between the backup and the rollback. This is the worst case and should be extremely rare if migrations are tested on staging first.
