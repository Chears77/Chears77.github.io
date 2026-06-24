const fs = require("fs");
const path = require("path");

// 脚本位于 子页文章/ 中，文章子文件夹就在同目录下
const rootDir = __dirname;

const articlesDir = rootDir;
const result = [];

if (!fs.existsSync(articlesDir)) {
  console.error("Error: 未找到文章目录，请确认脚本在 子页文章 目录下运行");
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
  // Find any .html file in the folder (not just article.html)
  const htmlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith(".html"));
  if (htmlFiles.length === 0) continue;
  const articleFile = htmlFiles[0];
  const articlePath = path.join(folderPath, articleFile);
  const html = fs.readFileSync(articlePath, "utf-8");
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : topic;
  let thumbnail = "";
  const files = fs.readdirSync(folderPath);
  const imgFile = files.find(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
  if (imgFile) {
    thumbnail = "./" + entry.name + "/" + imgFile;
  }
  const displayDate = dateStr.substring(0,4) + "-" + dateStr.substring(4,6) + "-" + dateStr.substring(6,8);
  result.push({
    id: dateStr,
    date: displayDate,
    dateSort: dateStr,
    title: title,
    folder: entry.name,
    path: "./" + entry.name + "/" + articleFile,
    thumbnail: thumbnail
  });
}

result.sort((a, b) => b.dateSort.localeCompare(a.dateSort));

// 写入 articles.json（同目录）
fs.writeFileSync(path.join(rootDir, "articles.json"), JSON.stringify(result, null, 2), "utf-8");
console.log("✓ Generated articles.json with " + result.length + " articles");

// 嵌入数据到 articles.html（同目录）
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

