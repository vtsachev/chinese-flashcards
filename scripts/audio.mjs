// Pre-generate audio assets at build time with macOS `say` (Tingting zh_CN voice),
// convert AIFF -> m4a (AAC) via afconvert. Removes any runtime client-TTS dependency (C1).
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const VOICE = 'Tingting';
const OUT = 'docs/audio';
const TMP = 'build/aiff';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const { records } = JSON.parse(readFileSync('docs/data/characters.json', 'utf8'));

function gen(text, outRel) {
  const out = `docs/${outRel}`;
  if (existsSync(out)) return 'skip';
  const aiff = `${TMP}/tmp.aiff`;
  execFileSync('say', ['-v', VOICE, '-o', aiff, text]);
  execFileSync('afconvert', [aiff, out, '-f', 'm4af', '-d', 'aac']);
  return 'ok';
}

let n = 0;
for (const r of records) {
  gen(r.term, r.audio_term);
  gen(r.example_zh, r.audio_example);
  n++;
  console.log(`  ${r.term}  →  ${r.audio_term} + example`);
}
console.log(`generated audio for ${n} terms (${n * 2} files) in ${OUT}/`);
