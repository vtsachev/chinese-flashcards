// Draft extractor: parse a Purple Culture flashcard text layer into {term, pinyin, english}.
// Terms come from "front" sections (CJK, in order). English comes from "back" sections by
// COLUMN position (pdftotext -layout preserves columns). Pinyin is recomputed authoritatively
// by pinyin-pro — never trusted from the noisy text layer. Output is a DRAFT to be vision-verified.
import { pinyin } from 'pinyin-pro';
import { readFileSync } from 'node:fs';

const week = process.argv[2];
const txt = readFileSync(`/tmp/wktext/week${week}.txt`, 'utf8');
const PY = (zh) => pinyin(zh, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' });
const hasPinyin = (s) => /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(s);
const isCJK = (s) => /[一-鿿]/.test(s);
const stripFooter = (s) => s.replace(/Annotated by Purple Culture|Provided by Purple Culture/g, '');

// Split into sections delimited by the Purple Culture banners.
const sections = txt.split(/Provided by Purple Culture/);
const terms = [];           // ordered term list from front sections
const engByPinyin = {};     // canonicalPinyin -> english, from back sections

for (const sec of sections) {
  const body = stripFooter(sec).split('\n').map(l => l.replace(/\s+$/,'')).filter(l => l.trim());
  if (!body.length) continue;
  const back = body.some(hasPinyin);
  if (!back) {
    // FRONT: collect CJK tokens left-to-right, top-to-bottom (skip "write" placeholders)
    for (const line of body)
      for (const tok of line.trim().split(/\s{2,}|\s+/))
        if (isCJK(tok)) terms.push(tok.replace(/[，。、？！]/g,''));
  } else {
    // BACK: pair pinyin row with the english row directly under it, by column.
    for (let i = 0; i < body.length; i++) {
      if (!hasPinyin(body[i])) continue;
      const pys = body[i].trim().split(/\s{2,}/).filter(Boolean);
      const eng = (body[i+1] && !hasPinyin(body[i+1]) && !isCJK(body[i+1])) ? body[i+1].trim().split(/\s{2,}/) : [];
      pys.forEach((p, c) => { if (eng[c]) engByPinyin[p.replace(/\s+/g,'')] = eng[c].trim(); });
    }
  }
}

const seen = new Set();
const records = [];
for (const t of terms) {
  if (seen.has(t)) continue; seen.add(t);
  const py = PY(t);
  const eng = engByPinyin[py.replace(/\s+/g,'')] || '';
  records.push({ term: t, pinyin: py, english: eng, _needsEnglish: !eng });
}
console.log(JSON.stringify({ week: +week, count: records.length, records }, null, 2));
