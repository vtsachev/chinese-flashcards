# Build-and-Evaluate Loop — Passive Mac Time & Task Tracker ("timelog") (v2)

> This file **defines** the loop. It does not run it. To start it, see "How to run".
> Modeled on the conventions of the flashcards loop (`/LOOP.md` v3): invariants first,
> deterministic checks before opinion, independent evaluation, human gates, resumable state.
> v2 applies a productivity-coaching review to v1: **accurate logs are the floor, not the
> product**. v2 adds the **insight loop** (perception gap, weekly review, experiments) as a
> first-class track, grounds labels in the **owner's own project vocabulary** (closed label
> space = measurable accuracy), adds **deterministic focus metrics**, promotes **calendar
> merge** out of enhancement tier, gives the loop a **quantitative progress signal** (golden
> label accuracy %), and gates **tone and adherence** — because tracking tools fail by
> abandonment, not by arithmetic. Read "Design invariants" first.

## Goal

A tool that runs **unattended** on the owner's MacBook (sometimes with an external monitor)
and answers, with **zero mandatory manual timers, labels, or start/stop actions**:

1. **Where did my time go?** — time per project / task / category, as a table.
2. **When did I transition?** — a chronological timeline of activity blocks with start/end
   times and what changed at each transition.
3. **What was I actually doing?** — a short human-readable narrative per block ("Reviewed
   PRs in chinese-flashcards repo", not just "Google Chrome — 47 tabs").
4. **How fragmented was my focus?** — context switches, longest unbroken block, deep-work
   minutes, reactive share — computed, not vibes.
5. **Is anything changing?** — week-over-week trends, the gap between what the owner
   *believed* about their time and what happened, and whether last week's experiment moved
   anything.

Questions 1–3 are the **audit** (v1's scope). Questions 4–5 are the **insight loop** — the
part a productivity coach actually uses an audit *for*. Both are deliverables.

Deliverables: a **capture daemon** that starts at login and never needs touching, a **daily
log** (Markdown, one per day, generated automatically), a **weekly review** (trends +
evidence-cited observations + at most 2 suggested experiments + a check-in on last week's),
and a **CLI** (`timelog today | yesterday | week | estimate`).

"Done" = the daemon has run unattended through real workdays (sleep/wake, lid close, reboot,
external-monitor docking) with no manual intervention; daily logs match the owner's
recollection at block level; **two consecutive live weekly reviews** have been generated and
at least one observation struck the owner as *true and non-obvious*; every deterministic
check passes; the owner is **still voluntarily reading the output after ~2 weeks**; and the
owner signs off. An accurate log nobody opens — or a review that never changes (or
consciously confirms) a decision — is not done.

---

## Design invariants (the non-negotiables that keep the loop honest)

- **I1 — Metadata first, pixels second.** The primary record is the **deterministic activity
  stream** macOS already exposes: frontmost app, focused-window title, browser tab title+URL,
  idle seconds, lock/sleep state. Screenshots are an **opt-in enrichment tier** (default OFF),
  used only to disambiguate blocks the metadata can't label — never the sole evidence, never
  required for the tool to work. (Metadata is ~free in CPU/battery, robust, and far less
  privacy-hostile than a pixel archive; vision-only tracking was the original idea and is
  explicitly considered and demoted here, not ignored.)
- **I2 — Every number comes from code, not the model.** Durations, totals, percentages,
  transition timestamps, **and all focus metrics** (switch counts, longest block, deep-work
  minutes, fragmentation, week-over-week deltas) are computed by a deterministic sessionizer
  and **injected** into logs and reviews. The LLM labels, groups, and narrates — it never
  produces arithmetic or timestamps. Output whose numbers don't reconcile with the computed
  values is a hard failure (A5), not a style issue.
- **I3 — The grader is never the builder.** The agent that evaluates a log or review runs in
  a **fresh context** and receives only the raw event fixture + the generated artifact —
  never the builder's intermediate reasoning. It re-derives and diffs.
- **I4 — Privacy by default.** All captured data lives on the Mac under `~/.timelog/`, never
  in this repo. Only **segment metadata** (app names, window titles, durations) is sent to
  the Anthropic API for labeling — and only titles surviving a **redaction deny-list**.
  Screenshots, if ever enabled, are subject to a retention window (default 7 days). The repo
  contains only code and **synthetic** fixtures; committing real captured data is a build
  failure.
- **I5 — The Mac is the only place capture can be verified.** This loop executes in a Linux
  container; it can never run the capture path. Therefore: (a) all macOS-specific calls live
  behind one thin adapter module; (b) everything else — sessionizer, metrics, redaction,
  labeler, renderer, review generator, CLI — is pure and tested against **recorded/synthetic
  fixtures** in CI; (c) any claim about on-Mac behavior is **never marked done by the loop**
  — it is owner-verified at a human gate, with a written checklist.
- **I6 — Zero-touch operation is the floor.** The daemon auto-starts, restarts on crash
  (`KeepAlive`), survives sleep/wake and display changes; the daily log and weekly review
  generate on schedule without being asked. **Every insight-loop input (estimate prompt,
  project registry, experiment choices) is optional enrichment: the pipeline renders fully
  without any of them.** The tool never *needs* the owner; it rewards engagement.
- **I7 — Gaps are reported, never smoothed.** If the daemon was off, asleep, or denied a
  permission for 2 hours, the log says "no data 14:02–16:10 (machine asleep / daemon down)".
  The summarizer is forbidden from interpolating across gaps. Honest holes beat plausible
  fiction.
- **I8 — Prove it on one real day before polishing.** Pilot: install, capture 1–2 real
  workdays, generate logs, owner reviews against memory. Only after the pilot gate does the
  loop invest in the calendar merge, screenshots tier, and review refinements.
- **I9 — Awareness is the floor; the insight loop is the product.** A time audit creates
  value through capture → review → insight (especially the **perception gap** between belief
  and record) → a small experiment → follow-up. The artifacts must serve that arc: the daily
  log is raw material; the **weekly review** is the workhorse. A loop iteration that improves
  log accuracy but leaves the insight loop broken has not advanced the goal.
- **I10 — A mirror, never a scoreboard.** Output is neutral-curious and descriptive: no
  composite productivity score, no grades, no targets baked into the product, no moralizing
  ("3h on YouTube" is reported the same way as "3h in the IDE"). Observations cite evidence;
  experiments (max 2/week) are *suggested*, and the owner choosing **not** to act is a valid,
  recorded outcome. (Scores invite Goodhart; judgment invites abandonment — both kill
  tracking tools.)

---

## Architecture (what gets built)

Four layers, deliberately separable; only the first touches macOS.

### Tier 1 — Capture daemon (`timelogd`, thin macOS adapter + portable core)

Samples every **15 s** (configurable) and appends one JSON line per sample to
`~/.timelog/events/YYYY-MM-DD.jsonl`:

- **Frontmost app** — name + bundle id (`NSWorkspace.sharedWorkspace().frontmostApplication()`
  via `pyobjc`).
- **Focused window title** — Accessibility API (`AXUIElement`, `kAXFocusedWindowAttribute` →
  `AXTitle`). Requires **Accessibility** permission.
- **Browser tab** — title + URL for Safari/Chrome/Arc via per-browser AppleScript
  (`osascript`). Requires **Automation** permission per browser. URL stored as origin + path,
  no query strings (I4).
- **Idle seconds** — `Quartz.CGEventSourceSecondsSinceLastEventType`.
- **Lock/sleep** — screensaver/lock checked directly; sleep detected by **gap heuristic**
  (missing samples > 2× interval ⇒ asleep), which also covers daemon crashes honestly (I7).

Redaction (I4) is applied **at write time** — a deny-listed app's title is recorded as
`"[redacted]"` in the event file itself, so nothing downstream can leak it.

**Tier 1.5a — calendar merge (post-Gate-1 priority, NOT enhancement tier).** The screen is
not the day: screen-only capture undercounts meetings/calls and mislabels them "idle" — the
largest blind spot for a knowledge worker. Read the day's calendar events (EventKit via
`pyobjc`, or `icalBuddy`; Calendar permission via `doctor`) and deterministically merge them
into the timeline: an idle/gap block overlapping a calendar event becomes
`Meeting — <event title>`. Pure merge logic is fixture-tested in CI (I5); only the read
adapter is Mac-side.

**Tier 1.5b — screenshots (opt-in, default OFF).** `screencapture -x` on app-switch or every
5 min, all displays, downscaled to ≤1568 px long edge, stored under `~/.timelog/shots/`,
deleted after the retention window. Consulted only for blocks whose metadata label
confidence is low.

### Tier 2 — Sessionizer + focus metrics (pure, fixture-tested, runs anywhere)

Pure function: event stream → **segments** → **blocks** (idle > 5 min or lock/sleep ⇒
break). Output invariants (tested): non-overlapping, ordered, cover the day exactly, every
block traceable to source events.

From the same blocks, compute the **focus metrics** (I2 — all deterministic):
- context switches per hour (and morning vs afternoon split),
- longest unbroken single-task block,
- **deep-work minutes** (blocks ≥ 25 min on one task) vs shallow vs **reactive share**
  (email/chat-initiated blocks),
- fragmentation index (median block length),
- week-over-week deltas of all of the above.

### Tier 3 — Labeler + daily log (`timelog`)

Runs daily at **18:30** (LaunchAgent) and on demand:

1. Sessionize + compute metrics (code).
2. **Registry-grounded labeling.** The owner keeps a lightweight project/intention registry
   at `~/.timelog/projects.toml` (name, few keywords, optional "this week's top-3" flag).
   Claude (`claude-opus-4-8`, adaptive thinking, streaming) labels blocks via **structured
   outputs whose `project` field is an enum over the registry + `uncategorized`**, plus
   `work_mode` (deep/shallow/reactive — definitions in-prompt) and `confidence`. Closed
   label space ⇒ classification, not open generation: measurable, far less hallucination.
   Low confidence ⇒ `uncategorized`, **never a forced guess**.
3. **Code re-applies** approved merges and recomputes all numbers (I2), then renders
   `~/.timelog/logs/YYYY-MM-DD.md`: timeline with every transition explicit; totals by
   project and category; focus-metrics box; **estimate vs actual** (when an estimate exists
   — see Tier 4); narrative (5–10 sentences, I10 tone) including honest gap notes (I7).
4. **No API key ⇒ degraded, not broken**: rule-based labels (app→category map +
   registry-keyword matching) produce the same log with cruder names. The API enriches; it
   is not load-bearing.

`ANTHROPIC_API_KEY` is read from the environment / a non-repo config file; it never appears
in this repo (G6).

### Tier 4 — Insight loop (the coaching layer; all inputs optional per I6)

- **Perception-gap prompt (opt-in ritual).** `timelog estimate` (CLI, optionally a gentle
  notification) asks one question — "how many focused hours did you get today?" — and stores
  the answer **before** the log is shown. The daily log and weekly review then render
  estimate-vs-actual calibration. Skipping it never blocks anything.
- **Weekly review** — generated Sunday evening (and on demand: `timelog week`), at
  `~/.timelog/logs/week-YYYY-WW.md`:
  1. Trends: all focus metrics + per-project totals vs prior week (numbers from code, I2).
  2. **1–3 observations**, each carrying **machine-checkable evidence citations** (block IDs
     / metric names) — code verifies the references exist; the judge verifies they support
     the claim.
  3. **≤ 2 suggested experiments**, each specific and falsifiable ("move Tue/Thu 10:00
     standing meeting; see if Tue deep-work minutes recover", not "focus more").
  4. **Check-in on last week's experiment** — happened / didn't / owner declined — closing
     the behavior-change loop. Declining is recorded neutrally (I10).
  5. Proposed **registry additions** it noticed (recurring uncategorized clusters), for
     one-keystroke owner confirmation — the vocabulary grows without becoming a chore.

---

## Source of truth & state model

- **Code + loop state**: this repo, `tracker/` (`src/`, `tests/`, `fixtures/`, `eval/`,
  `install/`).
- **Captured data**: `~/.timelog/` on the owner's Mac only (events, logs, reviews,
  `projects.toml`, estimates). Any copy of real data into the repo fails A8.
- **Fixtures**: `tracker/fixtures/day-*.jsonl` — synthetic days exercising known hard cases
  (sleep gap, rapid app-switching, long idle, redacted app, browser-heavy day, midnight
  spanning, calendar-meeting overlap). Plus the **golden set**: a multi-day fixture with
  **ground-truth labels and hand-computed metrics**, the basis of the loop's quantitative
  accuracy signal (A10). After the pilot, the owner may contribute a **redacted** real day
  via `timelog export-fixture --redact` (titles hashed/genericized by the tool, not by owner
  diligence).
- **Loop ledger**: `tracker/eval/report-NN.md` (one per iteration) + `tracker/FEEDBACK.md`
  (owner notes from real use, including a one-line "was this week's review useful?" entry).
  The loop is a function of these — idempotent and resumable.

---

## Loop structure

**Three tracks.** *Track C (capture)* = Tier 1, only verifiable on the Mac (I5). *Track P
(processing)* = Tiers 2–3. *Track I (insight)* = Tier 4 — fully fixture-testable in CI, but
its *usefulness* is only verifiable by the owner living with it (I9), so it has its own live
evidence requirements at Gate 2. All three are built in Phase 0; the pilot gates C+P; the
live-use window gates I.

### Phase 0 — Setup + Pilot (runs once; gated)

- **S0.1 Scaffold.** `tracker/` Python package (3.11+), `pyproject.toml`, `pytest`, lint,
  CI-runnable `make check` implementing every Stage-A gate as exit-code tests. *No feature
  work proceeds until `make check` runs green on the empty skeleton.*
- **S0.2 Portable core first.** Event schema, sessionizer, **focus metrics**, redaction,
  rule-based labeler, renderers (daily + weekly), CLI — built and fixture-tested entirely in
  the container, including the golden set with ground-truth labels.
- **S0.3 macOS adapter.** The single module with `pyobjc`/`osascript` calls, thin enough to
  review by reading (I5). Includes `timelog doctor`: checks each permission and prints
  exactly what to click (Privacy & Security → Accessibility / Automation; + Calendar when
  Tier 1.5a lands; + Screen Recording only if screenshots get enabled).
- **S0.4 Labeler + insight layer.** Registry-grounded structured-output labeling
  (enum-constrained), daily log, weekly review with evidence citations, estimate storage.
  Golden-fixture tests assert schema validity, label accuracy ≥ floor (A10), citation
  validity (A11), and number reconciliation (A5). A recorded-response mode keeps CI runnable
  without an API key.
- **S0.5 Install kit.** `make install` on the Mac: venv, LaunchAgents (`timelogd` with
  `KeepAlive`, daily 18:30 summary, Sunday weekly review), `timelog doctor`, uninstall
  target. Shellcheck-clean.
- **S0.6 PILOT.** Owner clones the branch on the MacBook, runs `make install`, grants
  permissions, **seeds `projects.toml` with 3–7 real projects (5 minutes, once)**, then works
  normally for 1–2 days — including at least one sleep/wake, one lid close, one
  external-monitor session, and (optionally) one `timelog estimate`. Owner reads the logs
  and fills `tracker/FEEDBACK.md` (which labels/transitions were wrong, what's missing, was
  anything creepy or judgmental in tone). Optionally exports a redacted fixture.
- **🚦 HUMAN GATE 1:** Owner confirms: daemon ran unattended (I6), logs substantially match
  memory, transitions right within ~2 min, labels mostly land in *their* vocabulary, tone
  reads like a mirror not a report card (I10), privacy posture feels right, CPU/battery
  unnoticeable. **Stop and ask. Do not auto-proceed.** The pilot's job is to falsify the
  design cheaply; expect and welcome a gap list.

### Live-use window (between Gate 1 and Gate 2; the loop keeps iterating beneath it)

After Gate 1, the owner just lives with the tool for ~2 weeks while iterations continue.
This window produces the Track-I evidence Gate 2 needs: ≥ 2 consecutive real weekly reviews,
estimate-vs-actual data if the owner engages, FEEDBACK.md usefulness lines, and the
adherence signal (still reading voluntarily). The loop may not simulate this evidence (G3).

### Iteration body — one gap per tick, repeat until stop condition

- **B1. SELECT.** From the latest `eval/report-NN.md` + `FEEDBACK.md`, pick the top gap by
  the priority order below.
- **B2. BUILD/FIX.** Smallest change that closes it. macOS-adapter changes get a written
  "owner must re-verify on Mac: …" note (I5) and queue for the next gate.
- **B3. EVALUATE.**
  - *Stage A — code:* `make check` (gates below). Any failure → fix, don't advance.
  - *Stage B — independent LLM (I3):* fresh-context evaluator gets only (fixture events,
    generated artifacts) and judges B1–B7, with anchored pass/fail examples in the rubric
    for consistency. Writes its half of `eval/report-NN.md`.
- **B4. SHIP.** Commit + push the branch; pending-owner-verification items listed.
- **B5. DECIDE.** Stop condition met → Human Gate 2. Else record the top remaining gap → B1.

### Priority order (operational, not vibes)

1. **Capture integrity** — events missing/malformed, daemon-lifecycle bugs.
2. **Privacy/redaction failure** — deny-list leak, query strings in URLs, real data in repo.
3. **Number correctness** — sessionizer / focus-metrics / renderer reconciliation (A2–A5, A9).
4. **Faithfulness** — wrong or out-of-registry labels, invented activity, smoothed gaps,
   invalid evidence citations.
5. **Insight-layer quality** — weekly review observations unsupported, experiments vague,
   check-in missing, tone violations (I9/I10).
6. **Zero-touch ops** — install, permissions UX, LaunchAgent behavior (owner-reported).
7. **Calendar merge (Tier 1.5a)** — first feature work after 1–6 are clean post-pilot.
8. **Enhancement** — screenshots tier, monthly trends, richer registry tooling (only after
   1–7 are clean).

---

## The Evaluator (rubric)

### Stage A — code checks (deterministic, must be 100%, run by `make check`)

- **A1 Schema** — every fixture event validates; unknown fields rejected; timestamps
  monotonic per file.
- **A2 Sessionizer invariants** — blocks non-overlapping, ordered, traceable;
  active + idle + gap = wall clock for every fixture day (exact).
- **A3 Hard-case fixtures** — sleep gap, midnight-spanning, 1-second app flapping, all-idle,
  empty day, calendar-overlap day: correct, crash-free output.
- **A4 Redaction** — deny-listed fixture app yields `[redacted]` in events, blocks, **and**
  rendered artifacts; URLs carry no query strings.
- **A5 Reconciliation** — every number in every rendered artifact (daily and weekly) equals
  the computed value; LLM-suggested merges that would change totals are re-derived by code
  or rejected.
- **A6 Gap honesty (I7)** — fixture with a 2 h hole renders an explicit "no data" line; test
  asserts no activity claimed inside it.
- **A7 Degraded mode** — with no API key, daily log **and weekly review** still render
  complete (rule-based labels) with exit code 0; with no registry / no estimates, all
  artifacts render without those sections (I6).
- **A8 Hygiene** — no real captured data, no secrets in repo; lint + shellcheck clean;
  sampler core loop unit-benchmarked (< 50 ms pure-Python per sample).
- **A9 Focus metrics** — switch counts, longest block, deep-work minutes, reactive share,
  fragmentation, and week-over-week deltas match hand-computed values on the golden set.
- **A10 Label accuracy (the loop's quantitative signal)** — on the golden set (recorded
  responses for CI determinism): project-label accuracy **≥ 85%**, zero out-of-registry
  labels, low-confidence cases land in `uncategorized` not wrong buckets. The measured %
  is reported in every `eval/report-NN.md`.
- **A11 Citation validity** — every observation in a generated weekly review carries
  evidence references (block IDs / metric names) that exist in the computed data; reviews
  with dangling or missing citations fail.

### Stage B — independent LLM judgment (I3; fresh context, fixtures + artifacts only)

- **B1 No invention** — every claimed activity traces to events; nothing inside gaps/idle.
- **B2 Label fidelity** — labels reasonable given evidence; ambiguity lands in
  `uncategorized`, never confidently wrong.
- **B3 Transition accuracy** — timeline transitions match events within ±2 min.
- **B4 Readability** — a reader can answer Goal questions 1–4 from the daily log alone in
  under a minute.
- **B5 Privacy read** — nothing present that the redaction config forbids.
- **B6 Coaching quality (weekly review; I9)** — observations are *supported* by their cited
  evidence (A11 checked existence; B6 checks the citation actually backs the claim);
  experiments ≤ 2, each specific and falsifiable; prior-week check-in present and accurate;
  perception-gap section correct when estimates exist. Anchored with in-rubric pass/fail
  examples.
- **B7 Tone & framing (I10)** — neutral-curious; no moralizing, no grades, no composite
  score, no implied targets; "declined experiment" reported as a valid outcome. Anchored
  examples included.

### Stage C — owner-on-Mac / live-use checks (I5, I9; verified only at human gates)

- **C1 Permissions** — `timelog doctor` walks each grant correctly on current macOS.
- **C2 Lifecycle** — daemon auto-starts at login, survives crash (kill → relaunch),
  sleep/wake, lid close, display dock/undock.
- **C3 Footprint** — negligible CPU (~<1% avg), no battery complaint.
- **C4 Zero-touch run** — ≥ 3 consecutive real workdays, no manual intervention, log every
  evening (I6).
- **C5 Truth test** — owner compares two days' logs against memory/calendar: labels and
  transitions ring true; gaps honest.
- **C6 Insight test (I9)** — across the live-use window: ≥ 2 consecutive weekly reviews
  generated on schedule; **at least one observation the owner rates true-and-non-obvious**;
  at least one experiment proposed that the owner acted on **or consciously declined**; if
  estimates were used, the calibration display matched.
- **C7 Adherence (the metric that kills trackers)** — after ~2 weeks the owner is still
  opening the output voluntarily and FEEDBACK.md usefulness lines trend neutral-to-positive.
  If the owner stopped reading, that is a **product failure to diagnose** (tone? noise?
  wrong cadence?), not a user failure — feed it back as a priority-5 gap.

---

## Scoring & progress signals (so anti-spin doesn't misfire)

Track per iteration, in `eval/report-NN.md`:
- **Golden label accuracy %** (A10) and reconciliation pass rate — the loop's gradient.
- **Per-gate pass counts** (A1–A11, B1–B7) — infra iterations still show progress.
- **Open-gap list** ranked by priority order, with the single next action.
- **Pending-owner-verification queue** (I5) — must trend to empty before Gate 2.
- After Gate 1, **live signals** copied from FEEDBACK.md: days captured, reviews generated,
  usefulness lines, adherence. These are *observed*, never synthesized (G3).

---

## Stop condition (ALL must hold)

1. **Stage A = 100%** on all fixtures, including one owner-exported redacted real day, with
   golden label accuracy ≥ 85%.
2. **Stage B clean** — no open B1–B7 failures.
3. **Stage C green** — C1–C5 checked by the owner; C6–C7 evidenced by the live-use window
   (≥ 2 real weekly reviews; insight + adherence evidence as written).
4. **No pending-verification queue.**
5. **One no-regression iteration** — a full pass that changed nothing and broke nothing.
6. **🚦 HUMAN GATE 2** — owner declares the tool earned a permanent place in their week: the
   logs are trusted, the reviews are read, and at least one insight or experiment was worth
   having. Until then the status is "ready for review", never "done".

---

## Guardrails (runaway + drift protection)

- **G1 Hard cap.** Max ~25 iterations or a token-budget ceiling, whichever first. On hitting
  it: stop, summarize state, surface blockers. Never loop unbounded.
- **G2 Anti-spin.** The same specific failure id (e.g. `golden-day2 A10 fail`) persisting
  across 2 consecutive iterations ⇒ stop and ask.
- **G3 No phantom verification (I5, I9).** The loop never marks a Stage-C item done and
  never fabricates live-use evidence (reviews "the owner found useful", adherence,
  estimates). Reports claiming on-Mac behavior or owner sentiment without an owner entry in
  FEEDBACK.md are themselves a failure.
- **G4 Scope brake.** No screenshots tier, monthly dashboards, gamification, app-blocking,
  or notification nagging — the first two wait behind priorities 1–7; the last three are
  **permanently out** (I10: mirror, not scoreboard; observer, not enforcer).
- **G5 Resumability.** State lives entirely in `eval/report-*.md` + `FEEDBACK.md` + code.
- **G6 Secrets & privacy.** `ANTHROPIC_API_KEY` only via environment/local config outside
  the repo. Real captured data never committed (A8 enforces). Public-repo rider: code and
  synthetic fixtures only, nothing identifying the owner's work content.
- **G7 Coaching restraint (I10).** Max 2 experiments per weekly review; experiments are
  suggestions with evidence, never directives; no streaks, no guilt mechanics; the owner
  declining is a recorded, respected outcome. The tool observes — the owner decides.

---

## How to run (when ready — not now)

```
/loop Drive the loop in tracker/LOOP.md (v2). Each tick: if tracker/src does not exist, run
Phase 0 (S0.1–S0.5) including the focus metrics, registry-grounded labeler, weekly review
with evidence citations, and golden fixture set; write eval/report-01.md and STOP at the
pilot instructions for Human Gate 1 — the owner must install and run it on their Mac; you
cannot. Otherwise read the latest tracker/eval/report-NN.md and tracker/FEEDBACK.md, SELECT
the top gap by the priority order, BUILD/FIX it, run Stage A (make check, report golden
label accuracy %) then Stage B (a FRESH-CONTEXT evaluator given only fixture events + the
generated artifacts — never the builder's reasoning — judging B1–B7 incl. coaching quality
and tone), commit and push the branch, and write eval/report-NN.md including the
pending-owner-verification queue and live-use signals copied (never synthesized) from
FEEDBACK.md. Honor invariants I1–I10 and guardrails G1–G7. Stop and ask at the human gates,
on anti-spin (G2), or the hard cap (G1). When the stop condition holds, post a "ready for
review" summary.
```

Omit the interval for self-pacing; add one (e.g. `/loop 15m ...`) to fix cadence.

---

## Decisions (resolved, with the alternatives that lost)

- **D1 Tracking approach — RESOLVED: metadata-first capture, screenshots as opt-in
  enrichment (I1).** Screenshot-only tracking loses on battery, privacy surface, storage,
  and reliability; metadata answers "what was I doing" for most blocks at near-zero cost.
- **D2 Implementation — RESOLVED: Python 3.11+ with `pyobjc` + `osascript`, LaunchAgents.**
  A Swift menu-bar app would be more native but can't be compiled or tested in this loop's
  Linux container (I5) and is harder for the owner to hack on. Revisit only if the pilot
  shows unacceptable footprint (C3).
- **D3 Summarizer — RESOLVED: Claude `claude-opus-4-8`, structured outputs, adaptive
  thinking, streaming; rule-based fallback when no API key (A7).** → **needs owner input
  only to confirm an `ANTHROPIC_API_KEY` is available on the Mac**; the tool installs and
  works (degraded) without it.
- **D4 Output — RESOLVED: local Markdown (daily + weekly) + `timelog` CLI.** No web
  dashboard, no cloud sync, no accounts. The **weekly review is core** (I9), not an
  enhancement — v2 reverses v1 here.
- **D5 Cadence — RESOLVED: 15 s sampling; idle threshold 5 min; daily summary 18:30; weekly
  review Sunday evening; all configurable in `~/.timelog/config.toml`.** Coaching practice:
  daily glance (≤2 min), weekly review (~15 min) is the workhorse; monthly is deferred.
- **D6 Label vocabulary — RESOLVED: owner's project registry (`projects.toml`),
  enum-constrained structured outputs, `uncategorized` over forced guesses.** App-taxonomy
  categories alone lost: they can't answer "did my time match my intentions?" and open-set
  labels can't be accuracy-measured (A10).
- **D7 Perception-gap prompt — RESOLVED: opt-in `timelog estimate`, stored pre-reveal,
  rendered as estimate-vs-actual.** Mandatory check-ins lost to I6 (zero-touch) — the single
  most-cited reason tracking tools get abandoned is required ceremony.
- **D8 Calendar merge — RESOLVED: promoted to first post-Gate-1 feature (priority 7), not
  enhancement tier.** Screen-only capture's meeting blind spot is the largest systematic
  error in the audit; the merge is deterministic and cheap.
