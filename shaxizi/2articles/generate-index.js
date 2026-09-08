const fs = require("fs");
const path = require("path");

/* ═══════════════════════════════════════════════════════════
 * 文章索引生成器 v2（双击 一键更新文章列表.bat 运行本脚本）
 *
 * 规则（源头 = 文件夹名）：
 *   文件夹命名：8位日期 + 标题，如 20260908我的新文章
 *   - 列表日期 / 列表标题：取自文件夹名
 *   - 文章页 <title> / h1 标题 / 日期角标：自动校验并回写为文件夹的值
 *   - 文章文件优先级：index.html > article.html > 第一个 .html
 * 产出：
 *   - articles.data.js（所有文章页左侧「全部文章」导轨的数据源）
 *   - articles.html 内嵌列表数据 __D（文章目录页）
 * ═══════════════════════════════════════════════════════════ */

const rootDir = __dirname;
const entries = fs.readdirSync(rootDir, { withFileTypes: true });
const result = [];
let synced = 0;

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const m = entry.name.match(/^(\d{8})(.*)/);
  if (!m) continue;                       // 不符合「日期+标题」命名的文件夹跳过
  const dateStr = m[1];
  const topic = m[2].trim() || entry.name; // 标题 = 文件夹名去掉日期
  const folderPath = path.join(rootDir, entry.name);

  const htmlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".html"));
  if (htmlFiles.length === 0) continue;
  const articleFile = htmlFiles.includes("index.html") ? "index.html"
    : htmlFiles.includes("article.html") ? "article.html"
    : htmlFiles[0];
  const articlePath = path.join(folderPath, articleFile);
  let html = fs.readFileSync(articlePath, "utf-8");

  // ── 校验 / 回写：文章页内的标题与日期以文件夹为准 ──
  const cnDate = `${dateStr.slice(0, 4)}年${parseInt(dateStr.slice(4, 6), 10)}月${parseInt(dateStr.slice(6, 8), 10)}日`;
  let changed = false;
  const warns = [];

  const tRe = /<title>[^<]*<\/title>/;
  const wantTitle = `<title>${topic} - 安即是佛</title>`;
  if (tRe.test(html)) {
    if (html.match(tRe)[0] !== wantTitle) { html = html.replace(tRe, () => wantTitle); changed = true; }
  } else warns.push("未找到 <title>");

  const hRe = /(<h1[^>]*class="article-title"[^>]*>)([\s\S]*?)(<\/h1>)/;
  if (hRe.test(html)) {
    if (html.match(hRe)[2] !== topic) { html = html.replace(hRe, (mm, p1, p2, p3) => p1 + topic + p3); changed = true; }
  } else warns.push("未找到 h1.article-title");

  const dRe = /(<span[^>]*class="article-date"[^>]*>)([\s\S]*?)(<\/span>)/;
  if (dRe.test(html)) {
    if (html.match(dRe)[2] !== cnDate) { html = html.replace(dRe, (mm, p1, p2, p3) => p1 + cnDate + p3); changed = true; }
  } else warns.push("未找到 .article-date");

  if (changed) {
    fs.writeFileSync(articlePath, html, "utf-8");
    synced++;
    console.log("✓ 已按文件夹校验回写：" + entry.name);
  }
  if (warns.length) console.warn("⚠ " + entry.name + "：" + warns.join("、") + "（列表数据仍按文件夹生成）");

  result.push({ dateStr, topic, folder: entry.name, path: "./" + entry.name + "/" + articleFile });
}

result.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

// ── 产出 articles.data.js（文章页左侧导轨数据源，运行时读取） ──
const slim = result.map(a => ({ d: a.dateStr, t: a.topic, p: a.path.replace(/^\.\//, "") }));
fs.writeFileSync(path.join(rootDir, "articles.data.js"),
  "window.__AXJF=" + JSON.stringify(slim) + ";\n", "utf-8");
console.log("✓ 生成 articles.data.js（" + result.length + " 篇）");

// ── 注入 articles.html 内嵌数据（勿改占位行格式） ──
const articlesHtmlPath = path.join(rootDir, "articles.html");
let articlesHtml = fs.readFileSync(articlesHtmlPath, "utf-8");
const slimHtml = result.map(a => ({
  ymd: a.dateStr,
  y: a.dateStr.slice(0, 4),
  t: a.topic,
  p: a.path.replace(/^\.\//, ""),
}));
const htmlDataRegex = /var __D = \[[\s\S]*?\];/;
if (htmlDataRegex.test(articlesHtml)) {
  articlesHtml = articlesHtml.replace(htmlDataRegex, "var __D = " + JSON.stringify(slimHtml) + ";");
  fs.writeFileSync(articlesHtmlPath, articlesHtml, "utf-8");
  console.log("✓ 更新 articles.html 目录数据");
} else {
  console.warn("⚠ articles.html 中未找到 __D 占位行，目录页未更新");
}

console.log("\n全部完成：本次回写 " + synced + " 篇文章的标题/日期。");
