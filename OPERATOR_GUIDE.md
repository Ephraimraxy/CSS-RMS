# CSS RMS — Operator's Guide

> **Who this is for:** Anyone who needs to USE or MANAGE this system — a new Super Admin, a department head, an IT manager stepping in, or the owner returning after time away. No coding knowledge required.
>
> **How to read this:** Start with Section 1 to understand the big picture, then jump to the section that matches your role. Each section stands alone.

---

## 1. What this system is, in plain language

**CSS RMS** is the official fund and resource request platform for CSS Group. Every time a department needs money or materials, the request goes through this system instead of informal channels (WhatsApp, paper, verbal).

**Three types of requests:**

| Type | What it is | Who uses it |
|---|---|---|
| **Cash / Fund Request** | A department requests money to pay for something | Any department |
| **Material Request** | A department requests physical goods from stores | Any department |
| **Memo** | An internal document routed between departments | Any department |

**Why it exists:** Without a system like this, there is no reliable record of who approved what, when, and for how much. Money can be disbursed without proper sign-off, and there is no audit trail. CSS RMS fixes all of that — every action is logged, signed, and traceable.

---

## 2. The full lifecycle of a Cash Request (step by step)

This is the most important flow to understand. Everything else is a variation of this.

```
1. DEPARTMENT submits the request
         ↓
2. Request moves through APPROVAL STAGES
   (whoever the Super Admin configured — e.g. Head of Department → HR → GM)
         ↓
3. FINAL AUTHORITY approves
   (HR for ≤ ₦50,000 | GM for ₦50,001–₦100,000 | CEO/Chairman for above ₦100,000)
         ↓
4. AUDIT reviews and verifies the amount
   (can revise the amount up or down — their figure replaces the original)
         ↓
5. ICC (Internal Control & Compliance) vets the request
   (confirms everything is in order before payment — can be bypassed for small amounts)
         ↓
6. ACCOUNT disburses the payment
   (final step — money moves)
```

**If Audit or ICC changes the amount:**
- The system checks whether the revised amount still falls within the original approver's authority
- If it now exceeds that authority (e.g. HR approved ₦48,000 but Audit raised it to ₦55,000), the system automatically flags the request, blocks payment, and routes it to GM for re-approval
- A clear amber warning banner appears on the request showing exactly what happened and what needs to happen next

**Department Self-Approval (if enabled by Super Admin):**
- For small cash requests at or below the configured limit (e.g. ₦20,000), the system auto-approves at department level — no HR/GM/CEO sign-off needed
- The request goes straight from submission → Audit → ICC → Account
- If Audit raises the amount above the self-approval limit, the smart escalation kicks in automatically

---

## 3. Status badges — what they mean

Every request card shows a status. Here is what each one means:

| Badge / Status | Meaning |
|---|---|
| **Draft** | Saved but not yet submitted — only the creator can see it |
| **Pending** | Submitted and moving through the approval stages |
| **Approved** | Passed all approval stages, waiting for Audit/ICC/Account |
| **Dept Self-Approved** *(green)* | Auto-approved at department level — skipped HR/GM/CEO |
| **Rejected** | Rejected at some stage — check the reason in the timeline |
| **Re-Approval Required** *(amber warning)* | A price revision pushed the amount above the approver's authority — treatment is blocked until the correct authority confirms |
| **ICC Frozen** | ICC has frozen the request — no action can be taken until ICC unfreezes it |
| **Treated** | Payment made / materials issued — the request is closed |
| **Published** | For memos — the memo has been formally published |

---

## 4. Super Admin guide — setting up and managing the system

### 4.1 First-time setup checklist

If you are setting up the system for the first time or taking over from someone else, do these in order:

1. **Log in as Super Admin** using your admin credentials
2. **Go to Department Manager** → create all departments (HR, Audit, ICC, Account, GM, CEO/Chairman, and every operational department)
3. **Set department access codes** — each department logs in with a numeric code, not a password. Set these under Department Manager → the lock icon next to each department.
4. **Go to Workflow Builder** → set up the approval stages in the correct order (e.g. Head of Dept → HR → Final Approver)
5. **Configure System Settings** in Workflow Builder (see §4.2)
6. **Activate departments** — departments must activate their accounts the first time they log in (an OTP is sent to the department head's phone). Make sure each department head has the correct phone number set.

### 4.2 System Settings reference (Workflow Builder → Features tab)

These are the key toggles and amounts you can configure:

**Department Self-Approval Limit**
- Toggle ON and enter an amount (e.g. ₦20,000)
- Cash requests at or below this amount will be auto-approved by the requesting department — they skip HR/GM/CEO and go straight to Audit → ICC → Account
- Leave OFF to require all cash requests to go through the normal authority chain
- **Smart escalation:** if Audit raises the amount above this limit, the system automatically flags it for HR/GM/CEO re-approval

**ICC Vetting Requirement for Cash Payments**
- By default, ICC must review and clear every cash payment before Account can disburse
- You can set a direct-pay limit per actor:
  - **Account Department:** can pay directly (without ICC) for requests up to ₦X
  - **CEO/Chairman:** can pay directly (without ICC) for requests up to ₦X
- Leave the field blank to keep the default: ICC is always required at every amount
- ICC review never applies to Material Requests or Memos — only Cash

**Part-Payment Discount Verifier**
- When Account makes a partial payment and the remaining balance is legitimately waived (e.g. ₦5,000 transport cash was handed directly to the initiator), Account can file a **discount** instead of leaving the request permanently "pending"
- Select the department that will verify and confirm discounts before a request can close
- Workflow: Account files discount + reason → verifier dept sees a panel → clicks Accept → request closes as fully treated; or clicks Reject → Account must pay the balance or re-file
- Leave blank to disable the discount feature entirely (partial-payment requests must always be paid in full)

**Priority Escalation Alerts**
- Set a maximum waiting time (in minutes) per priority level: Critical, Urgent, Normal
- If a Cash or Material request sits at any stage without action for longer than the limit, the system automatically sends an alert to the Super Admin and any departments you select
- The alert also notifies the department currently holding the request as a reminder
- The alert repeats on the same interval until someone takes action on the request
- Leave a field blank to disable escalation for that priority level entirely
- Example setup: Critical = 30 min, Urgent = 2 hours (120 min), Normal = blank (off)

**Other important toggles:**

| Setting | What it controls |
|---|---|
| Document Studio | Turn on/off the in-browser Word/Excel/PowerPoint editor |
| HR Portal (Departments) | Let department users access the HR module |
| HR Portal (Admin) | Let Super Admin access the HR module |
| Store Records | Enable the store inventory tracking module |
| Heads Manage Sub-Accounts | Let department heads create and manage their own sub-units |
| Heads Set Privileges | Let heads control what their sub-accounts can do |
| Admin Create Fund/Material/Memo | Allow Super Admin to submit requests directly (off by default — admin usually manages, not submits) |

### 4.3 Department authority bands

These are fixed thresholds — they are NOT configurable in the interface (they are set in the code). Know them:

| Authority | Who | Cash amount they can approve |
|---|---|---|
| **HR** | HR Department | Up to ₦50,000 |
| **GM** | General Manager | ₦50,001 – ₦100,000 |
| **CEO / Chairman** | CEO or Chairman | Any amount — unlimited |

Material requests have no cash threshold — any authority tier can approve them regardless of amount.

### 4.4 Managing departments

- **Create a department:** Department Manager → the + button → fill in name, code, head name, head phone/email
- **Change an access code:** Department Manager → the lock icon next to the department
- **Security Reset (force log out all devices):** the rose-coloured key icon next to a department — use this if a department head's phone is stolen or if you suspect unauthorised access
- **Create a sub-account:** go to a department's entry → Sub-Accounts tab → Add Sub-Account. Sub-accounts are delegated units that operate under a parent department with restricted privileges.
- **Set sub-account privileges:** what types of requests a sub-account can create, and up to what amount

### 4.5 ICC (Internal Control & Compliance)

ICC is a special department with global observer powers. ICC can:
- See every request in the system regardless of routing
- Freeze any request (blocks all action until unfrozen)
- Vet/pass requests in the post-approval chain
- Override amounts after final approval (their override takes priority over Audit's)

If a request appears stuck and nobody can act on it, check whether ICC has frozen it — look for the **ICC Frozen** indicator on the request.

### 4.6 Audit

Audit reviews requests before final authority approval and can:
- Verify the amount (confirm it is correct)
- Override the amount (revise it up or down — their figure becomes the working amount)
- If the audit-revised amount pushes the request into a higher authority band, the smart escalation triggers automatically

### 4.7 Re-approval situations — what to do

**Scenario:** A request was approved by HR (₦45,000) but Audit revised it to ₦60,000. Now an amber banner says "Re-Approval Required — GM".

**What happened:** The revised amount is now in GM's band, but only HR has signed off. The system blocked treatment automatically.

**What to do:**
1. Someone with access to the request can click "Forward for Re-Approval" — this sends it to GM's queue
2. GM opens the request, reviews it, and clicks "Confirm Re-Approval"
3. Once GM confirms, Account can proceed with payment

**Scenario:** A self-approved request (₦18,000) was revised by Audit to ₦25,000, which is above the ₦20,000 self-approval limit.

**What to do:** Same process — forward for re-approval to HR (since ₦25,000 is in HR's band). HR confirms, then treatment can proceed.

---

## 5. Department Head guide — day-to-day usage

### 5.1 Creating a request

1. Log in with your department's access code
2. Click **New Requisition** (or the + button)
3. Choose the type: **Cash**, **Material**, or **Memo**
4. Fill in the title, description, amount (for cash), and any items (for material)
5. Select the department to send it to (where it goes first in the chain)
6. Click **Submit**

Your request is now in the system. You will receive notifications as it moves through each stage.

### 5.2 Tracking a request

- Go to **Requisitions** in the left sidebar
- Find your request — it shows the current status badge and which department currently holds it
- Click on the request to open the detail view
- The **Timeline** at the bottom shows every action taken in order — who did what, when, and any notes they left

### 5.3 When your request needs attention

You may receive an in-app notification or email. Common situations:

| Notification | What it means | What to do |
|---|---|---|
| Request returned | A reviewer sent it back to you | Open it, read their reason, edit if needed, resubmit |
| Request rejected | Rejected — not approved | Open it, read the reason, decide whether to resubmit with changes |
| Request approved | Approved and moving to next stage | No action needed from you — monitor the timeline |
| ICC frozen | ICC has placed a hold | Contact ICC directly to understand why |
| Re-approval required | A price revision changed the authority needed | No action from you — the system or the reviewer will forward it to the right authority |

### 5.4 Sub-Accounts (if your department uses them)

If your department has sub-units (e.g. different teams or branches under you):
- You can create sub-accounts under your department in Department Manager → Sub-Accounts
- Each sub-account gets its own login code
- You control what they can do: submit cash requests up to ₦X, submit memos, submit material requests
- Sub-account requests flow through you before going to the main chain (unless Direct Route is enabled)

---

## 6. Common situations and what to do

### "A request has been stuck for days — nobody is acting on it"

1. Open the request and check the **Timeline** — see who last had it
2. Check if there is an **ICC Frozen** or **Re-Approval Required** banner
3. If frozen: contact ICC to unfreeze
4. If re-approval required: the current holder needs to click "Forward for Re-Approval"
5. If none of the above: the department currently holding it needs to take action — log in as Super Admin and check which department it is currently assigned to

### "A department says they cannot log in"

1. Check that the department is **activated** (Department Manager → look for the activation status)
2. If not activated: the department head needs to activate using the OTP sent to their phone
3. If activated but still can't log in: the access code may have been changed — reset it in Department Manager → the lock icon
4. If they've been locked out across all devices: do a Security Reset (rose key icon) — this force-logs out all devices and the department can log in fresh

### "Account says they cannot treat a request — ICC required"

This means the ICC bypass limit is not set, or the amount exceeds the bypass threshold. Either:
- Ask ICC to vet and clear the request (normal path)
- Or Super Admin can adjust the ICC bypass limit in Workflow Builder → Features → ICC Vetting Requirement

### "An amount on a request looks wrong — different from what was submitted"

The system has a priority order for amounts:
1. **ICC override amount** (highest priority — ICC acted last)
2. **Audit override amount** (if ICC has not overridden)
3. **Original submitted amount** (if neither Audit nor ICC has overridden)

The amount shown in the payment/treatment panel always reflects this priority. If it looks wrong, check the request's Timeline for any "Audit Override" or "ICC Override" events.

### "I received a Priority Escalation Alert email/notification — what do I do?"

This means a high-priority request has been sitting at a stage without any action for longer than your configured time limit.

1. Open the notification and click the link to go directly to the request
2. Check the **Timeline** to see which department has had it longest without acting
3. Contact that department directly and tell them to take action
4. The alert will keep repeating until the department acts (approves, forwards, rejects, or returns the request)
5. If the department is unresponsive, you as Super Admin can intervene via the Requisitions admin view

**How to adjust or turn off escalation alerts:**
Go to Workflow Builder → Features → Priority Escalation Alerts → change or clear the time limit for the relevant priority level.

### "I need to delete a request that was submitted by mistake"

- Requests that are still **pending** can be recalled or deleted by the originating department
- Requests that have already been approved or are in vetting need Super Admin intervention — go to the Deleted Records Bin (admin sidebar) or contact the system administrator
- The Super Admin can bulk-delete from the Requisitions management view

---

## 7. What each major section in the app does

| App Section | What it does | Who uses it |
|---|---|---|
| **Dashboard** | Overview of all requisitions, status counts, activity feed | All users (admin sees more) |
| **Requisitions** | The main request list — create, view, act on requests | All users |
| **Document Studio** | In-browser Word/Excel/PowerPoint editor — draft memos and request content | All users (if enabled) |
| **Department Manager** | Create/edit departments and sub-accounts | Super Admin |
| **Workflow Builder** | Configure approval stages + all system-wide feature settings | Super Admin |
| **HR Portal** | Employee directory, leave, attendance, payroll, recruitment | HR dept + Super Admin |
| **ICC Oversight** | Global view of all requests, freeze/vet controls | ICC department |
| **Audit Logs** | Full audit trail of every system action | Super Admin |
| **Store Records** | Physical inventory movement tracking for the Store department | Store department |
| **Documentation** | This guide, the technical architecture guide, deploy logs, migration history | Super Admin |

---

## 8. Security — what to know

- **Access codes are not passwords.** They are numeric codes that departments use to log in. Change them regularly, especially after staff changes. Do this in Department Manager → the lock icon.
- **Security Reset = instant force-logout.** If a phone is lost or an access code is compromised, do a Security Reset immediately. Every device that department is logged into will be kicked out.
- **The Super Admin account is different.** It logs in with an email and password (not an access code). Treat this credential like a bank PIN — do not share it.
- **Every action is logged.** Every approval, rejection, override, login, and setting change is recorded in Audit Logs with a timestamp and the actor's identity. This is the trail you'd use in a dispute.
- **Ed25519 digital signatures.** Every approval action carries a cryptographic signature. This makes it impossible to alter an approval record after the fact without detection.

---

## 9. Environment and infrastructure (for the manager/IT person)

| Item | Detail |
|---|---|
| **Primary URL** | cssgrouprms.com (VPS) |
| **Railway URL** | rms.cssgrouprms.com |
| **Database** | PostgreSQL on Railway |
| **File storage** | Cloudflare R2 (attachments, signatures, stamps) |
| **Daily backups** | Automatic at 02:00 UTC — one copy to Cloudflare R2, one AES-256 encrypted copy to Google Drive |
| **Backup restore** | See admin_user_manual.md → "Database Backups & Disaster Recovery" |
| **Emergency rollback** | Railway → production service → Deployments tab → Redeploy previous version |
| **For technical changes** | A developer must read ARCHITECTURE.md first — it contains all the structural decisions, gotchas, and change procedures |

---

## 10. Who knows what — knowledge map

If something is broken or unclear, here is where to find the answer:

| Question | Where to look |
|---|---|
| How does the code work? | `ARCHITECTURE.md` (this app's Architecture Guide tab) |
| How do I manage the VPS server? | `VPS_MANAGEMENT_GUIDE.md` (VPS Management tab) |
| What database changes have been made? | Migration Logbook tab in this Documentation page |
| How do I restore the database from backup? | `admin_user_manual.md` → Database Backups section |
| How do I use the system as an admin? | This guide (you are reading it) |
| History of all feature decisions and bug fixes | Git commit history: `git log --oneline` in the repo |
| Who built this and what did they change? | Every commit has a description; every feature has a commit |

---

*Last updated: September 2026. This file lives at the repo root as `OPERATOR_GUIDE.md` and is rendered live — no cache, no build step needed.*
