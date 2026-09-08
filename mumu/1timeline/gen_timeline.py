#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动生成 timeline.html
数据源：2rongyuqiang/honor-photos.js、3gallery/gallery-photos.js、4diaries/diary.html
"""
import json
import re
from html import escape
from pathlib import Path
from urllib.parse import quote

BASE = Path(r"D:\github\homepage\Chears77.github.io\mumu")

# 早期年份（无图片/日记资料）的温和占位文案；2018 年及之后均由实际资料自动生成
EARLY_YEARS = {
    2015: "你像一颗最闪亮的小星星，来到了爸爸妈妈的世界，全家人都因你而欢喜。",
    2016: "咿呀学语、蹒跚学步，每一个\"第一次\"都让我们惊喜不已。",
    2017: "背起小书包走进幼儿园，开始了和小朋友们一起玩耍的快乐时光。",
}

TYPE_META = {
    "honor":   {"label": "荣誉", "icon": "🏆", "verb": "荣获"},
    "gallery": {"label": "相册", "icon": "📷", "verb": "定格"},
    "essay":   {"label": "作文", "icon": "📝", "verb": "写下"},
    "diary":   {"label": "日记", "icon": "📝", "verb": "写下"},
    "school":  {"label": "校园", "icon": "🏫", "verb": "经历"},
    "photo":   {"label": "图片", "icon": "🖼️", "verb": "留下"},
    "parents": {"label": "父母期许", "icon": "💌", "verb": "收到"},
    "video":   {"label": "视频", "icon": "🎬", "verb": "记录"},
}


def load_js_array(path: Path):
    """从 var x = [...] 的 JS 文件中提取 JSON 数组。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        raise ValueError(f"无法在 {path} 中找到数组")
    return json.loads(m.group(0))


def load_diary_data(path: Path):
    """从 diary.html 中提取 DIARY_DATA 数组。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"var\s+DIARY_DATA\s*=\s*(\[.*?\]);", text, re.DOTALL)
    if not m:
        raise ValueError(f"无法在 {path} 中找到 DIARY_DATA")
    return json.loads(m.group(1))


def fmt_date(d: str) -> str:
    """20260316 → 2026-03-16；202305 → 2023-05。"""
    if len(d) >= 8:
        return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
    if len(d) >= 6:
        return f"{d[:4]}-{d[4:6]}"
    return d


def collect_events():
    events = []

    # 荣誉墙
    for h in load_js_array(BASE / "2rongyuqiang" / "honor-photos.js"):
        src = h["src"]
        dm = re.match(r"(\d{6,8})", src)
        date = dm.group(1) if dm else "00000000"
        events.append({
            "year": int(date[:4]),
            "date": date,
            "date_str": fmt_date(date),
            "title": h["title"],
            "type": "honor",
            "thumb": f"../2rongyuqiang/{src}",
            "link": "../2rongyuqiang/honors.html",
        })

    # 相册
    for g in load_js_array(BASE / "3gallery" / "gallery-photos.js"):
        date = g["date"]
        events.append({
            "year": int(date[:4]),
            "date": date,
            "date_str": fmt_date(date),
            "title": g["caption"],
            "type": "gallery",
            "thumb": f"../3gallery/{g['src']}",
            "link": "../3gallery/gallery.html",
        })

    # 成长日记（含作文/日记/校园/图片等，按 cat 区分类型，避免全都标成“日记”）
    for d in load_diary_data(BASE / "4diaries" / "diary.html"):
        date = d["date"]
        thumb = d.get("thumb", "")
        cat = d.get("cat", "diary")
        if cat not in TYPE_META:
            cat = "diary"
        events.append({
            "year": int(date[:4]),
            "date": date,
            "date_str": fmt_date(date),
            "title": d["title"],
            "type": cat,
            "thumb": f"../4diaries/{thumb}" if thumb else "",
            "link": f"../4diaries/{d['folder']}/index.html",
        })

    # 按年份分组，组内按日期倒序
    by_year = {y: [] for y in range(2015, 2027)}
    for e in events:
        if 2015 <= e["year"] <= 2026:
            by_year[e["year"]].append(e)
    for y in by_year:
        by_year[y].sort(key=lambda x: x["date"], reverse=True)
    return by_year


def build_summary(year: int, events: list) -> str:
    """年度说明完全依据真实资料（荣誉/相册/作文/日记/校园/图片…）自动生成，绝不凭空想象。
    按类型归类，用词贴合事实：荣誉‘荣获’、相册‘定格’、作文/日记‘写下’、校园‘经历’、图片‘留下’ 等。
    """
    if not events:
        return EARLY_YEARS.get(year, "更多成长的故事还在书写，敬请期待。")
    from collections import defaultdict
    groups = defaultdict(list)
    for e in events:
        groups[e["type"]].append(e["title"])

    ORDER = ["honor", "gallery", "essay", "diary", "school", "photo", "parents", "video"]
    segs = []
    for t in ORDER:
        titles = groups.get(t)
        if not titles:
            continue
        meta = TYPE_META[t]
        names = "、".join(titles[:3])
        if len(titles) > 3:
            unit = "篇" if t in ("essay", "diary", "school", "photo", "parents", "video") else "项"
            names += f" 等{len(titles)}{unit}"
        if t in ("honor", "gallery"):
            segs.append(f"{meta['verb']} {names}")
        else:
            segs.append(f"{meta['verb']}《{names}》")
    return "；".join(segs) + "。"


def build_event_grid(events: list) -> str:
    if not events:
        return ""
    items = []
    for e in events:
        meta = TYPE_META[e["type"]]
        thumb = quote(e["thumb"]) if e["thumb"] else ""
        if thumb:
            thumb_html = f'<img src="{thumb}" alt="{escape(e["title"])}" loading="lazy">'
        else:
            thumb_html = f'<span class="timeline-event-icon">{meta["icon"]}</span>'
        link = quote(e["link"])
        items.append(
            f'<a class="timeline-event-card" href="{link}" title="{escape(e["title"])}">'
            f'<div class="timeline-event-thumb">{thumb_html}</div>'
            f'<div class="timeline-event-info">'
            f'<span class="timeline-event-type type-{e["type"]}">{meta["label"]}</span>'
            f'<div class="timeline-event-date">{escape(e["date_str"])}</div>'
            f'<div class="timeline-event-title">{escape(e["title"])}</div>'
            f'</div></a>'
        )
    return '<div class="timeline-event-grid">\n' + "\n".join(items) + "\n</div>"


def build_year_card(year: int, summary: str, events_html: str) -> str:
    events_section = ""
    if events_html:
        events_section = (
            '<div class="timeline-year-events">\n'
            '<p class="timeline-year-events-title">这一年的记录</p>\n'
            f'{events_html}\n'
            '</div>'
        )
    return (
        f'<div class="timeline-item fade-in" id="y{year}">\n'
        '  <div class="timeline-dot"></div>\n'
        '  <div class="timeline-card">\n'
        f'    <div class="timeline-year-badge">{year}</div>\n'
        '    <div class="timeline-body">\n'
        f'      <p class="timeline-text">{escape(summary)}</p>\n'
        f'{events_section}'
        '    </div>\n'
        '  </div>\n'
        '</div>'
    )


def build_html(by_year: dict) -> str:
    items = []
    for year in range(2026, 2014, -1):
        items.append(build_year_card(year, build_summary(year, by_year[year]), build_event_grid(by_year[year])))

    DEEP_LINK = """
<script>
// 首页“成长时间轴”预览点击带 #y年份 锚点 → 平滑滚动并高亮对应年份
(function(){
  function jump(){
    var id = (location.hash || '').replace(/^#/, '');
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('tl-highlight');
    setTimeout(function(){ el.classList.remove('tl-highlight'); }, 2400);
  }
  if (document.readyState !== 'loading') setTimeout(jump, 80);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(jump, 80); });
})();
</script>
"""

    body = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>成长时间轴 · Alisa</title>
<link rel="stylesheet" href="../css/style.css">
</head>
<body>

<!-- ========== Top Bar ========== -->
<nav class="topbar">
  <div class="topbar-inner">
    <a href="../index.html" class="topbar-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      返回首页
    </a>
    <span class="topbar-title">成长时间轴</span>
    <span style="width:80px"></span>
  </div>
</nav>

<!-- ========== Content ========== -->
<div class="page-content">
  <div class="timeline" id="timelineContainer">
    __ITEMS__
  </div>
</div>

<!-- ========== Footer ========== -->
<footer class="footer">
  <div class="footer-hearts">&#10084; &#10084; &#10084;</div>
  <p class="footer-quote">"你在长大，我们在变老，但爱永远不变"</p>
  <p class="footer-copy">&copy; 2015 &mdash; 2026 Alisa 成长纪念册</p>
</footer>

<script src="../js/main.js"></script>
""" + DEEP_LINK + "</body>\n</html>"
    return body.replace("__ITEMS__", "".join(items))


def main():
    by_year = collect_events()
    html = build_html(by_year)
    (BASE / "1timeline" / "timeline.html").write_text(html, encoding="utf-8")
    print("timeline.html 生成完成")

    # 额外输出 timeline-summary.js，供首页 index.html 动态渲染时间轴预览
    summary_map = {y: build_summary(y, by_year[y]) for y in range(2015, 2027)}
    summary_js = "var TIMELINE_SUMMARY = " + json.dumps(summary_map, ensure_ascii=False, indent=2) + ";\n"
    (BASE / "1timeline" / "timeline-summary.js").write_text(summary_js, encoding="utf-8")
    print("timeline-summary.js 生成完成")

    total = sum(len(v) for v in by_year.values())
    print(f"共 {total} 条事件：")
    for y in range(2026, 2014, -1):
        if by_year[y]:
            print(f"  {y}: {len(by_year[y])} 条")


if __name__ == "__main__":
    main()
