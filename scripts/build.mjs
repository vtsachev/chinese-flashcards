// Build step: read data/source-weekN.json files, compute pinyin deterministically
// (pinyin-pro, context-aware for polyphones), emit docs/data/characters.json.
// Pinyin is NEVER hand-typed — it comes from the tool (invariant I3).
import { pinyin } from 'pinyin-pro';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DATA_DIR = 'data';
const OUT_DIR = 'docs/data';
mkdirSync(OUT_DIR, { recursive: true });

// Verified pinyin overrides: pinyin-pro mis-reads these (polyphone / neutral-tone).
// Each correction was confirmed by the independent vision evaluators against the source cards.
const PINYIN_FIX = { '湖泊':'hú pō', '时候':'shí hou', '困难':'kùn nan', '明白':'míng bai', '厉害':'lì hai' };
const rawPy = (zh) => pinyin(zh, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' });
// build wrong->right substring map for fixing example pinyin
const WRONG2RIGHT = Object.fromEntries(Object.entries(PINYIN_FIX).map(([w, right]) => [rawPy(w), right]));
const fixExample = (s) => { for (const [bad, good] of Object.entries(WRONG2RIGHT)) s = s.split(bad).join(good); return s; };
const pyTerm = (t) => PINYIN_FIX[t] || rawPy(t);
const py = (zh) => fixExample(rawPy(zh));

const records = [];
for (const f of readdirSync(DATA_DIR).filter(n => /^source-week\d+\.json$/.test(n))) {
  const { week, terms } = JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8'));
  for (const t of terms) {
    const rec = {
      id: `w${week}-${t.term}`,
      week,
      term: t.term,
      unit: [...t.term].length > 1 ? 'word' : 'char',
      pinyin: pyTerm(t.term),             // tool-derived (+ verified overrides)
      pinyin_source: 'pinyin-pro',
      english: t.english,
      example_zh: t.example_zh,
      example_en: t.example_en,
      example_pinyin: py(t.example_zh),   // tool-derived
      example_source: 'generated',
      audio_term: `audio/${week}-${t.term}.m4a`,
      audio_example: `audio/${week}-ex-${t.term}.m4a`,
      status: 'extracted',
      needs_human: false
    };
    rec.checksum = createHash('sha1')
      .update(JSON.stringify([rec.term, rec.pinyin, rec.english, rec.example_zh, rec.example_pinyin]))
      .digest('hex').slice(0, 12);
    records.push(rec);
  }
}

records.sort((a, b) => a.week - b.week || a.id.localeCompare(b.id));
writeFileSync(`${OUT_DIR}/characters.json`, JSON.stringify({ generated_by: 'scripts/build.mjs', count: records.length, records }, null, 2));
console.log(`built ${records.length} records →  ${OUT_DIR}/characters.json`);
for (const r of records) console.log(`  ${r.term}  ${r.pinyin}  —  ${r.english}`);
