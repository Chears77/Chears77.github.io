# -*- coding: utf-8 -*-
"""从官方网页 HTML 提取法律/法规正文，转为 法规库 的 ## 第X章 / ### 第X条 格式。
保留原 md 的 FrontMatter，仅替换正文。
- 采用“行首 第X章/节/条”识别，避免条文正文中的“本法第十二条”等交叉引用被误判为条文。
- 跳过目录(TOC)块（首个条之前的章/节）。
"""
import re, html, sys, os

def clean(html_text):
    t = re.sub(r'<(p|br|/p|div|/div|li|/li|tr|/tr|h1|/h1|h2|/h2|h3|/h3|h4|/h4|h5|/h5|h6|/h6)[^>]*>', '\n', html_text, flags=re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = html.unescape(t)
    t = re.sub(r'[\u3000]', ' ', t)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n\s*\n+', '\n', t)
    return t

HEAD_RE = re.compile(r'^(第[一二三四五六七八九十百零0-9]+)([章节条])\s*(.*)$')

def extract(html_text, title_hint=None):
    t = clean(html_text)
    lines = [l.strip() for l in t.split('\n') if l.strip()]
    # 定位首个“条”行（正文起点）
    F = next((i for i, l in enumerate(lines) if HEAD_RE.match(l) and HEAD_RE.match(l).group(2) == '条'), None)
    threshold = (F - 1) if F is not None else 0
    preamble = ""
    # 前导说明（通过/公布信息）作为 preamble
    if F is None:
        F = len(lines)
    # 收集标题前的说明行
    pre = []
    for l in lines[:max(0, threshold)]:
        if not HEAD_RE.match(l):
            pre.append(l)
    if pre:
        preamble = ' '.join(pre)[-200:]  # 取尾部（通常为通过信息）
    chapters = []
    cur = None
    cur_art = None
    art_buf = []
    def flush():
        nonlocal cur_art
        if cur is not None and cur_art is not None:
            cur['arts'].append((cur_art, ' '.join(art_buf).strip()))
        cur_art = None
        art_buf.clear()
    for i, l in enumerate(lines):
        m = HEAD_RE.match(l)
        if not m:
            if cur_art is not None:
                art_buf.append(l)
            continue
        num, kind, rest = m.group(1), m.group(2), m.group(3).strip()
        tok = num + kind
        if i < threshold and kind in '章节':
            continue  # 目录中的章/节
        if kind == '章':
            flush()
            if cur:
                chapters.append(cur)
            cur = {'name': (tok + ' ' + re.sub(r'\s+', '', rest)).strip(), 'arts': []}
        elif kind == '节':
            flush()
            if cur is None:
                cur = {'name': '正文', 'arts': []}
            cur['arts'].append((tok, re.sub(r'\s+', '', rest)))
        else:  # 条
            flush()
            if cur is None:
                cur = {'name': '正文', 'arts': []}
            cur_art = tok
            art_buf = [rest] if rest else []
    flush()
    if cur:
        chapters.append(cur)
    return preamble, chapters

def render(title, preamble, chapters):
    out = [f"# {title}", ""]
    if preamble:
        p = preamble if preamble.startswith('（') else '（' + preamble + '）'
        out.append(p)
        out.append("")
    for ch in chapters:
        out.append(f"## {ch['name']}" if ch['name'] else "## 正文")
        out.append("")
        for art_no, body in ch['arts']:
            out.append(f"### {art_no}")
            out.append(body)
            out.append("")
    return "\n".join(out).rstrip() + "\n"

def fill_md(md_path, html_text, title=None):
    raw = open(md_path, encoding='utf-8').read()
    if raw.startswith('---'):
        parts = raw.split('---', 2)
        fm = parts[1]
        mt = re.search(r'title:\s*(.+)', fm)
        t = title or (mt.group(1).strip() if mt else os.path.basename(md_path))
        preamble, chapters = extract(html_text, t)
        if not chapters:
            return False, "no-chapters-found"
        new_body = render(t, preamble, chapters)
        new_md = f"---\n{fm}---\n\n{new_body}"
        open(md_path, 'w', encoding='utf-8').write(new_md)
        n_art = sum(len(c['arts']) for c in chapters)
        return True, f"chapters={len(chapters)} articles={n_art}"
    return False, "no-frontmatter"

if __name__ == '__main__':
    md_path = sys.argv[1]
    html_path = sys.argv[2]
    ht = open(html_path, encoding='utf-8', errors='ignore').read()
    ok, msg = fill_md(md_path, ht)
    print(ok, msg)
