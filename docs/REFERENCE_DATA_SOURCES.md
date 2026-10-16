# Reference Data Sources — Baldor-Reliance catalog motors (MTR-BAL-001 … 015)

The 15 motors are catalog references, not verified nameplates. Catalog ratings are not operating limits.
**Nothing in this document is approved; approval is a manual, irreversible action in the app.**
Statements below are labelled **[SOURCE]** (read from a primary document), **[CHOICE]** (an implementation decision made by this project)
or **[ASSUMPTION / UNVERIFIED]**. Do not read a [CHOICE] or an [ASSUMPTION] as something the standard says.

## 1. Verified source statements

**[SOURCE]** ANSI/NEMA MG 1-2016 (Revised 2018), Section II "Small (Fractional) and Medium (Integral) Machines", Part 12 "Tests and Performance - AC and DC Motors"
(printed © 2021), clause 12.44.1 "Running". Read from the NEMA-hosted PDF
<https://www.nema.org/docs/default-source/standards-document-library/mg-1-part-12-watermark.pdf> on 2026-10-16.

> Alternating-current motors shall operate successfully under running conditions **at rated load** with a variation in the voltage or the frequency up to the following:
> a. Plus or minus 10 percent of rated voltage with rated frequency for induction motors.
> b. Plus or minus 6 percent of rated voltage with rated frequency for universal motors.
> c. Plus or minus 5 percent of rated frequency with rated voltage.
> d. A combined variation in voltage and frequency of 10 percent (sum of absolute values) of the rated values, provided the frequency variation does not exceed plus or minus 5 percent of rated frequency, and the voltage variation of universal motors (except fan motors) does not exceed plus or minus 6 percent of rated voltage.
> Performance within these voltage and frequency variations will not necessarily be in accordance with the standards established for operation at rated voltage and frequency.

**[SOURCE]** Scope: Part 12, 12.1 covers AC squirrel-cage motors up to 500 hp (and DC motors up to 1.25 hp per rpm); all 15 catalog motors (2–40 hp) are within the size range.

**[SOURCE]** NEMA MG 1 Part 7, 7.8 / Table 7-1 (read for the vibration question): housing-vibration limits are "for machines running at no load, uncoupled" and "machines as installed (in situ) may exhibit higher levels"; units are peak velocity in./s / peak-to-peak mils.

**[SOURCE]** NEMA MG 1 Part 12, 12.43: temperature rises are stated "by resistance" at rated load against a stated ambient (a method-specific rise, not a surface temperature).

## 2. Implementation choices (not statements of the standard)

| # | Choice | Why / consequence |
|---|---|---|
| C1 | Items (a) and (c) are stored as **warning** thresholds (414–506 V, 57–63 Hz for 460 V / 60 Hz), with no hard boundary | The standard defines a tolerance within which the motor operates successfully, not a fault boundary; nothing here can raise `FAULT_SUSPECTED` |
| C2 | Item (d) is an **explicit rule** (`applicable_specs.combined_variation`, DIAGNOSTIC_RULES 21.11), reference values = the motor's recorded rated voltage and frequency | The coupled condition cannot be expressed as two ranges |
| C3 | A violation of (d) is a **WARNING** | Same reason as C1 |
| C4 | "At rated load" is an **operator-declared** field on the test (`load_condition`); anything other than `rated` makes the check *not assessed* and the assessment incomplete | The app has no way to measure load; it must not assume it |
| C5 | Boundaries are **inclusive** ("up to"); floating-point noise below 1e-9 % is ignored; the entered value is otherwise judged exactly | Interpretation of "up to" |
| C6 | The profile requires `supply_type = line` on the motor (migration 013); unknown → applicability UNKNOWN (no limits applied), inverter → incompatible | The clause concerns a rated supply; inverter-fed motors are outside what was verified |
| C7 | A deviation outside a range at an unestablished load is still reported (flagged "not confirmed to apply") while the check stays unassessed | A deviation must not be hidden by missing context |
| C8 | Voltage is a single line-to-line RMS reading; phase imbalance is out of scope | Schema stores one reading per parameter per test |
| C9 | A NORMAL that covers fewer than all catalog parameters is labelled **partial** everywhere it is shown | A voltage/frequency-only profile must not read as "motor is healthy" |

## 3. Assumptions and unverified items

- **[UNVERIFIED]** Editions after MG 1-2016 (Rev. 2018) — MG 1-2021 and MG 00001-2024 — were not read; the wording may differ.
- **[UNVERIFIED]** The Baldor-Reliance installation manual (MN408) could not be retrieved; no Baldor-specific tolerance is cited. Individual datasheets for the 15 models were not read.
- **[ASSUMPTION]** That all 15 motors are general-purpose induction motors on a sinusoidal line supply. This is **not assumed by the software**: `supply_type` must be recorded per motor. VEBM3558 and VECP3770T-4 may be inverter-duty; leave them unresolved until verified against their datasheets.
- **[ASSUMPTION]** That an operator's declaration of rated load is acceptable evidence of "at rated load". It is a declaration, not a measurement; current vs rated current is deliberately not used as a proxy.
- **[ASSUMPTION]** That the 15 motors share one `motor_type` text, 3 phases, 460 V and 60 Hz in the hosted database. The seed refuses to run otherwise; the SQL in `database/verify/baldor_reference_check.sql` shows the actual values.
- **[ASSUMPTION]** Reference values for deviation are the motor's recorded `rated_voltage` / `rated_frequency`, and the profile's absolute ranges (414–506 V, 57–63 Hz) are only valid for 460 V / 60 Hz motors — enforced by the profile's applicable specs (voltage 460–460 V, frequency 60 Hz).

## 4. Parameter research matrix (applies to all 15 models)

| Parameter | Candidate source | Finding | Limit added |
|---|---|---|---|
| Voltage | NEMA MG 1 12.44.1(a), (d) | Verified (§1); draft profile only | Draft |
| Frequency | NEMA MG 1 12.44.1(c), (d) | Verified (§1); draft profile only | Draft |
| Current | Nameplate full-load amps × service factor | A rating, not a health limit; needs per-model data and a decision on what the limit means | None |
| Temperature | NEMA MG 1 12.43 temperature rise | Rises by a specific method (resistance) at rated load; do not apply to the surface/location readings the app stores | None |
| Vibration | NEMA MG 1 7.8 Table 7-1 | Factory limits for uncoupled, no-load machines (peak velocity in./s); explicitly not in situ. The app stores mm/s with a free-text method | None |
| Speed | Catalog rated rpm | Rated speed is not an acceptable range; no slip/tolerance source found | None |
| Power factor | Catalog typical values | Typical, not limits | None |

Per-model status: all 15 models (EM3707, M2275, EM2275, M3326, M3212T, BM3703, EJMM2334T, HM9129T, VECP3770T-4, SPM2513T, M3558T, VEBM3558, M3714T, M2539T-12, M4103) share the **one** draft profile **only** where the motor is recorded with
`motor_type` matching, 3 phases, 60 Hz, 460 V **and `supply_type = line`**. Compatibility is decided by the app ("Profile availability per motor") — not by this document. No model has any other verified limit. No profile is approved.

## 5. Conditions that must all be met before approving the NEMA draft

1. Clause 12.44.1 re-read in the edition you rely on (and any later edition noted); wording unchanged or the profile revised.
2. `database/verify/baldor_reference_check.sql` run in the target project: 15 tags present, one owner, one motor type, expected ratings.
3. Migration 013 applied, and `supply_type` set to `line` **only** for motors verified as not drive-fed; inverter-duty models verified from their datasheets (left blank or `inverter` until then).
4. The owner accepts, in writing, C1–C9 above, in particular that rated load is declared and that current/temperature/vibration/speed/power factor are not assessed (results will be marked partial).
5. The profile's effective-from date is set; source reference is complete (it is in the seed); the approval dialog shows no blockers.
6. A test run in the app with `Load during the test = Rated load` and values at and just beyond each boundary gives the expected results (see the QA script `05-load-condition-combined.mjs` for the local equivalent).
7. Understanding that approval is irreversible: an approved profile is immutable; changes need a new version.
