/* 全页面 import 符号核对 + 资源引用检查 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/github/homepage/Chears77.github.io/midianxunji';

const pages = fs.readdirSync(path.join(ROOT, 'js/pages')).filter(f => f.endsWith('.js'));
let problems = 0;

for (const pg of pages) {
  const src = fs.readFileSync(path.join(ROOT, 'js/pages', pg), 'utf8');
  const imports = [];
  const re = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
    imports.push({ mod: m[2], names });
  }
  const reD = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = reD.exec(src))) imports.push({ mod: m[2], names: [m[1]], def: true });

  for (const imp of imports) {
    let p = imp.mod;
    if (p.startsWith('../')) p = 'js/' + p.slice(3);
    else if (p.startsWith('./')) p = 'js/pages/' + p.slice(2);
    else if (p.startsWith('/')) p = p.slice(1);
    const file = p.endsWith('.js') ? p : p + '.js';
    if (!fs.existsSync(path.join(ROOT, file))) { console.log('❌ ' + pg + ' 模块不存在:', imp.mod); problems++; continue; }
    const mod = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const n of imp.names) {
      const has = new RegExp('export\\s+(const|let|var|function|class|async\\s+function)\\s+' + n + '\\b').test(mod)
        || new RegExp('export\\s*\\{[^}]*\\b' + n + '\\b').test(mod)
        || (imp.def && n === imp.names[0] && /export\s+default/.test(mod));
      if (!has) { console.log('❌ ' + pg + ' -> ' + imp.mod + ' 缺导出: ' + n); problems++; }
    }
  }
}
console.log(problems === 0 ? '✅ ' + pages.length + ' 个页面 import 符号全部齐全' : '共 ' + problems + ' 个问题');

// 检查 wxml 模板里引用的 images/ 资源是否存在（抽查 html/js 中的 images/ 引用）
const allSrc = pages.map(p => fs.readFileSync(path.join(ROOT, 'js/pages', p), 'utf8')).join('\n')
  + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const imgRefs = new Set();
const reImg = /images\/[\w\-./]+\.png/g;
let mm;
while ((mm = reImg.exec(allSrc))) imgRefs.add(mm[0]);
let missImg = 0;
for (const r of imgRefs) {
  if (!fs.existsSync(path.join(ROOT, r))) { console.log('❌ 图片资源缺失:', r); missImg++; }
}
console.log(missImg === 0 ? '✅ 代码引用的 ' + imgRefs.size + ' 个图片资源全部存在' : '缺 ' + missImg + ' 个图片');
