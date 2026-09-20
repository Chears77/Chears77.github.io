/* =========================================================================
 * seo_build.js — 工建法研工程建设法规库 · 静态化 SEO 预渲染脚本
 * -------------------------------------------------------------------------
 * 作用：把 SPA 的 588 部法规正文 + 12 个层级 landing 页预渲染为真实 HTML，
 *       每页带独立 <title>/description/OG/JSON-LD/面包屑/全文，
 *       并生成 sitemap.xml + robots.txt，使 Google/Bing 可按关键词收录。
 *
 * 复用 app.js 的纯渲染函数（parseMd / renderContent / esc / RE_ART_MD），
 * 保证静态页与网页版排版一致（共用 assets/app.css）。
 *
 * 用法：node seo_build.js
 * 部署：生成 law/ level/ sitemap.xml robots.txt 后，手动复制 3第二版→gongchengfagui 并 push。
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BASE = 'https://chears77.github.io/gongchengfagui/'; // GitHub Pages 项目站点基址

/* ---------- 12 层级 → ASCII slug（避开中文路径坑） ---------- */
const LEVEL_SLUG = {
  '法律': 'falv',
  '司法解释': 'sifa-jieshi',
  '中央行政法规': 'yang-gui',
  '中央部门规章': 'bumen-gui',
  '中央规范性文件': 'guifan-wenjian',
  '地方行政法规': 'difang-fagui',
  '地方规章': 'difang-zhangcheng',
  '地方规范性文件': 'difang-wenjian',
  '标准规范': 'biaozhun',
  '司法案例': 'sifa-anli',
  '行政案例': 'xingzheng-anli',
  '政策解读': 'zhengce-jiedu'
};

/* ===================== 移植自 app.js 的纯渲染函数 ===================== */
const RE_ART_MD = /^###\s*第[一二三四五六七八九十百零0-9]+[条款]/;
function esc(s){ return (s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function parseMd(md){
  const lines = md.split(/\r?\n/);
  let i = 0;
  if (lines[0] && lines[0].trim() === '---'){ for (i = 1; i < lines.length; i++){ if (lines[i].trim() === '---'){ i++; break; } } }
  const chapters = []; let curCh = null; let curArt = null; let buf = []; const topNotes = []; let inBody = false;
  function pushLead(){ if (curArt) return; if (buf.length){ const lead = buf.join('\n').trim(); if (lead){ if (!curCh) curCh = {title:'（未分章）', articles:[]}; curCh.articles.push({article:'', content:lead, section:true}); } buf = []; } }
  function flushArt(){ pushLead(); if (curArt){ curArt.content = buf.join('\n').trim(); curCh.articles.push(curArt); curArt = null; } buf = []; }
  function flushCh(){ if (curArt) flushArt(); else pushLead(); if (curCh) chapters.push(curCh); curCh = null; buf = []; }
  for (; i < lines.length; i++){
    let line = lines[i];
    if (line.startsWith('>')){ const t = line.replace(/^>\s?/, ''); if (!inBody) topNotes.push(t); else if (curArt !== null) buf.push(line); continue; }
    if (line.startsWith('###')){ inBody = true; const m = line.trim(); flushArt(); if (!curCh) curCh = {title:'（未分章）', articles:[]}; curArt = {article:m.slice(3).trim(), content:'', section: !RE_ART_MD.test(m)}; continue; }
    if (line.startsWith('##')){ inBody = true; flushCh(); curCh = {title:line.trim().slice(2).trim(), articles:[]}; continue; }
    if (line.startsWith('#')){ continue; }
    buf.push(line);
  }
  flushCh();
  return {chapters: chapters, topNotes: topNotes};
}

function renderContent(text){
  const raw = (text||'').trim();
  if (!raw) return '';
  const itemRe = /^([（(]\d+[）)]|\d+[.、])\s*(.*)$/;
  const rowSegRe = /\|(?:[^|\n]*\|)+/g;
  const isDivider = s => /^\s*\|[\s:|-]+\|?\s*$/.test(s) && s.replace(/\|/g,'').replace(/[\s:|-]/g,'').length === 0;
  const splitRow = r => r.replace(/^\|/, '').replace(/\|$/, '') /* 去首尾| */.split('|').map(c => c.trim());
  const mergeTableRows = (rows) => {
    if (rows.length < 3 || !isDivider(rows[1])) return null;
    const hc = splitRow(rows[0]).length, dc = splitRow(rows[1]).length;
    if (hc !== dc) return null;
    return {head: splitRow(rows[0]), body: rows.slice(2).map(splitRow)};
  };
  let html = '', inList = false;
  const flush = () => { if (inList){ html += '</ol>'; inList = false; } };
  const lines = raw.split('\n'); const lineStart = []; let acc = 0;
  lines.forEach(l => { lineStart.push(acc); acc += l.length + 1; });
  let mm, rowSegs = [];
  while ((mm = rowSegRe.exec(raw)) !== null){ rowSegs.push([mm.index, mm.index + mm[0].length, mm[0]]); }
  const rowOf = pos => { let lo = 0, hi = lineStart.length - 1; while (lo < hi){ const mid = (lo + hi + 1) >> 1; if (lineStart[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  let i = 0, lastEnd = 0;
  while (i < rowSegs.length){
    let lnNo = rowOf(rowSegs[i][0]), start = rowSegs[i][0];
    let lineNo = lnNo, line = rowSegs[i][2], end = rowSegs[i][1]; let j = i + 1;
    while (j < rowSegs.length && rowOf(rowSegs[j][0]) === lineNo){ line += ' ' + rowSegs[j][2].replace(/^\s*/, ''); end = rowSegs[j][1]; j++; }
    let rows = [line];
    let k = j, expectLine = lnNo + 1;
    while (k < rowSegs.length && rowOf(rowSegs[k][0]) === expectLine){
      end = rowSegs[k][1]; const ln2 = rowSegs[k][2]; let kk = k + 1;
      while (kk < rowSegs.length && rowOf(rowSegs[kk][0]) === rowOf(rowSegs[k][0])){ ln2 += ' ' + rowSegs[kk][2].replace(/^\s*/, ''); kk++; }
      rows.push(ln2); expectLine = rowOf(rowSegs[k][0]) + 1; k = kk;
    }
    if (rows.length === 1){
      const rebuilt = rows[0].replace(/(\|) +\|/g, '$1\n|');
      const segs = rebuilt.split('\n');
      if (segs.length >= 3){
        const cand = segs.map(s => s.trim()).filter(s => s && s !== '|');
        const divIdx = cand.findIndex(r => { const cells = splitRow(r); return cells.length > 1 && cells.every(c => /^:?-+:?$/.test(c)); });
        if (divIdx > 0){ rows = cand; }
      }
    }
    const tb = mergeTableRows(rows);
    if (tb){
      const pre = raw.slice(lastEnd, start).trim();
      if (pre){ flush(); html += '<p>' + esc(pre) + '</p>'; }
      flush();
      let t = '<table class="lawtable"><thead><tr>';
      tb.head.forEach(h => { t += '<th>' + esc(h) + '</th>'; });
      t += '</tr></thead><tbody>';
      tb.body.forEach(row => { t += '<tr>' + row.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>'; });
      t += '</tbody></table>';
      html += t;
      lastEnd = end; i = k; continue;
    }
    i++;
  }
  const tail = raw.slice(lastEnd).trim();
  if (tail){
    tail.split('\n').map(s => s.trim()).filter(Boolean).forEach(ln => {
      if (ln.charAt(0) === '>'){ flush(); html += '<blockquote>' + esc(ln.replace(/^>\s?/, '')) + '</blockquote>'; return; }
      const m = itemRe.exec(ln);
      if (m){ if (!inList){ html += '<ol class="subitems">'; inList = true; } html += '<li>' + esc(m[2]) + '</li>'; }
      else { flush(); html += '<p>' + esc(ln) + '</p>'; }
    });
  }
  flush();
  if (!html) html = '<p>' + esc(raw) + '</p>';
  return html;
}

/* ===================== 页面模板 ===================== */
function jsonLd(obj){
  return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
}

function lawDescription(law){
  const parts = [];
  parts.push(law.title + '（' + law.level + '）全文在线阅读');
  if (law.publisher) parts.push('发布机关：' + law.publisher);
  if (law.publish_date) parts.push('颁布：' + law.publish_date);
  if (law.effective_date) parts.push('实施：' + law.effective_date);
  parts.push('工建法研工程建设法规库提供' + law.title + '完整条文、章节结构与官方来源链接，便于检索与学习参考。');
  return parts.join('｜');
}

function renderLawPage(law, parsed){
  const m = {
    doc_number: law.doc_number, publisher: law.publisher, publish_date: law.publish_date,
    effective_date: law.effective_date, revise_date: law.revise_date, status: law.status, source_url: law.source_url
  };
  const slug = LEVEL_SLUG[law.level] || 'other';
  const arts = parsed.chapters.reduce((s, c) => s + c.articles.length, 0);
  const words = parsed.chapters.reduce((s, c) => s + c.articles.reduce((a, ar) => a + (ar.content ? ar.content.length : 0), 0), 0);
  const canonical = BASE + 'law/' + law.id + '/';
  const desc = lawDescription(law);

  // 正文
  let body = '';
  parsed.chapters.forEach((c, i) => {
    const isUntitled = !c.title || c.title === '（未分章）';
    const isLead = isUntitled && i === 0;
    body += '<div class="chapter' + (isLead ? ' lead' : '') + '" id="ch' + i + '">';
    if (!isUntitled) body += '<h3>' + esc(c.title) + '</h3>';
    let sj = 0;
    c.articles.forEach((a) => {
      const isAbol = (a.status === '已废止');
      const isNote = /^[（(](原|注|说明|注：|备注)/.test(a.content || '');
      const anHtml = a.article ? '<div class="an">' + esc(a.article) + '</div>' : '';
      const cls = 'article' + (isAbol ? ' abol' : '') + (isNote ? ' note' : '');
      const aid = a.article ? ' id="art-' + i + '-' + sj + '"' : '';
      body += '<div class="' + cls + '"' + aid + '>' + anHtml + '<div class="ac">' + renderContent(a.content) + '</div>' +
        (isAbol && a.superseded_by ? '<div class="sup">⚠️ 已废止 ｜ 替代：' + esc(a.superseded_by) + '</div>' : '');
      body += '</div>';
      if (a.article) sj++;
    });
    body += '</div>';
  });

  // 信息表
  const srcName = esc(m.publisher || '');
  const srcUrl = (m.source_url || '').trim();
  const srcHtml = srcName + (srcUrl ? ' ｜ <a class="src-link" href="' + esc(srcUrl) + '" target="_blank" rel="noopener">官方原文 ↗</a>' : '');
  const infoTable =
    '<table class="info-table">' +
    '<tr><td class="label">文号</td><td class="value">' + esc(m.doc_number || '—') + '</td>' +
       '<td class="label">发布机关</td><td class="value">' + esc(m.publisher || '—') + '</td></tr>' +
    '<tr><td class="label">颁布时间</td><td class="value">' + esc(m.publish_date || '—') + '</td>' +
       '<td class="label">实施时间</td><td class="value">' + esc(m.effective_date || '—') + '</td></tr>' +
    '<tr><td class="label">修订时间</td><td class="value">' + (m.revise_date || '—') + '</td>' +
       '<td class="label">是否有效</td><td class="value">' + (m.status === '已废止' ? '已废止' : '现行有效') + '</td></tr>' +
    '<tr><td class="label">来源</td><td class="value" colspan="3">' + srcHtml + '</td></tr>' +
    '</table>';

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': law.title,
    'author': {'@type': 'Organization', 'name': m.publisher || '工建法研'},
    'publisher': {'@type': 'Organization', 'name': '工建法研 · 工程建设法规库'},
    'datePublished': m.publish_date || '',
    'dateModified': m.effective_date || m.publish_date || '',
    'inLanguage': 'zh-CN',
    'about': {'@type': 'Legislation', 'name': law.title},
    'mainEntityOfPage': {'@type': 'WebPage', '@id': canonical}
  }) + jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      {'@type': 'ListItem', 'position': 1, 'name': '工程建设法规库', 'item': BASE},
      {'@type': 'ListItem', 'position': 2, 'name': law.level, 'item': BASE + 'level/' + slug + '/'},
      {'@type': 'ListItem', 'position': 3, 'name': law.title, 'item': canonical}
    ]
  });

  return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + esc(law.title) + '（' + esc(law.level) + '）全文 · 工程建设法规库</title>\n' +
'<meta name="description" content="' + esc(desc) + '">\n' +
'<link rel="canonical" href="' + canonical + '">\n' +
'<meta property="og:type" content="article">\n' +
'<meta property="og:title" content="' + esc(law.title) + '（' + esc(law.level) + '）">\n' +
'<meta property="og:description" content="' + esc(desc) + '">\n' +
'<meta property="og:url" content="' + canonical + '">\n' +
'<meta property="og:site_name" content="工建法研 · 工程建设法规库">\n' +
'<meta name="twitter:card" content="summary">\n' +
'<meta name="twitter:title" content="' + esc(law.title) + '（' + esc(law.level) + '）">\n' +
'<meta name="twitter:description" content="' + esc(desc) + '">\n' +
ld + '\n' +
'<link rel="stylesheet" href="../../assets/app.css">\n' +
'<style>.seo-page{max-width:880px;margin:0 auto;padding:24px 18px 60px;}.seo-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:14px;}.seo-top .brand{font-weight:700;color:#1677ff;}.seo-top a{color:#1677ff;text-decoration:none;}.seo-top .open{margin-left:auto;background:#1677ff;color:#fff;padding:6px 12px;border-radius:8px;}.back-home{display:inline-block;margin-top:28px;color:#1677ff;text-decoration:none;}</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="seo-page">\n' +
'<div class="seo-top"><span class="brand">工建法研 · 工程建设法规库</span>' +
'<a href="../../">首页</a> › <a href="../../level/' + slug + '/">' + esc(law.level) + '</a>' +
'<a class="open" href="../../#' + encodeURIComponent(law.title) + '">打开交互版 →</a></div>\n' +
'<h1>' + esc(law.title) + '</h1>\n' +
infoTable + '\n' +
'<div class="read-body">' + body + '</div>\n' +
'<div class="doc-end">📄 本文约 <b>' + words + '</b> 字 · 共 <b>' + arts + '</b> 条</div>\n' +
'<a class="back-home" href="../../">← 返回工程建设法规库首页</a>\n' +
'</div>\n' +
'<footer style="max-width:880px;margin:0 auto;padding:18px;color:#888;font-size:12px;">本站法规条文整理自互联网公开信息，仅供学习与研究参考，不构成正式法律意见。具体以政府公报、主管部门官网原文为准。</footer>\n' +
'</body>\n</html>\n';
}

function renderLevelPage(level, laws){
  const slug = LEVEL_SLUG[level] || 'other';
  const canonical = BASE + 'level/' + slug + '/';
  const desc = '工建法研工程建设法规库「' + level + '」类别共 ' + laws.length + ' 部法规，提供全文在线阅读、章节结构与官方来源链接，便于检索与学习参考。';
  let list = '';
  laws.forEach(l => {
    list += '<li class="lv-item"><a href="../law/' + l.id + '/">' + esc(l.title) + '</a>' +
      '<span class="lv-meta">｜' + esc(l.publisher || '') + (l.publish_date ? '｜颁布 ' + esc(l.publish_date) : '') +
      (l.status === '已废止' ? '｜已废止' : '｜现行有效') + '</span></li>\n';
  });
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    'name': level + ' · 工程建设法规',
    'url': canonical,
    'isPartOf': {'@type': 'WebSite', 'name': '工建法研 · 工程建设法规库', 'url': BASE},
    'mainEntity': {'@type': 'ItemList', 'numberOfItems': laws.length}
  }) + jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': [
      {'@type': 'ListItem', 'position': 1, 'name': '工程建设法规库', 'item': BASE},
      {'@type': 'ListItem', 'position': 2, 'name': level, 'item': canonical}
    ]
  });
  return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + esc(level) + ' · 工程建设法规库（共 ' + laws.length + ' 部）</title>\n' +
'<meta name="description" content="' + esc(desc) + '">\n' +
'<link rel="canonical" href="' + canonical + '">\n' +
'<meta property="og:type" content="website">\n' +
'<meta property="og:title" content="' + esc(level) + ' · 工程建设法规库">\n' +
'<meta property="og:description" content="' + esc(desc) + '">\n' +
'<meta property="og:url" content="' + canonical + '">\n' +
'<meta name="twitter:card" content="summary">\n' +
'<meta name="twitter:title" content="' + esc(level) + ' · 工程建设法规库">\n' +
'<meta name="twitter:description" content="' + esc(desc) + '">\n' +
ld + '\n' +
'<link rel="stylesheet" href="../../assets/app.css">\n' +
'<style>.seo-page{max-width:880px;margin:0 auto;padding:24px 18px 60px;}.seo-top{margin-bottom:14px;font-size:14px;}.seo-top .brand{font-weight:700;color:#1677ff;}.seo-top a{color:#1677ff;text-decoration:none;}.lv-list{list-style:none;padding:0;}.lv-item{padding:10px 0;border-bottom:1px solid #eee;}.lv-item a{color:#1677ff;font-size:16px;text-decoration:none;font-weight:600;}.lv-meta{display:block;color:#888;font-size:13px;margin-top:2px;}</style>\n' +
'</head>\n' +
'<body>\n' +
'<div class="seo-page">\n' +
'<div class="seo-top"><span class="brand">工建法研 · 工程建设法规库</span> <a href="../../">首页</a></div>\n' +
'<h1>' + esc(level) + '</h1>\n' +
'<p>本页汇集工建法研工程建设法规库中「' + esc(level) + '」类别的全部法规，共 <b>' + laws.length + '</b> 部。点击任意法规可查看完整条文、章节结构与官方来源链接。</p>\n' +
'<ul class="lv-list">\n' + list + '</ul>\n' +
'<a class="back-home" href="../../" style="display:inline-block;margin-top:24px;color:#1677ff;text-decoration:none;">← 返回工程建设法规库首页</a>\n' +
'</div>\n' +
'<footer style="max-width:880px;margin:0 auto;padding:18px;color:#888;font-size:12px;">本站法规条文整理自互联网公开信息，仅供学习与研究参考，不构成正式法律意见。</footer>\n' +
'</body>\n</html>\n';
}

/* ===================== 主流程 ===================== */
function main(){
  const manifestPath = path.join(ROOT, 'data', 'manifest.json');
  const LAWS = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('[seo] manifest 载入：' + LAWS.length + ' 部法规');

  let ok = 0, skip = 0;
  const urlset = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '<url><loc>' + BASE + '</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>'];

  // 按层级分组（用于 level 页）
  const byLevel = {};
  LAWS.forEach(l => { (byLevel[l.level] = byLevel[l.level] || []).push(l); });

  for (const law of LAWS){
    const mdPath = path.join(ROOT, law.file);
    let md;
    try { md = fs.readFileSync(mdPath, 'utf8'); }
    catch (e){ console.warn('[skip] 找不到正文：' + law.file + ' (' + law.title + ')'); skip++; continue; }
    const parsed = parseMd(md);
    const html = renderLawPage(law, parsed);
    const outDir = path.join(ROOT, 'law', law.id);
    fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    ok++;
    const lastmod = law.effective_date || law.publish_date || '';
    urlset.push('<url><loc>' + BASE + 'law/' + law.id + '/</loc>' +
      (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') +
      '<changefreq>monthly</changefreq><priority>0.8</priority></url>');
  }

  // level 页
  for (const level of Object.keys(byLevel)){
    const slug = LEVEL_SLUG[level] || 'other';
    const html = renderLevelPage(level, byLevel[level]);
    const outDir = path.join(ROOT, 'level', slug);
    fs.mkdirSync(outDir, {recursive: true});
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
    urlset.push('<url><loc>' + BASE + 'level/' + slug + '/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>');
  }
  console.log('[seo] 层级 landing 页：' + Object.keys(byLevel).length + ' 个');

  urlset.push('</urlset>');
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), urlset.join('\n') + '\n', 'utf8');

  const robots =
    'User-agent: *\n' +
    'Disallow: /laws/\n' +
    'Disallow: /data/\n' +
    'Allow: /\n' +
    'Sitemap: ' + BASE + 'sitemap.xml\n';
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robots, 'utf8');

  console.log('[seo] 完成：生成法规静态页 ' + ok + ' 页（跳过 ' + skip + '），sitemap.xml + robots.txt 已写入。');
}

main();
