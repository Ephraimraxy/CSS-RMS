# CSS RMS — Production Change Protocol

This document is the mandatory engineering protocol for every change made to this repository.
The system is live with real users. Every edit carries production risk.

---

## Why this document exists

Two incidents in one session:

1. A filter intended only for the onboarding form was accidentally applied to the login dropdown,
   blocking Super Admin login for all users.
2. The fix that followed introduced `useEffect` hooks referencing `activeTab` before its `const`
   declaration — a JavaScript TDZ crash that broke the Departments page on every mount.

Both were pushed directly to production and discovered by users.
This protocol exists to prevent that pattern.

---

## Step 1 — Investigate before editing

Before changing any code:

- Identify the file/component that owns the change
- Find every consumer of that file, component, helper, hook, or shared CSS class
- Determine if the scope is local (one screen) or shared (multiple screens)
- Map all connected: state, props, hooks, context, APIs, routes, permissions, DB logic
- Ask: does this affect different user roles? Mobile? Production data? Authentication?

**Never apply a global change for a locally-scoped requirement.**

---

## Step 2 — Define the change boundary (before editing)

Write this down before touching code:

| Field | Detail |
|---|---|
| CHANGE | What exactly must change |
| MUST REMAIN UNCHANGED | Existing behaviour that must keep working |
| AFFECTED FILES | Expected to change |
| POTENTIALLY AFFECTED | Shared dependencies that could regress |
| OUT OF SCOPE | Must not be touched |

---

## Step 3 — Correct workflow order

```
Inspect → Understand → Design → Edit → Validate → Diff → Build → Test → Commit → Deploy → Verify
```

The commit is the LAST step before deployment, not the first validation point.
Do not use: Edit → Commit → Push → Discover problem → Patch → Push.

---

## Step 4 — Static checks after every edit

- Syntax errors, undefined variables, duplicate declarations
- Variables or state referenced before declaration (JavaScript TDZ)
- Hook ordering — state must be declared BEFORE any hook that uses it
- No conditional hooks
- Dependency arrays must reference only safely-declared identifiers
- No broken JSX, no missing imports, no incorrect imports
- No debug or test code left in production files

### React-specific rule

```js
// WRONG — TDZ crash on every render
useEffect(() => { ... }, [activeTab]);
const [activeTab, setActiveTab] = useState('departments');

// CORRECT — declaration before hook
const [activeTab, setActiveTab] = useState('departments');
useEffect(() => { ... }, [activeTab]);
```

**ALL state used by a hook must be declared before that hook.**

---

## Step 5 — Run the build before pushing

```bash
cd rms_frontend
npm run build
```

If the build fails → STOP. Fix the failure. Rebuild. Then push.

Do not say "build should be fine." Run it.

---

## Step 6 — Check `git diff` before committing

```bash
git diff
```

Confirm:
- Only intended files changed
- Only intended lines changed
- No accidental deletions or formatting changes
- No broad filter applied that affects more than the scoped area
- No unrelated refactoring
- No debug code

If more files changed than expected → investigate before committing.

---

## Step 7 — Test the specific change AND regression areas

After implementing:

1. Test the exact requested scenario — does the feature work?
2. Test the most important adjacent functionality — did anything else break?
3. Open the browser console — confirm no runtime errors, no failed API calls
4. Test all affected user roles (Super Admin, department users, sub-accounts)
5. Test affected pages (not just the changed page)

---

## Step 8 — Verify production after deployment

Railway saying "deployed" only proves the deploy process completed.
It does NOT prove the application works.

After deployment:
1. Open the application
2. Test the changed functionality
3. Test adjacent pages and user roles
4. Check the browser console for runtime errors
5. Check the network tab for unexpected 4xx/5xx responses

---

## Step 9 — Reporting format

Never say a task is "done" without evidence. Report:

```
IMPLEMENTED:       [what changed and where]
BUILD:             PASS / FAIL
HOOK ORDER CHECK:  PASS / FAIL
DIFF REVIEWED:     YES / NO
TESTED:            [routes and scenarios tested]
REGRESSION CHECK:  [what adjacent functionality was verified]
GIT COMMIT:        [hash]
PRODUCTION:        [verified / not yet verified + what was checked]
```

If something could not be tested, say so explicitly.

---

## Step 10 — Security rule

Frontend visibility is not authorization.

If a role or permission changes in the UI, the backend must independently validate it.
Hiding a dropdown option does not prevent a malicious client from submitting that value.

Whenever role, permission, or authentication logic changes:
- Check what users can see/select (frontend)
- Check what the server actually permits (backend)
- These must stay in sync

---

## Step 11 — Small, focused commits

One logical change per commit. Never bundle unrelated fixes.

```
Good:
  commit A — fix onboarding role filter
  commit B — fix Departments TDZ crash

Bad:
  commit A — fix onboarding, patch Departments, refactor auth, update styling
```

This makes rollback safe and debugging fast.

---

## Step 12 — Never refactor unrelated code during a fix

If the request is to fix one thing, fix only that thing.
Do not reorganize, rename, or clean up anything outside the change boundary
unless the investigation proves it is required.

Every additional change adds regression risk.

---

## Deployment context

This project has **no staging environment**.
Production and development share the same Railway deployment path.

Compensation: stricter pre-push validation — always run the build, always run the diff review,
always test before every push to `git push cssrms main`.

---

## The most important rule

**The application already works.**

The default assumption for every change is:

> Do not break existing functionality.

Optimize for: Correctness + Backward compatibility + Security + Regression prevention + Verifiable deployment.

Not for: Making the requested code change as quickly as possible.
