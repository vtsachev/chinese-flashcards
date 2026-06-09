# Loop Report — Weeks 6–13 (batch 2)

**Live:** https://tsachev.us/chinese-flashcards/ · **Coverage: 9 / 30 weeks · 110 terms**

## What ran
Extraction used the PDF **text layer** (all weeks have one) for the term list + English, with
**pinyin computed by pinyin-pro**. Built → audio (Tingting zh-CN) → Stage A → deployed →
**Stage B independent Opus vision evaluators** (4 agents, 2 weeks each, source-only).

## Stage A (code): PASS — 110 records, A1–A6 + A9 + assets green.

## Stage B (independent vision): PASS after fixes — and it earned its keep.
Glyphs, term counts, and **all 110 example sentences** verified correct, grade-3 appropriate,
each containing its term. The evaluators caught **pinyin defects Stage A structurally could not**
(Stage A only checks pinyin-pro *consistency*, not *correctness*):

| Fix | Was | Now | Why |
|---|---|---|---|
| 湖泊 (lake) | hú bó | **hú pō** | pinyin-pro mis-reads the polyphone 泊 |
| 时候 | shí hòu | **shí hou** | neutral tone (standard + card) |
| 困难 | kùn nán | **kùn nan** | neutral tone |
| 明白 | míng bái | **míng bai** | neutral tone |
| 厉害 | lì hài | **lì hai** | neutral tone |
| 得 particle | huà dé | (reworded) | structural 得 is neutral "de"; reworded the one example |

Fix shipped as a **verified-override layer** in `build.mjs` + `check.mjs` (kept in sync). This
list will grow as later weeks surface more pinyin-pro edge cases — exactly the curated correction
layer the loop is meant to accumulate.

## Curriculum note
The vocabulary spirals — some words recur across weeks (秘密, 困难, 神经元, 地球…). These are kept
as distinct per-week cards, mirroring the worksheets (and good for spaced review).

## Remaining: 21 weeks (15–35; week 14 absent) — needs vision extraction
Weeks 15+ **mix vocabulary words with single-character writing-practice cards** (e.g. Week 16's
trailing 特/别/到/样, Week 30's 自传 where the astronomy lesson means 自转). The text-layer parse
over-counts and mis-pairs these, so each remaining week needs a **vision pass to separate the real
vocab set from handwriting-practice characters** before building — the same A→B→C pipeline,
one week per iteration, per the loop's design (hard cap ~40 iterations).

## needs_human / open
- None outstanding for weeks 5–13.
- Watch item for later weeks: source cards may contain teacher typos (the 自传/自转 case) — the
  independent vision pass will flag these rather than ship them.
