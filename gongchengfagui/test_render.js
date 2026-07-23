// test_render.js — 用 app.js 中真实的 parseMd / renderContent / esc 验证渲染逻辑
const fs = require('fs');
const path = require('path');

const appjs = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8');

function extractFn(name) {
  const sig = 'function ' + name + '(';
  const start = appjs.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + name);
  // 找到函数体的第一个 {
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

const escSrc = extractFn('esc');
const parseMdSrc = extractFn('parseMd');
const renderContentSrc = extractFn('renderContent');

// eval 这些纯函数（无 DOM 依赖）
const RE_ART_MD = /^###\s*第[一二三四五六七八九十百零0-9]+[条款]/;
const sandbox = { RE_ART_MD };
const fn = new Function('RE_ART_MD', escSrc + '\n' + parseMdSrc + '\n' + renderContentSrc + '\nreturn {esc, parseMd, renderContent};');
const { esc, parseMd, renderContent } = fn(RE_ART_MD);

const LIB = path.join(__dirname, '法规库');
// 选样本：法律 / 标准规范(可能含表格) / 司法案例
const samples = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md') && samples.length < 6) samples.push(p);
  }
}
walk(LIB);

let ok = true;
for (const f of samples) {
  const md = fs.readFileSync(f, 'utf8');
  let parsed;
  try { parsed = parseMd(md); }
  catch (e) { console.log('PARSE FAIL', f, e.message); ok = false; continue; }
  const artCount = parsed.chapters.reduce((s, c) => s + c.articles.length, 0);
  // 找一个非空 article 渲染
  let rendered = '';
  outer: for (const c of parsed.chapters) for (const a of c.articles) {
    if (a.content && a.content.length > 5) { try { rendered = renderContent(a.content); } catch (e) { console.log('RENDER FAIL', f, e.message); ok = false; } break outer; }
  }
  console.log(path.basename(f).slice(0, 30).padEnd(32), 'chapters=', parsed.chapters.length, 'arts=', artCount, 'topNotes=', parsed.topNotes.length, 'renderedLen=', rendered.length, rendered.includes('<table') ? '[hasTable]' : '');
}
console.log(ok ? 'ALL RENDER TESTS PASSED' : 'SOME TESTS FAILED');
