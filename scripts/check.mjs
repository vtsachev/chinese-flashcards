// Stage A — deterministic checks (invariant I2). Exit code 0 = all pass.
// A1 schema · A2 tone marks · A3 pinyin↔term · A4 example contains term
// A5 example-pinyin↔example_zh · A6 coverage counts · A9 vocab/length proxy
import { pinyin } from 'pinyin-pro';
import { readFileSync, existsSync } from 'node:fs';

// Independently-verified term counts per week (from the I8 vision pass over the PDF).
const VERIFIED_COUNTS = { 5:8, 6:10, 7:10, 8:12, 9:14, 10:14, 11:14, 12:14, 13:14,
  15:19, 16:15, 17:18, 18:9, 19:8, 20:13, 21:7, 22:21, 23:17, 24:20, 25:17, 26:16,
  27:16, 28:17, 29:15, 30:15, 31:16, 32:17, 33:18, 34:18, 35:14 };

// Same verified overrides as scripts/build.mjs (keep in sync).
const PINYIN_FIX = { '湖泊':'hú pō', '时候':'shí hou', '困难':'kùn nan', '明白':'míng bai', '厉害':'lì hai' };
const rawPy = (zh) => pinyin(zh, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' });
const WRONG2RIGHT = Object.fromEntries(Object.entries(PINYIN_FIX).map(([w, r]) => [rawPy(w), r]));
const fixEx = (s) => { for (const [bad, good] of Object.entries(WRONG2RIGHT)) s = s.split(bad).join(good); return s; };
const py   = (zh) => fixEx(rawPy(zh));
const pyTerm = (t) => PINYIN_FIX[t] || rawPy(t);
const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüa-z]/i;     // pinyin should carry tone marks, never digits
const hasDigit = (s) => /[0-9]/.test(s);

const { records } = JSON.parse(readFileSync('docs/data/characters.json', 'utf8'));
let fails = [];
const REQ = ['id','week','term','pinyin','english','example_zh','example_en','example_pinyin','audio_term','audio_example'];

for (const r of records) {
  const tag = r.id || JSON.stringify(r);
  // A1 schema
  for (const k of REQ) if (r[k] == null || r[k] === '') fails.push(`A1 ${tag}: missing ${k}`);
  // A2 tone marks (no digits, has letters)
  if (hasDigit(r.pinyin)) fails.push(`A2 ${tag}: pinyin has digits "${r.pinyin}"`);
  if (hasDigit(r.example_pinyin)) fails.push(`A2 ${tag}: example_pinyin has digits`);
  if (!TONE.test(r.pinyin)) fails.push(`A2 ${tag}: pinyin not tone-marked`);
  // A3 pinyin == tool(term) (+ verified overrides)
  const p = pyTerm(r.term);
  if (p !== r.pinyin) fails.push(`A3 ${tag}: pinyin "${r.pinyin}" != tool "${p}"`);
  // A4 example contains term
  if (!r.example_zh.includes(r.term)) fails.push(`A4 ${tag}: example_zh missing term`);
  // A5 example_pinyin == tool(example_zh)
  const ep = py(r.example_zh);
  if (ep !== r.example_pinyin) fails.push(`A5 ${tag}: example_pinyin != tool("${ep}")`);
  // A9 vocab/length proxy (grade-3: short, concrete). Strengthen later with a frequency band.
  const len = [...r.example_zh.replace(/[，。？！、]/g,'')].length;
  if (len > 12) fails.push(`A9 ${tag}: example too long (${len} chars)`);
  // audio assets present
  for (const a of [r.audio_term, r.audio_example]) if (!existsSync(`docs/${a}`)) fails.push(`assets ${tag}: missing ${a}`);
}
// A6 coverage counts
const perWeek = {};
for (const r of records) perWeek[r.week] = (perWeek[r.week]||0)+1;
for (const [w, n] of Object.entries(VERIFIED_COUNTS))
  if (perWeek[w] !== n) fails.push(`A6 week ${w}: JSON has ${perWeek[w]||0}, verified ${n}`);

if (fails.length) { console.error(`STAGE A FAIL (${fails.length}):`); for (const f of fails) console.error('  ✗ '+f); process.exit(1); }
console.log(`STAGE A PASS — ${records.length} records, all of A1–A6 + A9 + assets green.`);
