# Demo Data — what it is, how to load it, how to remove it

**Status: prepared, NOT executed.** Nothing here has been run against your hosted Supabase project. The scripts were tested
only on an in-memory PostgreSQL engine running migrations 001–012 (`database/tests/demo-seed.test.ts`, 20 tests).

## 1. Audit result: there was no existing mock data

The repository was searched for mock data, fixtures, seeds, sample arrays, hardcoded statistics and chart data.

- **No seed, fixture, CSV or JSON data files exist.** Nothing was ever generated as demo data for the app.
- **No screen contains hardcoded data.** Every page reads from Supabase through TanStack Query hooks (see §8).
- Synthetic values exist only in (a) automated tests, which build their own in-memory fixtures, and (b) the browser QA scripts
  in `qa/`, which created records at run time inside a throw-away in-memory database that is gone.

So the demo set below is **new**, created for this request. It is small, clearly labelled, and deliberately contains no
reference data and no assessments.

## 2. What the seed creates

All records are owned by **your** Auth user. Fixed ids make the script idempotent: motors `dede0001-…`, sessions `dede0002-…`.

### Motors (table `motors`) — 4 rows
| Tag | Name | Type | Notes |
|---|---|---|---|
| DEMO-M-001 | DEMO — Cooling water pump motor | induction | 5 tests (4 submitted + 1 draft) → trend chart |
| DEMO-M-002 | DEMO — Ventilation fan motor | induction | 2 tests (1 submitted + 1 draft) |
| DEMO-M-003 | DEMO — Conveyor drive motor | synchronous | 1 submitted test with only 2 parameters |
| DEMO-M-004 | DEMO — Spare motor (no tests) | induction | no tests → shows "No assessment recorded" |

Nameplate values are round, made-up numbers (e.g. 400 V, 5.5 kW). Manufacturer is "Demo Manufacturer (fictitious)".
Every motor note starts "DEMONSTRATION DATA".

### Test sessions (table `test_sessions`) — 8 rows, each owned by one motor
| # | Motor | Age | Final status | Readings |
|---|---|---|---|---|
| 1 | DEMO-M-001 | 28 days | submitted* | voltage, current, temperature, vibration, speed |
| 2 | DEMO-M-001 | 21 days | submitted* | same five; voltage entered as 0.401 kV (stored as 401 V) |
| 3 | DEMO-M-001 | 14 days | submitted* | same five; temperature entered as 140 °F (stored as 60 °C) |
| 4 | DEMO-M-001 | 7 days | submitted* | voltage, current, temperature, speed (no vibration) |
| 5 | DEMO-M-001 | 1 day | **draft** | voltage only |
| 6 | DEMO-M-002 | 10 days | submitted* | voltage, current, temperature, vibration |
| 7 | DEMO-M-002 | 2 days | **draft** | current only |
| 8 | DEMO-M-003 | 5 days | submitted* | voltage, temperature |

\* only when `v_submit_demo_tests = true` (the default); with `false` all eight stay drafts.
Method is "DEMO — not a real instrument"; notes and operating conditions say "DEMONSTRATION DATA".
Dates are relative to the moment you run the script.

### Readings (table `test_readings`) — 27 rows
5 + 5 + 5 + 4 + 1 + 4 + 1 + 2 per session, in the order above. The original value and unit are kept, with the normalized value
in the canonical unit. All values are invented.

### Deliberately NOT created
- **`reference_profiles` / `reference_limits`:** no profiles, no limits. Approved reference data must come from real sources.
- **`diagnostic_results` / `diagnostic_findings`:** no assessments. Submitted demo tests show **"awaiting assessment"**; no motor
  is labelled normal, warning or faulty.
- **`parameter_definitions`:** already created by migration 002; the seed only checks the 7 rows exist and never changes them.
- No database columns, no policy or trigger changes.

## 3. Before you run it: the two things to edit

Open `database/seed_demo_data.sql` and edit the two lines marked `>>> EDIT <<<` at the top of the `DO` block:

1. **`v_user_id_text`** — replace `PUT-YOUR-AUTH-USER-UUID-HERE` with your Auth user id:
   Supabase dashboard → **Authentication → Users** → click your user → copy **User UID** (a uuid such as `3f2b…`). Do not invent
   one: the script stops with a clear message if the id is not an uuid or no such Auth user exists.
2. **`v_submit_demo_tests`** — read the warning in §6, then keep `true` or set `false`.

## 4. How to run it (Supabase SQL Editor)

1. Make sure migrations 001–012 are applied (the script checks `parameter_definitions` and stops if it is incomplete).
2. SQL Editor → **New query** → paste the whole edited `seed_demo_data.sql` → **Run**. Expect "Success. No rows returned"
   (a notice with the counts appears only if your editor shows notices).
3. Verify with `database/verify_demo_data.sql` (§5). Reload the app.
4. Re-running is safe: nothing changes. If anything fails, nothing is created (the whole script is one transaction).

The SQL Editor runs as an administrator role, which bypasses row-level security. The script does **not** disable or change any
policy or trigger; it stamps each row with your user id so the signed-in app sees it through the normal policies.

## 5. Verification (`database/verify_demo_data.sql`, read-only)

The editor shows only the last result, so run the numbered queries one at a time. Expected values for a full seed:

| Query | Table(s) | Expect |
|---|---|---|
| 1 | `parameter_definitions` | 7 rows (not created by the seed) |
| 2 | `motors` | 4 rows DEMO-M-001 … 004, notes start "DEMONSTRATION DATA" |
| 3 | `test_sessions` | 8 rows: 6 submitted + 2 draft |
| 4 | `test_readings` | 27 rows in total, grouped per test |
| 5 | `reference_profiles`, `reference_limits` | 0 and 0 demo rows |
| 6 | `diagnostic_results`, `diagnostic_findings` | 0 and 0 |
| 7 | integrity | one owner for all demo rows; no demo id without a DEMO tag |
| 8 | visibility to **you** through RLS | motors 4, sessions 8, readings 27 (needs your user id in one line) |

## 6. Cleanup, and why it is only partly possible

`database/cleanup_demo_data.sql` (edit the same `>>> EDIT <<<` line) removes demo records that can be removed **without breaking
history rules**: demo **draft** tests and their readings, then demo motors that have no tests left. It matches by the fixed demo
ids **and** your user id, never touches real data, never disables a trigger, and is safe to repeat.

**It cannot remove submitted demo tests.** Submitted tests are immutable by design (migration 010): no edit, no delete, through
the app or the API; and a motor with tests cannot be deleted. So:

| Seeded with | After cleanup |
|---|---|
| `v_submit_demo_tests = false` | everything demo is gone |
| `v_submit_demo_tests = true` | the 6 submitted tests, their 25 readings and motors DEMO-M-001/002/003 **remain permanently** |

Exactly what remains after cleaning a full seed: 3 motors, 6 submitted sessions and 25 readings (the two drafts, their two
readings and the spare motor DEMO-M-004 are removed). They are clearly labelled and harmless, but they stay in your history and counts. **If you want a
fully removable demo, set `v_submit_demo_tests = false`** (you can run it with `true` later; you cannot go back).
Removing them anyway would need an administrator to bypass the protections by hand; that is a deliberate, destructive decision and
is not provided here.

## 7. What you will see in the app (full seed, no reference profiles)

- **Dashboard:** 4 motors, 8 tests (2 drafts), 6 awaiting assessment, 0 assessed; all four status tiles 0; "No assessment yet" 4.
  Recent tests list; no recent assessments.
- **Motors:** 4 rows. **DEMO-M-001** shows "No assessment recorded", six recent tests with their states, and measurement trends
  (series for voltage, current, temperature, speed with 4 points each and vibration with 3 — all in canonical units, same method,
  location not recorded). The draft is not part of any trend.
- **Test History:** 8 rows labelled draft / submitted — awaiting assessment.
- **Test pages:** submitted tests are read-only with a "Run assessment" panel; drafts open in the editor.

### Caution: do not assess demo tests
- With **no** approved profile, "Run assessment" would record a permanent *Insufficient data* result for that demo test.
- If you later create a real approved profile for type *induction*, the demo tests become assessable and would produce
  statuses (even "Normal" or "Fault suspected") **from invented readings**. Those results would look legitimate. Do not run
  assessments on demo tests.

## 8. Screens with hardcoded data (separate finding)

None. Every data page uses hooks: Dashboard, Motors, Motor details, Test history, Test entry, Assessment result, Reference list,
Reference detail and the forms read from Supabase. The only literal lists in `src` are navigation links, unit-conversion and
physical-bound tables (definitions, not data), and error-message maps. Empty-state texts say "Nothing on this page is sample
data". The two files that matched the search words ("demo", "sample") only contain that wording or a comment.

## 9. Limitations and notes

- Tested on in-memory PostgreSQL, not on your hosted project; the SQL Editor's handling of the `DO` block, notices and
  transaction control is assumed from standard behaviour.
- Demo ids start `dede0001-` / `dede0002-`; if you ever store real data with such ids the cleanup would match it (extremely
  unlikely; real ids are random).
- `.env.example` currently contains your real project URL and anon key. The anon key is public by design, but that file is meant
  to hold placeholders only because it is committed to version control. Consider moving the values to `.env` (which the app reads)
  and restoring the placeholders.
