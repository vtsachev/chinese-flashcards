# Build-and-Evaluate Loop — Sophie's Chinese Character Practice Site (v3)

> This file **defines** the loop. It does not run it. To start it, see "How to run".
> v3 applies the success-probability rubric to v2: it **raises the weakest link** (glyph
> extraction is now triangulated — I8), **splits the data track from the learning-engine track**
> and gates both at the pilot, and **removes the client-TTS dependency** (audio is pre-generated).
> Read "Design invariants" first — they are the reason the rest is shaped the way it is.

## Goal

A **live, online website** where a U.S. grade-3 Chinese-immersion student practices **every**
term from **every** weekly flashcard PDF in `Flash Cards/`. Each term shows:

1. **Term** — the exact Hanzi as taught (single character 字 *or* multi-character word 词).
2. **Pinyin** — tone marks, not numbers (`xué`, never `xue2`); per-syllable for words.
3. **English translation.**
4. **Example** appropriate for grade-3 immersion, in three forms: Chinese (using the term),
   English, and pinyin of the Chinese.

"Done" = full coverage, every field correct **and human-approved**, site reachable on a public URL,
**and the site demonstrably teaches** (the learning mechanisms in "Learning design" function).

> Correct data is **necessary but not sufficient**. A correct, complete flashcard dump is a
> digital worksheet — it displays characters; it does not make a child *memorize* them. The
> deliverable is judged on whether it **causes learning** (see I7 + Stage C), not just on data.

---

## Design invariants (the non-negotiables that keep the loop honest)

- **I1 — The grader is never the student.** The agent that *evaluates* a week runs in a
  **separate context** from the one that *built* it, and is given only the **source PDF and
  the rendered site** — never the builder's `characters.json` or its reasoning. It re-derives
  from source and diffs. (Defeats self-rubber-stamping — v1's #1 flaw.)
- **I2 — Deterministic facts are checked by code, not opinion.** Anything mechanically
  decidable (pinyin lookup, tone-marks-not-numbers, "example contains the term", valid JSON,
  HTTP 200, font coverage) runs as a **script with a pass/fail exit code**. The LLM is used
  *only* for genuine judgment (translation faithfulness, grade-3 fit). Code checks are the
  floor; LLM checks are the ceiling.
- **I3 — Pinyin/English come from a dictionary, not model memory.** Base readings and glosses
  are generated from **`pinyin-pro` (Node) or `pypinyin` (Python) + CC-CEDICT**, with
  **context-aware** segmentation so polyphonic characters (多音字: 行 xíng/háng, 长 cháng/zhǎng,
  的 de/dí/dì) get the right reading. The LLM may *adjust* a gloss for child-friendliness but
  may not *invent* a reading.
- **I4 — A human signs off twice.** Once on the **pilot week** before scaling, once on the
  **full set** before "done". This is a children's learning tool; a confidently-wrong glyph is
  a high-cost error. No fully-autonomous "done".
- **I5 — Verified work is frozen.** A record at `status: validated` is immutable; any change
  requires re-validation and is diffed, so later iterations can't silently regress a good week.
- **I6 — Prove the pipeline on one week before scaling to 31.** Pilot → human gate → scale.
- **I7 — The deliverable must *cause* learning, not just *display* correct data.** Pedagogical
  efficacy (Stage C) is a first-class gate, equal in weight to data correctness. A week with
  perfect data but no working retrieval/spacing/audio is **not** done. (Defeats the "correct but
  useless" trap — the educator-review flaw.)
- **I8 — The weakest link is triangulated, not trusted.** Glyph extraction is the floor on
  P(success), so a term is **never** accepted on one vision pass. Auto-accept only when independent
  signals agree: (a) a **second vision pass** reads the same glyph, (b) the glyph/word is a **real
  CC-CEDICT entry** (a misread usually yields a non-word, caught for free), and (c) where the PDF
  **prints pinyin/English**, tooling-derived pinyin for the read glyph matches the printed pinyin.
  Any disagreement → `needs_human`, never a guess. The high-stakes glyph re-check (Stage B/B1) runs
  on a **stronger model than the builder** for real independence. (The single biggest P(success) lever.)

---

## Learning design (what makes the deliverable actually teach — I7)

"Minimal learning website" = **minimal *effective dose***: the smallest set of evidence-based
mechanisms that actually cause an ~8-year-old to memorize, with **no bloat**. Minimal means no
accounts, leaderboards, or heavy game layers — it does **not** mean passive display.

**MUST-HAVE — these are the mechanisms that cause memory; without them the goal fails:**
- **Active recall, not recognition.** Each card forces a retrieval *attempt* before revealing,
  in **both directions** (character → sound+meaning, and meaning/sound → character).
  *Testing effect (Roediger & Karpicke).*
- **Immediate corrective feedback** on every attempt (right/wrong + correct answer).
- **Spaced repetition.** Simple Leitner scheduler (3–5 boxes) resurfaces *due* cards across
  days; progress persists in `localStorage` (one device, no login). *Spacing effect (Cepeda et al.).*
- **Audio pronunciation** of term + example, tap-to-replay (TTS or recorded). Tones can't be
  learned from pinyin diacritics by a child — *hearing is core, not optional* (resolves D3).
  *Dual-coding; tonal-language acquisition.*
- **Interleaved review** across already-learned weeks, not block-by-week only. *(Rohrer.)*
- **Visible mastery + light streak** so the child sees progress and returns. *Motivation/SDT.*
- **Low-cognitive-load UI** — one big glyph at a time, minimal text, child-readable. Working
  memory at this age ≈ 4 chunks. *Cognitive load; depth of processing.*

**STRONGLY RECOMMENDED — high retention ROI, still light:**
- **Animated stroke order** + optional tracing — motor encoding builds a second engram for the
  character and strengthens recognition.
- **Radical / structure hint or mini-mnemonic** (好 = 女 woman + 子 child → "good"). Hanzi aren't
  arbitrary; a hook beats rote.
- **Tone cue** — pitch-contour mark or tone-color so tones are salient.

**OUT (defer — these violate "minimal"):** accounts/login, multiplayer, leaderboards, ads,
analytics dashboards, heavy gamification.

**Unit (D2, resolved pedagogically):** the **character (字) is the memorization card**, always
shown **inside a word (词) and a sentence** as meaningful context — isolated characters are
harder to retain than ones embedded in meaning. The SRS schedules characters; words/sentences are
scaffolding. Where a week's flashcards are word-based, the word is the card and its component
characters are surfaced. The state model carries both, plus per-card learning state (SRS box,
last-seen, mastery) persisted client-side.

---

## Source of truth

- `Flash Cards/Week N flashcards.pdf` — Weeks 5–35 (31 files; missing weeks like 14 are
  legitimately absent). Glyphs are **image-rendered** → extraction is **vision-based**
  (read each page as an image). No local pdftotext; do not rely on text extraction.
- `Flash Cards/Week 15 note.docx`, `Week 19 note.docx` — fold into their week.

---

## State model (single source of loop truth: `data/characters.json`)

One record per term. The loop is a function of this ledger — it is idempotent and resumable
because every record carries its own status.

```json
{
  "id": "w5-学校",
  "week": 5,
  "term": "学校",
  "unit": "word",                      // "char" | "word"
  "pinyin": "xué xiào",                // from I3 tooling, context-aware
  "pinyin_source": "pinyin-pro",       // tool name, never "model"
  "english": "school",
  "example_zh": "我们的学校很大。",
  "example_en": "Our school is very big.",
  "example_pinyin": "Wǒmen de xuéxiào hěn dà.",
  "example_source": "generated",       // examples are expected to be generated
  "status": "extracted",               // extracted → validated → published
  "needs_human": false,                // true when source is illegible/ambiguous
  "checksum": "…",                     // set when validated; frozen (I5)
  "eval_notes": ""
}
```

`status` ladder: **extracted** (built, unchecked) → **validated** (passed every gate, frozen)
→ **published** (live on the site and re-checked in place). A week is "done" only when all its
records are `published`.

---

## Loop structure

**Two tracks, not one.** *Track D (data)* = per-week extraction/validation — this is the iteration
body. *Track L (learning engine)* = the SRS scheduler, active-recall quiz (both directions),
immediate feedback, audio playback, interleaving, and progress — **built once** as data-agnostic
site infrastructure, not per week. Track L is built and **Stage-C-gated during the pilot**, so the
whole concept (correct data *and* real pedagogy) is proven on one week before investing in 31.

### Phase 0 — Setup + Pilot (runs once; gated)

- **S0.1 Inventory.** Enumerate the PDFs → master week list. This is what coverage is measured against.
- **S0.2 Tooling.** Install the deterministic pinyin/dictionary stack (`npm i pinyin-pro` or
  `pip install pypinyin`, + a CC-CEDICT load). Write `scripts/check.mjs` (or `.py`) implementing
  every **I2 code check** as exit-code tests. *No vision/LLM work proceeds until these run.*
- **S0.3 Deploy decision (resolve BEFORE building).** The repo is **private**, so free GitHub
  Pages won't serve it. Pick one and record it here: **(a)** make the repo public (kid's
  flashcards — confirm with owner), **(b)** Cloudflare Pages / Netlify / Vercel free tier
  (serves from a private repo). Wire deploy so each iteration can publish. → **needs owner input.**
- **S0.4 Word-vs-term decision.** Inspect a PDF: are flashcards single 字 or words 词 (or mixed)?
  Set `unit` handling accordingly. → record the answer; affects schema + the "example contains
  term" check.
- **S0.5 Build the learning engine (Track L).** Not a display — implement the MUST-HAVE
  mechanisms: active-recall quiz (both directions), immediate feedback, Leitner SRS persisted in
  `localStorage`, interleaved review, visible progress, plus browse-by-week and search. **Bundle
  Noto Sans SC** (tofu impossible) and **pre-generate audio assets at build time** (no client-TTS
  dependency). The engine is data-agnostic: it renders whatever `characters.json` holds.
- **S0.6 PILOT — Week 5 through BOTH tracks, end to end.** Triangulated extraction (I8) →
  tool-generate pinyin/English → generate examples → load into the Track-L engine → run the **full
  Evaluator: Stage A + Stage B + Stage C** (incl. the I1 independent pass and the simulated-learner
  pass). Produce `eval/pilot-week5.md`. This proves data *and* pedagogy on one week.
- **🚦 HUMAN GATE 1 (I4):** Owner reviews `eval/pilot-week5.md` + the live pilot against explicit
  acceptance criteria: **Week 5 passes Stage A + B + C**, the triangulation `needs_human` rate is
  low, and the owner confirms the *learning experience* feels right for their child. Only on
  approval does the loop scale. **Stop and ask. Do not auto-proceed.**

### Iteration body — one **week** per tick, repeat until stop condition

- **B1. SELECT.** From `data/characters.json` + the latest `eval/report-*.md`, pick the
  highest-priority unit of work via the **priority order** (below). Default unit = one week.
- **B2. BUILD/FIX.** Bring that week to fully-`validated`: extract any missing terms, fill
  fields from I3 tooling, generate/repair examples flagged by the last eval. Respect I5 (don't
  touch already-`validated` records unless the eval named them; if you do, re-validate + diff).
- **B3. EVALUATE (two-stage).**
  - *Stage A — code (I2):* run `scripts/check.mjs` over the week. Any failure → fix, don't advance.
  - *Stage B — independent LLM (I1):* spawn a **fresh-context evaluator** given only the week's
    **PDF pages + the live site**. It re-extracts, diffs vs the published site, and judges the
    subjective gates. It writes `eval/report-NN.md`.
- **B4. PROMOTE.** Records passing both stages → `status: validated` (checksum frozen) → deploy
  → re-check in place → `status: published`.
- **B5. DECIDE.** Stop condition met? → Human Gate 2. Else record the top remaining gap → B1.

### Priority order for "highest-priority gap" (operational, not vibes)

1. **Coverage** — a week or term missing entirely (you can't fix what isn't there).
2. **Field-missing** — a `published`/`validated` record lacking a required field.
3. **Correctness fail** — a code-check or independent-eval failure on an existing field.
4. **Technical** — site not live, render/practice/search broken.
5. **Learning efficacy (Stage C)** — a must-have mechanism (recall, spacing, audio, feedback,
   interleaving, progress) missing or broken. **Core, not polish** — ranks above enhancement.
6. **Enhancement** — recommended-tier extras (stroke order, mnemonics, tone cues) and visual
   polish (only after 1–5 are clean).

---

## The Evaluator (rubric)

### Stage A — code checks (deterministic, must be 100%, run by `scripts/check.mjs`)
- **A1 Schema** — every record valid against the state model; no null required fields.
- **A2 Tone marks** — pinyin matches a tone-mark regex; **rejects** tone numbers / missing tones.
- **A3 Pinyin ↔ term** — recomputed from I3 tooling equals stored `pinyin` (context-aware;
  polyphonic terms compared against the segmented reading). Mismatch = fail.
- **A4 Example contains term** — `example_zh` literally contains `term`.
- **A5 Example pinyin ↔ example_zh** — recompute pinyin of `example_zh`, compare to `example_pinyin`.
- **A6 Coverage counts** — terms-per-week in JSON **exactly equals** the count from the PDF's card
  structure *and* the independent pass. A JSON *surplus* = a hallucinated term (which `≥` would
  silently pass); a *shortfall* = a miss. Mismatch either direction = fail.
- **A7 Live** — public URL returns 200; the week's page lists all its terms.
- **A8 Render** — screenshot via Claude Preview MCP; assert the bundled CJK font is applied
  (no fallback / no tofu) and glyphs are present in the DOM.
- **A9 Vocabulary level** — tokenize `example_zh`; every word is within an agreed grade-appropriate
  frequency band (allow-list = taught terms so far + a beginner word list). Out-of-band vocab fails
  here — turning part of "grade-3 fit" from opinion into a deterministic check.

### Stage B — independent LLM judgment (I1; fresh context, source-only)
- **B1 Glyph fidelity** — a **stronger model than the builder** re-extracts the glyph from the PDF
  and matches it against the published glyph (model diversity = real independence, not just fresh
  context; catches vision errors the builder baked in). Cross-checked against I8 triangulation.
- **B2 English faithfulness** — translation correct for the term *as taught at this level*.
- **B3 Example translation** — `example_en` faithfully matches `example_zh`.
- **B4 Grade-3 fit** — vocabulary is pre-screened by **A9** (code); B4 judges only what code can't:
  naturalness, topic appropriateness, sentence length, concrete everyday context. (Anchor with 2–3
  in-rubric pass/fail examples so the judgment is consistent run-to-run.)
- **B5 Ambiguity escape hatch** — if a source glyph is genuinely illegible, set
  `needs_human: true` rather than guessing. These surface to Human Gate 2; they do **not**
  silently pass.

### Stage C — learning-efficacy gates (I7; the artifact must teach, not just display)
Mostly functional checks, plus one judgment gate and one **simulated-learner pass** (the
educational analog of I1: a fresh agent role-playing a 3rd grader actually uses the site).
- **C1 Audio** — every term and example plays from a **pre-generated, bundled audio file**
  (build-time TTS), **not** runtime browser SpeechSynthesis — the child's device may lack a zh-CN
  voice. Check the asset exists and plays.
- **C2 Active recall** — the quiz forces a retrieval attempt before revealing; **both**
  directions exist (recognize *and* produce).
- **C3 Feedback** — every attempt yields immediate right/wrong + the correct answer.
- **C4 Spaced repetition** — a due-card scheduler advances and **persists across sessions**
  (simulate two sessions; assert the due-set changes correctly and progress survives reload).
- **C5 Interleaving** — review mixes terms across learned weeks, not one week in isolation.
- **C6 Progress** — mastery count / streak is visible and persisted.
- **C7 Cognitive load (judgment + sim-learner)** — one card at a time, big glyph, minimal text,
  age-appropriate; the simulated 3rd-grader completes a recall *and* gets feedback in **≤3 taps**
  without confusion. Fail if the UI is cluttered or a child couldn't self-navigate.
- **C8 Stroke order / mnemonic** — present if in the agreed scope (recommended tier).

### Scoring & progress signals (so anti-spin doesn't misfire)
Track per iteration, in `eval/report-NN.md`:
- **Coverage %** (weeks done / weeks total; terms published / terms total).
- **Per-gate pass counts** (A1–A8, B1–B5) — so an infra iteration that moves no character
  score still shows progress (e.g. A7/A8 flipping green).
- **Open-gap list**, ranked by the priority order, with the single next action.
- **Weakest-link / confidence read** — the I8 triangulation outcome (e.g. "12/13 terms auto-confirmed
  by 3 agreeing signals, 1 → needs_human"). This is the loop's honest P(success) signal: a high
  `needs_human` rate means the extraction floor is shaky and the human should look *now*, not at Gate 2.

---

## Stop condition (ALL must hold)

1. **Coverage = 100%** — every week, every term `published` (A6 satisfied per week).
2. **Stage A = 100%** — all code checks green for all records.
3. **Stage B clean** — no open B1–B4 failures; every `needs_human` record resolved.
4. **Technical green** — A7/A8 pass on desktop + mobile widths.
5. **Stage C green (I7)** — the must-have learning mechanisms (C1–C7) function and the
   simulated-learner pass succeeds. A correct-but-passive site is **not** done.
6. **One no-regression iteration** — a full pass that changed nothing and broke nothing
   (verified via the I5 checksums: no `validated` record's checksum moved unexpectedly).
7. **🚦 HUMAN GATE 2 (I4)** — owner signs off on the full set, **including a real child trying
   the site** (does Sophie actually learn/enjoy it?). Until then status is "ready for review",
   never "done".

---

## Guardrails (runaway + drift protection)

- **G1 Hard cap.** Max ~40 iterations (≈ pilot + 31 weeks + margin) OR a token budget ceiling,
  whichever first. On hitting it: stop, summarize state, surface blockers. Never loop unbounded.
- **G2 Anti-spin (redefined).** If the **same specific failure id** (e.g. `w27-行 A3 fail`)
  persists across **2 consecutive** iterations, stop and ask — that's a stuck signal, distinct
  from "global score flat", which is fine during infra work.
- **G3 No silent truncation.** If a week is partially done or a glyph is skipped, it must appear
  in the open-gap list and as `needs_human`/un-`published` — never quietly dropped so the report
  reads "complete".
- **G4 Regression diff.** Each deploy diffs `characters.json`; any change to a `validated`
  record without a matching re-validation entry is a failure, not a silent overwrite (I5).
- **G5 Resumability.** State lives entirely in `data/characters.json` + `eval/report-*.md`. An
  interrupted iteration resumes by reading status; no work is repeated and none is skipped.
- **G6 Privacy before public deploy.** Going **public** (D1) makes content world-readable and
  indexable. Before any deploy, scrub identifying info: **no child's name, school, teacher, or
  schedule** in the site or repo — use a generic title ("Chinese Flashcards", not a child's name).
  Source PDFs stay out of the published site; only derived flashcard data ships. If public exposure
  is unwanted, switch to Netlify/Cloudflare serving from a **private** source instead.

---

## How to run (when ready — not now)

All decisions are resolved (D1–D3 below). To launch:

```
/loop Drive the loop in LOOP.md. Each tick: if data/characters.json is missing, run Phase 0
(setup + Week-5 pilot) and STOP at Human Gate 1. Otherwise read the latest eval/report-*.md,
SELECT the top gap by the priority order (default: one week), BUILD/FIX it, run Stage A
(scripts/check.mjs) then Stage B (a FRESH-CONTEXT evaluator agent given only the week's PDF
pages + the live site — never characters.json), PROMOTE passing records to validated/published,
and write eval/report-NN.md. Honor invariants I1–I8 (triangulate extraction; pre-generated audio;
build the Track-L learning engine, not a display) and guardrails G1–G6. Stop and ask at the two
human gates, on anti-spin (G2), or on the hard cap (G1). When the stop condition holds, post the
live URL and a "ready for review" summary.
```

Omit the interval for self-pacing; add one (e.g. `/loop 15m ...`) to fix cadence.

---

## Decisions (resolved)

- **D1 Deploy target — RESOLVED: make the repo public**, deploy via free GitHub Pages. (S0.3)
  **Privacy rider (G6):** deployed content carries no child name/school/schedule and uses a generic
  title; source PDFs are not published. Prefer Netlify/Cloudflare-from-private if public exposure is unwanted.
- **D2 Unit — RESOLVED (pedagogically): the character 字 is the memorization card, shown inside
  a word 词 + sentence as context.** Schema/SRS handle both; word-based weeks card the word and
  surface its characters. (see Learning design.)
- **D3 Audio — RESOLVED: in scope and CORE (must-have), not an enhancement.** A child can't learn
  tones from pinyin diacritics alone; hearing is required. (see Learning design.)
