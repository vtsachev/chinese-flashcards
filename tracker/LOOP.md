# Build-and-Evaluate Loop — Passive Mac Time & Task Tracker ("timelog")

> This file **defines** the loop. It does not run it. To start it, see "How to run".
> Modeled on the conventions of the flashcards loop (`/LOOP.md` v3): invariants first,
> deterministic checks before opinion, independent evaluation, human gates, resumable state.
> Read "Design invariants" first — they are the reason the rest is shaped the way it is.

## Goal

A tool that runs **unattended** on the owner's MacBook (sometimes with an external monitor)
and answers, at the end of any day, with **zero manual timers, labels, or start/stop actions**:

1. **Where did my time go?** — time per app / task / project category, as a table.
2. **When did I transition?** — a chronological timeline of activity blocks with start/end
   times and what changed at each transition.
3. **What was I actually doing?** — a short human-readable narrative per block ("Reviewed
   PRs in chinese-flashcards repo", not just "Google Chrome — 47 tabs").

Deliverables: a **capture daemon** that starts at login and never needs touching, a **daily
log** generated automatically (Markdown, one file per day), and a **CLI** (`timelog today`,
`timelog yesterday`, `timelog week`) to view it on demand.

"Done" = the daemon has run unattended through real workdays (including sleep/wake, lid
close, reboot, external-monitor docking) with no manual intervention, the daily logs match
the owner's recollection of those days at the block level, every deterministic check passes,
**and the owner signs off**. A technically-correct log the owner doesn't trust or read is
not done.

---

## Design invariants (the non-negotiables that keep the loop honest)

- **I1 — Metadata first, pixels second.** The primary record is the **deterministic activity
  stream** macOS already exposes: frontmost app, focused-window title, browser tab title+URL,
  idle seconds, lock/sleep state. Screenshots are an **opt-in enrichment tier** (default OFF),
  used only to disambiguate blocks the metadata can't label — never the sole evidence, never
  required for the tool to work. (Rationale: metadata is ~free in CPU/battery, robust, and far
  less privacy-hostile than a pixel archive of everything on screen; vision-only tracking was
  the owner's first idea and is explicitly considered and demoted here, not ignored.)
- **I2 — Every number comes from code, not the model.** Durations, totals, percentages, and
  transition timestamps are computed by a deterministic sessionizer and **injected** into the
  daily log. The LLM labels blocks, groups them into tasks, and writes the narrative — it never
  produces arithmetic or timestamps. A log whose numbers don't reconcile with the computed
  segments is a hard failure (A5), not a style issue.
- **I3 — The grader is never the builder.** The agent that evaluates a day's log runs in a
  **fresh context** and receives only the raw event fixture + the generated log — never the
  builder's intermediate reasoning. It re-derives the timeline and diffs.
- **I4 — Privacy by default.** All captured data lives on the Mac under `~/.timelog/`, never
  in this repo. Only **segment metadata** (app names, window titles, durations) is sent to the
  Anthropic API for labeling — and only titles surviving a **redaction deny-list** (e.g.
  password managers, banking, anything the owner lists). Screenshots, if ever enabled, are
  analyzed and then subject to a retention window (default 7 days). The repo contains only
  code and **synthetic** fixtures; committing real captured data is a build failure.
- **I5 — The Mac is the only place capture can be verified.** This loop executes in a Linux
  container; it can never run the capture path. Therefore: (a) all macOS-specific calls live
  behind one thin adapter module; (b) everything else — sessionizer, redaction, summarizer,
  CLI, report rendering — is pure and tested against **recorded/synthetic fixtures** in CI;
  (c) any claim about on-Mac behavior (permissions, sleep/wake, battery, LaunchAgent) is
  **never marked done by the loop** — it is owner-verified at a human gate, with a written
  checklist. The loop may not "verify" what it cannot execute.
- **I6 — Zero-touch operation is the product.** The owner's stated pain is *having to
  remember*. The daemon must auto-start at login, restart on crash (LaunchAgent `KeepAlive`),
  survive sleep/wake and display changes, and the daily log must generate on schedule without
  being asked. Any design that reintroduces a manual step (start a timer, label a block,
  trigger a summary) fails the goal even if everything else works.
- **I7 — Gaps are reported, never smoothed.** If the daemon was off, asleep, or denied a
  permission for 2 hours, the log says "no data 14:02–16:10 (machine asleep / daemon down)" —
  the summarizer is forbidden from interpolating or guessing across gaps. Honest holes beat
  plausible fiction; this is the tracking analog of `needs_human`.
- **I8 — Prove it on one real day before polishing.** Pilot: install, capture 1–2 real
  workdays, generate logs, owner reviews against memory. Only after the pilot gate does the
  loop invest in enhancements (screenshots tier, weekly rollups, project rules).

---

## Architecture (what gets built)

Three layers, deliberately separable; only the first touches macOS.

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

Optional **Tier 1.5 — screenshots (opt-in, default OFF)**: `screencapture -x` on app-switch
or every 5 min, all displays (external monitor included), downscaled to ≤1568 px long edge,
stored under `~/.timelog/shots/`, deleted after the retention window. Consulted by the
summarizer only for blocks whose metadata label confidence is low.

### Tier 2 — Sessionizer (pure, fixture-tested, runs anywhere)

Pure function: event stream → **segments** (contiguous same-context spans) → **blocks**
(segments merged by app+title similarity; idle > 5 min or lock/sleep ⇒ break). Output
invariants (tested): blocks are non-overlapping, chronologically ordered, cover the day
exactly (active + idle + gap = wall clock), every block traceable to source events.

### Tier 3 — Summarizer + CLI (`timelog`)

Runs daily at **18:30** (LaunchAgent) and on demand. Pipeline:

1. Sessionize the day (code).
2. Send block metadata to **Claude (`claude-opus-4-8`, adaptive thinking, streaming)** with a
   structured-output schema: per-block `task_label`, `category`, `confidence`, plus suggested
   block merges ("these 3 blocks are one task: PR review").
3. **Code re-applies** approved merges and recomputes all numbers (I2), then renders
   `~/.timelog/logs/YYYY-MM-DD.md`:
   - **Timeline** — `09:12–09:58 · Coding — tracker sessionizer (VS Code, iTerm)` … with
     every transition explicit (the owner's core ask).
   - **Totals table** — by category and by task, minutes + %.
   - **Narrative** — 5–10 sentences, including honest gap notes (I7).
4. **No API key ⇒ degraded, not broken**: rule-based labels (app→category map) produce the
   same log with cruder names. The API enriches; it is not load-bearing (resilience analog
   of I1).

`ANTHROPIC_API_KEY` is read from the environment / a non-repo config file; it never appears
in this repo (G6).

---

## Source of truth & state model

- **Code + loop state**: this repo, `tracker/` (`src/`, `tests/`, `fixtures/`, `eval/`,
  `install/`).
- **Captured data**: `~/.timelog/` on the owner's Mac only — gitignored conceptually and
  physically (it is outside the repo; any copy of real data into the repo fails A8).
- **Fixtures**: `tracker/fixtures/day-*.jsonl` — synthetic days scripted to exercise known
  hard cases (sleep gap, rapid app-switching, long idle, redacted app, browser-heavy day,
  day-boundary spanning midnight, external-monitor unlock pattern). After the pilot, the owner
  may contribute a **redacted** real day via `timelog export-fixture --redact` (titles
  hashed/genericized) — the export tool, not the owner's diligence, guarantees redaction.
- **Loop ledger**: `tracker/eval/report-NN.md` (one per iteration) + `tracker/FEEDBACK.md`
  (owner notes from real use between gates). The loop is a function of these — idempotent and
  resumable (an interrupted iteration resumes by reading the latest report; nothing repeats,
  nothing is skipped).

---

## Loop structure

**Two tracks.** *Track C (capture)* = Tier 1, only verifiable on the Mac (I5). *Track P
(processing)* = Tiers 2–3, fully verifiable in this container. Both are built in Phase 0 and
gated together at the pilot; iterations after the gate mostly move Track P plus install/ops
fixes that Track C feedback surfaces.

### Phase 0 — Setup + Pilot (runs once; gated)

- **S0.1 Scaffold.** `tracker/` Python package (3.11+), `pyproject.toml`, `pytest`, lint,
  CI-runnable `make check` implementing every Stage-A gate as exit-code tests. *No feature
  work proceeds until `make check` runs green on the empty skeleton.*
- **S0.2 Portable core first.** Event schema, sessionizer, redaction, rule-based labeler,
  log renderer, CLI — built and fixture-tested entirely in the container.
- **S0.3 macOS adapter.** The single module with `pyobjc`/`osascript` calls, kept thin enough
  to be reviewed by reading (it cannot be executed here — I5). Include a `timelog doctor`
  command that, on the Mac, checks each permission and prints exactly what to click in System
  Settings (Privacy & Security → Accessibility / Automation; + Screen Recording only if
  screenshots get enabled).
- **S0.4 Summarizer.** Claude API call (structured outputs, `claude-opus-4-8`), golden-fixture
  test: fixture day in → assert schema validity, label coverage, and that the renderer's
  numbers reconcile with the sessionizer (A5). A recorded-response mode keeps this test
  runnable without an API key in CI.
- **S0.5 Install kit.** `make install` on the Mac: venv, two LaunchAgents
  (`timelogd` with `KeepAlive`, daily summarizer at 18:30), `timelog doctor` run,
  uninstall target. Shell scripts shellcheck-clean.
- **S0.6 PILOT.** Owner clones the branch on the MacBook, runs `make install`, grants
  permissions via `doctor`, then **works normally for 1–2 days** — including at least one
  sleep/wake, one lid close, and one external-monitor session. Owner reads the generated
  logs and fills in `tracker/FEEDBACK.md` (block-level: which labels/transitions were wrong,
  what's missing, was anything creepy). Optionally exports a redacted fixture.
- **🚦 HUMAN GATE 1:** Owner confirms: daemon ran unattended (I6), logs substantially match
  memory, transitions are right within ~2 min, privacy posture feels right, CPU/battery
  unnoticeable. **Stop and ask. Do not auto-proceed.** The pilot's job is to falsify the
  design cheaply; expect and welcome a gap list.

### Iteration body — one gap per tick, repeat until stop condition

- **B1. SELECT.** From the latest `eval/report-NN.md` + `FEEDBACK.md`, pick the top gap by
  the priority order below.
- **B2. BUILD/FIX.** Smallest change that closes it. macOS-adapter changes get a written
  "owner must re-verify on Mac: …" note in the report (I5) — they queue for the next gate
  rather than being claimed as done.
- **B3. EVALUATE.**
  - *Stage A — code:* `make check` (all gates below). Any failure → fix, don't advance.
  - *Stage B — independent LLM (I3):* fresh-context evaluator gets only (fixture events,
    generated log) and judges faithfulness gates B1–B5. Writes its half of
    `eval/report-NN.md`.
- **B4. SHIP.** Commit + push the branch. Changes affecting on-Mac behavior are listed in the
  report under "pending owner verification".
- **B5. DECIDE.** Stop condition met → Human Gate 2. Else record the top remaining gap → B1.

### Priority order (operational, not vibes)

1. **Capture integrity** — events missing, malformed, or daemon-lifecycle bugs (you can't
   summarize what wasn't captured).
2. **Privacy/redaction failure** — deny-list leak, query strings in URLs, real data in repo.
3. **Number correctness** — sessionizer/renderer reconciliation failures (A4–A5).
4. **Faithfulness** — Stage B failures: wrong labels, invented activity, smoothed gaps.
5. **Zero-touch ops** — install, permissions UX, LaunchAgent behavior (owner-reported).
6. **Enhancement** — screenshots tier, weekly rollup, project-rules file, calendar
   cross-reference (only after 1–5 are clean).

---

## The Evaluator (rubric)

### Stage A — code checks (deterministic, must be 100%, run by `make check`)

- **A1 Schema** — every fixture event validates; unknown fields rejected; timestamps
  monotonic per file.
- **A2 Sessionizer invariants** — blocks non-overlapping, ordered, traceable to events;
  active + idle + gap = wall clock for every fixture day (exact, not ≈).
- **A3 Hard-case fixtures** — sleep gap, midnight-spanning day, 1-second app flapping,
  all-idle day, and empty day each produce correct, crash-free output.
- **A4 Redaction** — deny-listed fixture app yields `[redacted]` in events, blocks, **and**
  the rendered log; URLs carry no query strings.
- **A5 Reconciliation** — every number in the rendered log (durations, totals, percentages,
  transition times) equals the sessionizer's computation; any LLM-suggested merge that would
  change totals is re-derived by code or rejected.
- **A6 Gap honesty (I7)** — fixture with a 2 h capture hole renders an explicit "no data"
  line; the summarizer prompt forbids interpolation and the test asserts no activity is
  claimed inside the hole.
- **A7 Degraded mode** — with no API key, the full pipeline still renders a complete log
  (rule-based labels) with exit code 0.
- **A8 Hygiene** — no real captured data, no secrets, no `~/.timelog` contents in the repo;
  lint + shellcheck clean; sampler core loop unit-benchmarked (one sample's pure-Python work
  < 50 ms, leaving headroom for the AX/AppleScript calls only measurable on-Mac).

### Stage B — independent LLM judgment (I3; fresh context, fixture + log only)

- **B1 No invention** — every activity in the log traces to events; nothing claimed during
  gaps or idle.
- **B2 Label fidelity** — block labels are reasonable given app/title/URL evidence; ambiguous
  blocks are marked low-confidence rather than confidently mislabeled.
- **B3 Transition accuracy** — timeline transitions match the event stream within ±2 min.
- **B4 Readability** — a reader can answer the three Goal questions from the log alone in
  under a minute (anchor with 2–3 in-rubric pass/fail examples for consistency).
- **B5 Privacy read** — nothing in the log that the redaction config says shouldn't be there.

### Stage C — owner-on-Mac checks (I5; verified only at human gates, via written checklist)

- **C1 Permissions** — `timelog doctor` walks each grant correctly on current macOS.
- **C2 Lifecycle** — daemon auto-starts at login, survives crash (kill it → relaunches),
  sleep/wake, lid close, display dock/undock.
- **C3 Footprint** — Activity Monitor: negligible CPU (~<1% avg), no battery complaint,
  no fan spin attributable to `timelogd`.
- **C4 Zero-touch week** — at least 3 consecutive real workdays with no manual intervention
  and a log generated every evening (I6).
- **C5 Truth test** — owner compares two days' logs against memory/calendar: block labels
  and transitions ring true; gaps are honest.

---

## Stop condition (ALL must hold)

1. **Stage A = 100%** on all fixtures, including at least one owner-exported redacted real day.
2. **Stage B clean** — no open B1–B5 failures across the fixture set.
3. **Stage C green** — owner has checked every C-item, including the 3-day zero-touch run.
4. **No pending-verification queue** — every "owner must re-verify on Mac" note resolved.
5. **One no-regression iteration** — a full pass that changed nothing and broke nothing.
6. **🚦 HUMAN GATE 2** — owner declares the logs useful enough that they actually read them.
   Until then the status is "ready for review", never "done".

---

## Guardrails (runaway + drift protection)

- **G1 Hard cap.** Max ~25 iterations or a token-budget ceiling, whichever first. On hitting
  it: stop, summarize state, surface blockers. Never loop unbounded.
- **G2 Anti-spin.** The **same specific failure id** (e.g. `fixture-sleepgap A6 fail`)
  persisting across 2 consecutive iterations ⇒ stop and ask.
- **G3 No phantom verification (I5).** The loop never marks a Stage-C item done. Reports that
  claim on-Mac behavior without an owner check are themselves a failure.
- **G4 Scope brake.** No screenshots tier, weekly rollups, dashboards, or calendar
  integration before Human Gate 1 passes and priorities 1–5 are clean. The flashcards loop's
  lesson: minimal *effective* dose first.
- **G5 Resumability.** State lives entirely in `eval/report-*.md` + `FEEDBACK.md` + the code.
- **G6 Secrets & privacy.** `ANTHROPIC_API_KEY` only via environment/local config outside the
  repo. Real captured data never committed (A8 enforces). Public-repo rider: this repo is
  public — code and synthetic fixtures only, nothing identifying the owner's work content.

---

## How to run (when ready — not now)

```
/loop Drive the loop in tracker/LOOP.md. Each tick: if tracker/src does not exist, run
Phase 0 (S0.1–S0.5), write eval/report-01.md, and STOP at the pilot instructions for
Human Gate 1 — the owner must install and run it on their Mac; you cannot. Otherwise read
the latest tracker/eval/report-NN.md and tracker/FEEDBACK.md, SELECT the top gap by the
priority order, BUILD/FIX it, run Stage A (make check) then Stage B (a FRESH-CONTEXT
evaluator given only fixture events + the generated log — never the builder's reasoning),
commit and push the branch, and write eval/report-NN.md including any "pending owner
verification" items. Honor invariants I1–I8 (metadata first; numbers from code; honest
gaps; never claim on-Mac behavior) and guardrails G1–G6. Stop and ask at the human gates,
on anti-spin (G2), or the hard cap (G1). When the stop condition holds, post a "ready for
review" summary.
```

Omit the interval for self-pacing; add one (e.g. `/loop 15m ...`) to fix cadence.

---

## Decisions (resolved, with the alternatives that lost)

- **D1 Tracking approach — RESOLVED: metadata-first capture, screenshots as opt-in
  enrichment (I1).** Screenshot-only tracking (the original idea) loses on battery, privacy
  surface, storage, and reliability; window/app/tab metadata answers "what was I doing" for
  the large majority of blocks at near-zero cost. Screenshots earn their place later only
  where metadata is genuinely ambiguous (e.g. "Figma — Untitled").
- **D2 Implementation — RESOLVED: Python 3.11+ with `pyobjc` + `osascript`, LaunchAgents.**
  A Swift menu-bar app would be more native but can't be compiled or tested in this loop's
  Linux container and is harder for the owner to hack on. Python keeps Tier 2/3 testable
  here (I5) and the adapter thin. Revisit only if pilot shows unacceptable footprint (C3).
- **D3 Summarizer — RESOLVED: Claude `claude-opus-4-8`, structured outputs, adaptive
  thinking, streaming; rule-based fallback when no API key (A7).** Cost is one small call
  per day. → **needs owner input only to confirm an `ANTHROPIC_API_KEY` is available on the
  Mac**; the tool installs and works (degraded) without it.
- **D4 Output — RESOLVED: local Markdown per day + `timelog` CLI.** No web dashboard, no
  cloud sync, no accounts (G4). A weekly rollup is the first post-gate enhancement candidate.
- **D5 Cadence — RESOLVED: 15 s sampling; idle threshold 5 min; daily summary 18:30 +
  on-demand.** All configurable in `~/.timelog/config.toml`.
