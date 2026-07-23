// verify_all.js — 用 app.js 中真实 parseMd 解析全部 503 个 md，统计是否有内容丢失
const fs = require('fs');
const path = require('path');

const appjs = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8');
function extractFn(name) {
  const sig = 'function ' + name + '(';
  const start = appjs.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + name);
  let i = appjs.indexOf('{', start);
  let depth = 0, inStr = null, escaped = false;
  for (let j = i; j < appjs.length; j++) {
    const c = appjs[j];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return appjs.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const parseMdSrc = extractFn('parseMd');
const RE_ART_MD = /^###\s*第[一二三四五六七八九十百零0-9]+[条款]/;
const fn = new Function('RE_ART_MD', parseMdSrc + '\nreturn {parseMd};');
const { parseMd } = fn(RE_ART_MD);

const LIB = path.join(__dirname, '法规库');
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) files.push(p);
  }
}
walk(LIB);

let zeroArt = [], zeroCh = [], fail = [];
let totalArts = 0, totalChapters = 0;
for (const f of files) {
  let parsed;
  try { parsed = parseMd(fs.readFileSync(f, 'utf8')); }
  catch (e) { fail.push([f, e.message]); continue; }
  const arts = parsed.chapters.reduce((s, c) => s + c.articles.length, 0);
  totalArts += arts;
  totalChapters += parsed.chapters.length;
  if (parsed.chapters.length === 0) zeroCh.push(f);
  if (arts === 0) zeroArt.push(f);
}
console.log('files parsed :', files.length);
console.log('total chapters:', totalChapters);
console.log('total articles:', totalArts);
console.log('parse failures:', fail.length);
fail.forEach(([f, m]) => console.log('  FAIL', path.basename(f), m));
console.log('zero-chapter  :', zeroCh.length);
zeroCh.forEach(f => console.log('  ZEROCH', path.basename(f)));
console.log('zero-article  :', zeroArt.length);
zeroArt.forEach(f => console.log('  ZEROART', path.basename(f)));
console.log((zeroArt.length === 0 && fail.length === 0) ? 'ALL OK' : 'NEEDS REVIEW');
