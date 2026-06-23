const fs = require("fs");
const path = require("path");

// ── 始终基于脚本自身所在目录 ──
const rootDir = __dirname;

const articlesDir = path.join(rootDir, "子页文章");
const result = [];

if (!fs.existsSync(articlesDir)) {
  console.error("Error: 未找到 '子页文章' 文件夹，请确认脚本在 Chears77.github.io 目录下运行");
  process.exit(1);
}

const entries = fs.readdirSync(articlesDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const folderPath = path.join(articlesDir, entry.name);
  const match = entry.name.match(/^(\d{8})(.*)/);
  if (!match) continue;
  const dateStr = match[1];
  const topic = match[2].trim();
  const articlePath = path.join(folderPath, "article.html");
  if (!fs.existsSync(articlePath)) continue;
  const html = fs.readFileSync(articlePath, "utf-8");
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : topic;
  let thumbnail = "";
  const files = fs.readdirSync(folderPath);
  const imgFile = files.find(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
  if (imgFile) {
    thumbnail = path.join("子页文章", entry.name, imgFile).replace(/\\/g, "/");
  }
  const displayDate = dateStr.substring(0,4) + "-" + dateStr.substring(4,6) + "-" + dateStr.substring(6,8);
  result.push({
    id: dateStr,
    date: displayDate,
    dateSort: dateStr,
    title: title,
    folder: entry.name,
    path: path.join("子页文章", entry.name, "article.html").replace(/\\/g, "/"),
    thumbnail: thumbnail
  });
}

result.sort((a, b) => b.dateSort.localeCompare(a.dateSort));

// ── 写入 articles.json ──
fs.writeFileSync(path.join(rootDir, "articles.json"), JSON.stringify(result, null, 2), "utf-8");
console.log("✓ Generated articles.json with " + result.length + " articles");

// ── 嵌入数据到 articles.html ──
const articlesHtmlPath = path.join(rootDir, "articles.html");
let articlesHtml = fs.readFileSync(articlesHtmlPath, "utf-8");

const dataJson = JSON.stringify(result);
const dataRegex = /var __articlesData = \[[\s\S]*?\];/;
const newDataLine = "var __articlesData = " + dataJson + ";";

if (dataRegex.test(articlesHtml)) {
  articlesHtml = articlesHtml.replace(dataRegex, newDataLine);
  fs.writeFileSync(articlesHtmlPath, articlesHtml, "utf-8");
  console.log("✓ Updated articles.html with inline data");
} else {
  console.log("Warning: __articlesData placeholder not found in articles.html");
}