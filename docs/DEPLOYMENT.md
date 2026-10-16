# Deployment Guide — Motor Health Checker

**Status: PLAN ONLY.** Nothing in this document has been carried out. The application has **not** been deployed, no
Supabase project has been created or modified, and **no migration has been applied anywhere**. Everything below that
mentions the hosted project is an instruction for you, not a result.

What *has* been verified (locally): the automated tests, the production build, the SQL migrations on an in-memory
PostgreSQL engine, and the UI in a headless browser against a local QA backend that is **not** Supabase (see `README.md`,
"Quality assurance"). What has **not** been verified: anything on hosted Supabase or on a real static host.

Provider menus, names and limits change. Where this guide names a dashboard section or a quota, treat it as a pointer and
confirm in the provider's current documentation. Provider facts below were looked up on 2026-10-15 and are labelled as such.

---

## 0. Summary of the plan

| Stage | Where | Who |
|---|---|---|
| A. Rehearse on a *staging* Supabase project (recommended) | Supabase | you |
| B. Create the production Supabase project, apply migrations 001–013, create the user, disable sign-ups | Supabase | you |
| C. Verify the database (SQL smoke script + browser) | Supabase / browser | you |
| D. Build with production variables, run the pre-deployment check | your machine | you |
| E. Host the static frontend | Cloudflare Pages (recommended) | you |
| F. Post-deployment smoke test, then enter real reference data | browser | you |

The architecture is a static single-page app that talks directly to Supabase. There is no server to deploy.

---

## 1. Hosting recommendation

**Recommended: Cloudflare Pages (free plan).** Alternatives: Netlify, Vercel.

| | Cloudflare Pages | Netlify | Vercel |
|---|---|---|---|
| Fits a static Vite SPA | Yes | Yes | Yes |
| SPA deep-link fallback | Served automatically when the project has no top-level `404.html` (confirm in Cloudflare's docs and by testing, §4) | Needs one `_redirects` line (§4) | Needs `vercel.json` (included) |
| Response headers | `public/_headers` (included) | same file format | `vercel.json` (included) |
| Free-plan terms for workplace use | Not restricted to non-commercial use as far as the sources reviewed show; verify | Verify | **Hobby plan is for personal, non-commercial use** per Vercel's docs; a tool used for paid work may need a paid plan |
| Notes | Limits: see §9 | | The project docs (`TECH_STACK.md`) named Vercel as an example, not a requirement |

Why Cloudflare Pages first: the app is likely to be used for maintenance work at an organisation, which makes Vercel's
non-commercial Hobby restriction a real risk, and Cloudflare's static hosting needs no routing config. If you are certain this
is a personal, non-commercial project, Vercel Hobby is fine and `vercel.json` is already provided. Trade-offs to accept with any
of them: build-time environment variables (§3), a free tier whose terms can change, and no server-side protection layer
(data protection is entirely Supabase RLS, which is by design).

Decision needed from you: **which host**, and **whether the project may live in a public or private Git repository**.

---

## 2. Supabase setup

> Do this for a **staging** project first if you can: the free plan allows two active projects (§9). Rehearsing the
> migrations and the smoke tests on staging means production gets a procedure you have already seen succeed.

### 2.1 Create the project
1. Sign in at <https://supabase.com/dashboard> and create a project. Choose a region close to your users.
2. Set a strong database password and store it in a password manager. The app never needs it; you will need it only for
   backups (§8) and direct database access.
3. Note the **Project URL** (`https://<ref>.supabase.co`) and the **publishable key** (new projects) or **anon key** (legacy).
   Both are public by design. Do **not** copy the `service_role` / secret key anywhere.

### 2.2 Apply migrations 001–013 (in order, once each)
Open *SQL Editor → New query*. For each file in `database/migrations/`, in this exact order, paste the whole file and run it.
**Wait for "Success" before the next one.**

| # | File | Tick when applied |
|---|---|---|
| 001 | `001_create_motors.sql` | ☐ |
| 002 | `002_create_parameter_definitions.sql` | ☐ |
| 003 | `003_create_reference_profiles.sql` | ☐ |
| 004 | `004_create_reference_limits.sql` | ☐ |
| 005 | `005_create_test_sessions.sql` | ☐ |
| 006 | `006_create_test_readings.sql` | ☐ |
| 007 | `007_create_diagnostic_results.sql` | ☐ |
| 008 | `008_create_diagnostic_findings.sql` | ☐ |
| 009 | `009_rls_policies_and_grants.sql` | ☐ |
| 010 | `010_enforce_submitted_session_immutability.sql` | ☐ |
| 011 | `011_create_save_diagnostic_assessment.sql` | ☐ |
| 012 | `012_harden_functions.sql` | ☐ |
| 013 | `013_add_motor_supply_type.sql` (additive nullable column; apply **before** deploying the frontend version that sends `supply_type`) | ☐ |

Rules:
- The migrations are **not idempotent**. Never run one twice. There is no migration ledger table; **your tick list above is
  the ledger**. Keep a copy with dates.
- If a migration fails: **stop**. Do not retry. Follow §8.2.
- The files contain no credentials and no reference data. `parameter_definitions` receives its 7 catalogue rows (names, units,
  descriptions; **no limits**) from migration 002.
- Take a backup before each migration on production (§8.3).

### 2.3 Create the authorized user
*Authentication → Users → Add user → Create new user*: enter an email and a strong, unique password and enable auto-confirm.
Copy the user's **UID** (needed for the smoke script). This is the only account that can use the app.

### 2.4 Disable public sign-ups
In the Authentication settings (*Sign In / Providers*, or *Settings* — wording varies) turn **off** the option that allows new
users to sign up. Leave email sign-in enabled so your user can sign in. Also set the **Site URL** to your final app URL (the
app sends no auth emails, but this avoids a wrong default) and avoid wildcard redirect URLs.

Verify (§6.4, step 3): a sign-up request must be refused. The app itself has no sign-up page and never calls `signUp`, but the
Auth API is reachable without the UI, so the dashboard setting is the real control.

### 2.5 Verify RLS and the database
- *Table Editor*: all eight tables show **RLS enabled**; `parameter_definitions` has 7 rows; the other tables are empty.
- Run `database/verify/hosted_smoke.sql` (§5.2). Every row of its report must read `passed = true`.

### 2.6 Things not to change
Leave the Data API exposing only the `public` schema (default). Do not disable RLS, add `using (true)` policies, or grant table
privileges to `anon` to "make something work": the app needs none of that.

---

## 3. Environment variables

The app reads exactly two variables:

| Variable | Value | Public? |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | yes |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key (or legacy **anon** key) | yes |

The variable keeps the `ANON` name for historical reasons; either public key type works with the same client call.

**Rules**
- Never put a `service_role` key or a `sb_secret_…` key in any `VITE_` variable. Everything with that prefix is compiled into
  the JavaScript that every visitor downloads. The real data boundary is RLS, not the key.
- **Vite inlines these values at build time.** Changing a variable on the host has no effect until the site is **rebuilt**.
  A build made without them shows "Supabase is not configured".
- `.env` and `.env.*` are git-ignored; `.env.example` (placeholders only) is committed.

**Local development:** `copy .env.example .env`, fill in the two values, `npm run dev`.

**Production:** set the two variables in the host's project settings *before* the first build (or build locally with them set,
§4). Use the staging project's values for preview/staging builds and the production project's values for production only.

If a secret key is ever exposed: rotate it in the Supabase dashboard immediately, remove it from wherever it leaked, rebuild and
redeploy, and review recent activity. Rotating the publishable/anon key is rarely needed but follows the same rebuild rule.

---

## 4. Build and routing

```bash
npm ci                      # exact, locked install (use `npm install` only when changing dependencies)
npm test                    # unit, component and database tests
npm run build               # type-check (tsc -b) + production build into dist/
```

Node: Vite 8 requires `^20.19.0 || >=22.12.0`. Development used Node 24. Set a matching version on the host (e.g. a current
LTS) — the setting is usually a `NODE_VERSION` environment variable or a `.node-version` file; check your host's docs.

Host settings: **build command** `npm run build`, **output directory** `dist`, base path `/` (the app must be served from the
domain root; a sub-path would need code changes).

**Two ways to publish**
1. *Git-connected:* the host builds from your repository. **This project is not yet a Git repository** (`git init`, review
   `git status`, make sure no `.env` is staged, then push to your repository). Set the two `VITE_` variables on the host first.
2. *Direct upload of a local build:* build locally with the production variables, run the pre-deployment check, and upload `dist/`.
   This keeps the build you verified byte-for-byte.

**Single-page-app routing (direct links such as `/tests/<id>/assessments/2` and page refreshes)**
- Cloudflare Pages: serves `index.html` for unknown paths when the project has no top-level `404.html`. Verify after deploying.
- Vercel: `vercel.json` (included) rewrites everything to `/index.html`; static files are still served first.
- Netlify: add `public/_redirects` containing `/*  /index.html  200` (not included, to avoid an unneeded file on other hosts).
- Test direct links after the first deploy (§7 step 9). Static assets must return their real files, not `index.html`.

**Headers:** `public/_headers` (Cloudflare/Netlify) and `vercel.json` set `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` and long caching for hashed assets. They have not been tested on any host.

**Optional: Content-Security-Policy.** Not enabled by default because it must name your project. After the first successful
deployment, try it as **report-only** first and watch the browser console:

```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self' https://<ref>.supabase.co;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
Enforce it only after confirming nothing is blocked (sign-in, data loading, the chart). This template is untested.

---

## 5. Pre-deployment checks (on your machine, before anything is published)

### 5.1 Automated
| Check | Command | Expect |
|---|---|---|
| Tests | `npm test` | all pass (includes the database tests on in-memory PostgreSQL) |
| Type-check + build | `npm run build` | succeeds |
| Dependencies | `npm audit` | no known vulnerabilities (last run: 0) |
| Environment + build scan | build with the **production** variables set, then `npm run predeploy:check` | no `FAIL` lines |
| No secrets in the repo | before the first commit and before each release: search for `service_role`, `sb_secret_`, long `eyJ…` strings and any `.env*` file other than `.env.example` | nothing real found |

`predeploy:check` (script: `scripts/predeploy-check.mjs`) validates the two variables (URL is `https://…`, not local, not a
placeholder; key is a **public** key — a secret/service-role key is a hard failure), then scans `dist/` for secret-shaped keys and
for leftovers of the local QA backend, and confirms the build embeds your project host (i.e. it was built with the right variables).
It prints **no** secret values. It cannot see your Supabase project.

PowerShell example (values are placeholders):
```powershell
$env:VITE_SUPABASE_URL = 'https://<ref>.supabase.co'
$env:VITE_SUPABASE_ANON_KEY = '<publishable-or-anon-key>'
npm run build
npm run predeploy:check
```

### 5.2 Hosted integration checks (need the hosted project; none have been run)
1. **SQL smoke script.** In the SQL Editor open `database/verify/hosted_smoke.sql`, replace `PUT-YOUR-USER-UUID-HERE` (the
   user's UID) and run it. It runs inside a transaction that ends with `ROLLBACK`, creates **no** reference data and leaves no
   rows. Expected: **28 rows, all `passed = true`**, covering: anon cannot read or call anything; a signed-in user cannot
   create data for another owner, cannot create non-draft sessions, cannot submit an empty test; a submitted test and its
   readings cannot be edited, reverted or deleted; assessment results/findings cannot be edited or deleted; a failed assessment
   leaves no partial data; trigger functions are not callable; RLS and policies exist on every table; every function has a fixed
   `search_path`; only the assessment function is executable by API roles. If the editor rejects transaction control, skip it and
   rely on §5.2 steps 2–3 and the browser checks. If it errors part-way run `rollback;` first. A passing local run is not a hosted result.
2. **Second account (recommended).** Create a second user temporarily, sign in as it and confirm it sees no motors, tests or
   assessments of the first, and that opening the first user's record URLs shows "not found". Delete the second user afterwards.
3. **Browser run** on staging: the post-deployment smoke test (§7) against the staging URL.

---

## 6. Security checklist

Tick each item **on the hosted project**. "Local evidence" means it is covered by automated tests on in-memory PostgreSQL only.

| # | Item | How to verify on the hosted project | Local evidence |
|---|---|---|---|
| 1 | Only the authorized user can sign in | Dashboard shows exactly one user; sign-in with a wrong password fails | UI tests |
| 2 | **Public sign-ups are disabled** | §6.4 step 3 | none possible locally |
| 3 | No sign-up page or call in the app | Open `/signin`: no register link | UI test |
| 4 | RLS enabled on all 8 tables with policies | Table Editor + smoke script | database tests |
| 5 | `anon` has no table access and cannot call the assessment function | smoke script | database tests |
| 6 | Ownership isolation (parent and child rows) | smoke script + second-account test | database tests |
| 7 | Submitted tests and their readings are immutable, also via API | smoke script | database tests, browser QA |
| 8 | Assessment results/findings are append-only; reassessment adds a revision | smoke script; reassess in the app | database tests, browser QA |
| 9 | Assessment persistence is atomic (no partial results) | smoke script ("bad finding" and "no partial data" rows) | database tests |
| 10 | Approved reference profiles and their limits cannot be edited | browser: approved profile offers no edit | database tests, browser QA |
| 11 | Functions hardened (fixed `search_path`; trigger functions not callable) | smoke script; Supabase's *Advisors/Linter* page should not report mutable search paths for these functions | database tests |
| 12 | Only public keys in the build; no secret key anywhere | `predeploy:check`; repository search | script tests |
| 13 | Error messages do not leak internals | Provoke a failure (e.g. duplicate motor tag): message is plain language | unit tests |
| 14 | Security headers present | `curl -I https://<your-app>/` shows the headers from §4 | none |
| 15 | HTTPS only | the host enforces HTTPS; the Supabase URL is `https://` | script check |
| 16 | Dependencies | `npm audit` clean | run 2026-10-15: 0 vulnerabilities |

### 6.4 Sign-up refusal check (step 3 of §2.4)
Send a sign-up request to the Auth API with a **throw-away address** and expect a refusal ("signups not allowed" or similar —
the exact text varies):
```bash
curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" \
  -H "apikey: <publishable-or-anon-key>" -H "content-type: application/json" \
  -d '{"email":"signup-check-delete-me@example.invalid","password":"Throwaway-Check-123"}'
```
If it **succeeds**, sign-ups are still enabled: delete that user in the dashboard, fix the setting and repeat. (The `.invalid`
domain cannot receive mail.)

---

## 7. Post-deployment smoke tests (on the deployed URL)

Use the real deployed URL, the authorized user, and a **real** reference source for step 6. Do not invent limits to make a test pass.
Open the browser developer console and the network tab during the run.

1. **Protected routes:** while signed out, open `/`, `/motors`, `/tests/new`, `/reference`, `/history`: each shows the sign-in page.
2. **Sign-in:** wrong password → "Invalid email or password."; correct credentials → Dashboard (empty state, no fake numbers).
3. **Session restore:** refresh the page → still signed in. Close and reopen the tab → still signed in.
4. **Motor CRUD:** register a motor (leave optional fields blank); it appears in the list; search finds it; edit and save; the
   details page shows the change; registering the same tag again is refused with a clear message.
5. **Reference data (real source):** create a draft profile with its source, add limits **from that source**, review, approve. Confirm
   the approved profile offers no edit and *Create new version…* is available.
6. **Manual test:** *New test* for the motor; enter a malformed value (rejected), then valid values; save as draft; reload (draft
   restored); review; submit. The submitted test is read-only.
7. **Assessment:** *Run assessment*. The result shows status, the profile and version used, rule version, each finding with value
   and boundary. A result with unmeasured parameters shows the "Incomplete assessment" note.
8. **Reassessment history:** *Run reassessment*; revision 2 appears; open revision 1 from "Earlier revisions"; it is labelled as an
   earlier revision and still shows its original values.
9. **Navigation and direct links:** dashboard → recent assessment → test → motor; then paste each of `/motors/<id>`,
   `/tests/<id>`, `/tests/<id>/assessments/1` into a fresh tab and refresh: all load (no 404 from the host).
10. **Trends:** with at least three submitted tests of the same parameter, unit, method and location, the motor page shows a chart;
    the chart script is requested only on that page.
11. **Sign-out:** *Sign out* returns to sign-in; browser Back does not show private data; protected URLs redirect again.
12. **Console and network:** no console errors; requests go only to the app's own origin and your Supabase host; response headers include §4's.

Record the date, the deployed URL, the commit/build identifier and the result of each step.

---

## 8. Rollback and recovery

### 8.1 Frontend rollback
The frontend is stateless. Redeploy a previous successful deployment from the host's deployment list (or redeploy the previous
build output). Environment variables are baked in at build time, so rolling back a *configuration* change means **rebuilding**
with the old values. A frontend rollback never touches the database. Check §7 steps 1–3 afterwards.

If a deployed build is wrong for a security reason (e.g. a secret key was embedded), take the site offline or roll back first,
**then** rotate the key (§3).

### 8.2 Database: failure while applying migrations
Migrations are forward-only; there are no "down" scripts, and they are not idempotent.
1. **Stop** at the first error. Do not run the same file again, and do not skip ahead.
2. Copy the full error text. Check what the failed migration already created (for example list tables, triggers and functions with
   the queries in `hosted_smoke.sql`'s catalog checks or in the Table Editor). The SQL Editor may run a script in one transaction,
   in which case nothing persisted — confirm, don't assume.
3. If nothing from that file exists, fix the cause (usually a missing earlier migration or a typo from copy-paste) and run the file once.
4. If part of it exists, **do not re-run it**. Either restore the pre-migration backup (§8.3) into a fresh project, or write a new,
   reviewed corrective migration (`013_…sql`) that moves the database to the intended state. Test that on staging first.
5. Update your tick list with what really happened.

### 8.3 Backups and restoring
The Supabase **free plan does not include automatic backups** (checked 2026-10-15; confirm on the current pricing page), so make
your own **before every production migration and regularly afterwards**. With a PostgreSQL client installed, using the connection string from the
dashboard (*Connect*; it contains the database password — keep it secret):
```bash
pg_dump "<connection-string>" --schema=public --no-owner --no-privileges -Fc -f backup-YYYY-MM-DD.dump
```
Store backups securely and test a restore into a **separate** (staging) project: `pg_restore --no-owner -d "<staging-connection-string>" backup-….dump`.
A backup contains real maintenance data. A restore needs the `auth.users` rows to exist (ownership columns reference users), so
recreate the same user, or restore into a project where that user already exists with the same id; verify before relying on it.
The Supabase CLI's `supabase db dump` is an alternative. Both are untested here.

### 8.4 What never to do
- Never re-run a migration "to see if it works".
- Never delete production rows to "fix" a problem. The app is built so history cannot be rewritten: results, findings and submitted
  tests are append-only. A wrong assessment is corrected by a **reassessment** (a new revision); a wrong reference profile by a **new
  version**. Direct deletion with administrator SQL bypasses that protection and needs your explicit, documented decision.
- Never disable RLS, drop a policy, or grant privileges to `anon` as a shortcut.
- Never paste a service-role/secret key into the frontend, a chat, or a ticket.

### 8.5 Other recovery cases
- **Project paused (inactivity on the free plan):** the app shows connection errors. Restore the project from the dashboard; data is
  kept. Plan a periodic visit or accept the pause (§9).
- **Locked out / lost password:** reset the user's password in *Authentication → Users*.
- **Compromised credentials:** change the user password, rotate keys (§3), review the user list, sign out all sessions from the dashboard if available.

---

## 9. Free-tier limitations (verify before relying on them)

Figures were gathered on **2026-10-15** from provider pages and third-party summaries. Providers change plans and terms; none of
this is a promise.

**Supabase (free plan)**
- Database size about 500 MB per project; two active projects per account; projects are **paused after about one week of
  inactivity** and must be restored manually.
- **No automatic backups or point-in-time recovery** on the free plan (paid plans keep daily backups for a limited period).
- Monthly active users, storage and egress quotas exist (reported around 50,000 MAU, 1 GB storage, 5 GB egress). This app has one
  user and stores no files; egress is small. Rate limits apply to the Auth and Data APIs.
- Legacy `anon`/`service_role` keys are being replaced by publishable/secret keys; Supabase has said the legacy keys will be
  deprecated, so plan to move to the publishable key when convenient.

**Cloudflare Pages (free)** — reported: about 500 builds per month, builds time out after 20 minutes, up to 20,000 files per site,
25 MiB per file, 100 projects.
**Vercel Hobby** — personal, non-commercial use only (per Vercel's documentation); fair-use limits apply.
**Netlify (free)** — has its own build-minute and bandwidth quotas; check them.

**Application limits (by design, documented in the README):** each list loads at most 1000 rows per kind and shows a "Partial data"
warning beyond that; trends use the 100 most recent submitted tests per motor; there is no pagination yet; one reading per
parameter per test (no per-phase or multi-point data).

Estimated data volume is tiny (text and numbers), so database size is not a near-term concern; **inactivity pausing and the lack of
backups are the operational risks.**

---

## 10. Go-live checklist (ordered; every step needs your action or approval)

Nothing below will be done by the assistant without your explicit approval.

1. ☐ **Decide the host** (recommended: Cloudflare Pages) and whether the repository will be public or private.
2. ☐ **Initialise Git** and make the first commit **only after** checking `git status` shows no `.env` file. Push to your repository (approval to publish code).
3. ☐ **Create the staging Supabase project** (approval for creating a cloud resource). Apply 001–013, create a test user, disable sign-ups, run `hosted_smoke.sql` (expect 28/28), run the §7 smoke test against a staging build.
4. ☐ **Create the production Supabase project** (approval). Record the Project URL and publishable/anon key.
5. ☐ **Take a baseline backup plan**: decide where backups are stored and how often (§8.3).
6. ☐ **Apply migrations 001–013 to production, one at a time**, ticking the table in §2.2 (approval for the remote database action).
7. ☐ **Create the production user** (§2.3) and **disable public sign-ups** (§2.4); run the sign-up refusal check (§6.4).
8. ☐ **Run `hosted_smoke.sql` on production** (28/28). Confirm RLS enabled on all tables. Optionally run the second-account test (§5.2).
9. ☐ **Set the two `VITE_` variables** on the host (production values only), or build locally with them.
10. ☐ **Build and run `npm test`, `npm run build`, `npm run predeploy:check`** — no `FAIL`.
11. ☐ **Deploy** to the host (approval to publish). Set the Supabase *Site URL* to the deployed URL.
12. ☐ **Run the §7 post-deployment smoke test** on the live URL; check headers (§6 item 14) and direct links.
13. ☐ **Enter real reference data** from verified sources, have it reviewed, then approve profiles. Until then every assessment is "Insufficient data" by design.
14. ☐ **Optionally add the Content-Security-Policy** in report-only mode (§4), then enforce.
15. ☐ **Schedule recurring tasks:** backups, a periodic visit to prevent inactivity pausing, `npm audit`, and a review of provider limits.
16. ☐ **Record** the deployment (date, URL, build id, results) and keep this checklist with the tick marks.

Stop and ask before: applying any migration to a remote project, creating any cloud resource, publishing code or the site,
changing production auth settings, or deleting any data.
