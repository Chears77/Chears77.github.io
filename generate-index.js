const fs = require("fs");
const path = require("path");

const articlesDir = "子页文章";
const result = [];

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
fs.writeFileSync("articles.json", JSON.stringify(result, null, 2), "utf-8");
console.log("Generated articles.json with " + result.length + " articles");
