# Pilot Evaluation — Week 5  (🚦 HUMAN GATE 1)

**Live site:** https://tsachev.us/chinese-flashcards/
**Repo (public):** https://github.com/vtsachev/chinese-flashcards
**Scope:** 8 Week-5 word-terms (词), both data + learning-engine tracks, end to end.

---

## Result: ✅ PASS on all gates — ready for your review to authorize scaling to Weeks 6–35.

### I8 triangulation (the extraction floor)
The Week 5 PDF carries a **text layer** (Purple Culture annotations), so extraction had **four** agreeing signals, not one:
1. Vision read of the rendered glyphs (build/week5-1.png)
2. Printed pinyin + English on the card (text layer)
3. `pinyin-pro` recomputed pinyin
4. Independent Opus re-extraction (Stage B)

**`needs_human` rate: 0/8.** All terms auto-confirmed. The floor is solid.

### Stage A — deterministic code checks (`scripts/check.mjs`)
`STAGE A PASS — 8 records, all of A1–A6 + A9 + assets green.`
- A1 schema · A2 tone marks (no digits) · A3 pinyin == pinyin-pro(term) · A4 example contains term ·
  A5 example_pinyin == pinyin-pro(example_zh) · A6 count == 8 (verified) · A9 length proxy · audio assets present.

### Stage B — independent evaluation (fresh context, Opus, source-only)
Re-derived all 8 terms from the PDF images and diffed against the live JSON. **Verdict: PASS, no defects.**
Glyphs ✓, pinyin+tones ✓, English ✓, all 8 examples (contains-term, pinyin, translation, grade-3 fit) ✓.

### Stage C — learning-efficacy (verified live in-browser)
| Gate | Mechanism | Status |
|---|---|---|
| C1 | Audio — pre-generated zh-CN (Tingting) m4a, tap-to-play | ✓ |
| C2 | Active recall, **both** directions (recognize 字→meaning; produce meaning→字) | ✓ |
| C3 | Immediate feedback ("Correct! 🌟" / shows answer) | ✓ |
| C4 | Leitner SRS, persists across reload (verified: card advanced box 1→2, due recomputed) | ✓ |
| C5 | Interleaving (shuffled due queue across the week) | ✓ |
| C6 | Progress + 🔥 streak, persisted | ✓ |
| C7 | One big glyph, minimal text, large tap targets — child-navigable | ✓ |

### Technical
A7 live (200 on page, data, audio) ✓ · A8 render: Noto Sans SC bundled, no tofu ✓ · mobile-width layout ✓.

### Privacy (G6)
Repo renamed `flash-cards-sophie` → **`chinese-flashcards`**; site title generic ("🐼 Chinese Flashcards").
No child name/school/schedule in the published site. Source PDFs are not served by the site.
*(The account's custom domain is tsachev.us — family surname. Say the word if you'd rather host elsewhere.)*

---

## What needs YOUR decision before scaling
1. **Approve the learning experience.** Open the live site, try a few cards (Practice → Show answer → Got it / Again; tap 🔊). Does this feel right for your daughter? This is the human judgment no automated gate can make.
2. **Example sentences** are AI-generated (the PDFs have none). Week 5's were independently verified correct, but you may want to skim each week's as we go — tell me your comfort level (spot-check vs. review every week).
3. **Audio voice** is macOS "Tingting" (Mainland Mandarin, female). Fine? Or prefer a different voice.

## Known polish items (non-blocking, queued)
- Example pinyin shows a space before the full-width period (`qíng tiān 。`) — cosmetic, will strip.
- "完全" example English is slightly stilted ("…completely") — faithful but could read more naturally.
- **Recommended-tier** features not yet built (deferred until data is complete): animated stroke order, radical mnemonics, tone-color cues.
- A9 vocab check is currently a length proxy; will strengthen to a real grade-frequency band when scaling.

## If you approve
The loop scales one week per iteration (Weeks 6–35), each through the same Stage A+B+C gates, with the triangulation `needs_human` rate reported each time. Larger/scanned PDFs (e.g. Weeks 29–34) may lack a clean text layer and push more terms to `needs_human` — those will surface for you rather than be guessed.
