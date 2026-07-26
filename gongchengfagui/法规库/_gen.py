#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate knowledge-base .md files from authoritative HTML sources (gov.cn gongbao / mohurd / gov.cn zhengce)."""
import re, html as ihtml, json, os, urllib.request, sys

CN_NUM = r'[零一二三四五六七八九十百千两]'
CHAPTER_RE = re.compile(r'^第' + CN_NUM + r'+章[ \t　]*(.*)')
ARTICLE_RE = re.compile(r'^第[零一二三四五六七八九十百千两0-9]+条[ \t　]*(.*)')

def fetch(url, ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Referer": "https://www.gov.cn/"})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
    for enc in ("utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")

def extract_lines(htmldoc):
    # remove script/style noise
    htmldoc = re.sub(r'<script[\s\S]*?</script>', ' ', htmldoc, flags=re.I)
    htmldoc = re.sub(r'<style[\s\S]*?</style>', ' ', htmldoc, flags=re.I)
    # prefer content container (use string ops to avoid regex pitfalls)
    idx = htmldoc.find('UCAP-CONTENT')
    if idx != -1:
        end = htmldoc.find('pages_content_footer', idx)
        region = htmldoc[idx: end] if end != -1 else htmldoc[idx: idx + 500000]
    else:
        idx2 = htmldoc.find('class="article oneColumn')
        region = htmldoc[idx2:] if idx2 != -1 else htmldoc
    # extract paragraph texts
    paras = re.findall(r'<p\b[^>]*>([\s\S]*?)</p>', region, flags=re.I)
    if not paras:
        # fallback: strip all tags
        region = re.sub(r'</p>', '\n', region, flags=re.I)
        paras = region.split('\n')
    out = []
    for p in paras:
        txt = ihtml.unescape(re.sub(r'<[^>]+>', '', p))
        txt = txt.replace('\u3000', ' ')
        # split a <p> that bundles multiple articles/chapters into per-unit lines
        chunks = re.split(r'\n\s*(?=第[零一二三四五六七八九十百千两0-9]+(?:章|条))', txt)
        for ch in chunks:
            ch = ch.strip()
            if not ch:
                continue
            if re.fullmatch(r'[\s\.·•\-—_]+', ch):
                continue
            out.append(ch)
    return out

def collapse(s):
    s = s.replace('　', '')
    s = re.sub(r'[ \t]+', ' ', s).strip()
    return s

def build_body(lines):
    first_chap = None
    first_art = None
    for i, ln in enumerate(lines):
        if first_chap is None and CHAPTER_RE.match(ln):
            first_chap = i
        if first_art is None and ARTICLE_RE.match(ln):
            first_art = i
        if first_chap is not None and first_art is not None:
            break
    if first_chap is not None:
        promo_raw = lines[:first_chap]
        body_lines = lines[first_chap:]
    elif first_art is not None:
        promo_raw = lines[:first_art]
        body_lines = lines[first_art:]
    else:
        return [], lines
    # detect parenthetical promo (line starts with （ and contains 发布)
    promo = []
    for ln in promo_raw:
        if ('国务院公报' in ln or '中国政府网' in ln or '上一篇' in ln
                or '下一篇' in ln or ln.startswith('@') or 'font-' in ln
                or ln.endswith('.css') or 'print' in ln.lower()):
            continue
        if ln.startswith('（') or ln.startswith('(') or '发布' in ln or '公布' in ln or '修订' in ln or '施行' in ln:
            promo.append(collapse(ln))
    out = []
    for ln in body_lines:
        cm = CHAPTER_RE.match(ln)
        if cm:
            chap = re.search(r'第' + CN_NUM + r'+章', ln).group(0)
            name = re.sub(r'\s+', '', cm.group(1))
            out.append('')
            out.append('## ' + chap + ' ' + name)
            out.append('')
            continue
        am = ARTICLE_RE.match(ln)
        if am:
            head = re.search(r'第[零一二三四五六七八九十百千两0-9]+条', ln).group(0)
            rest = collapse(am.group(1))
            out.append('')
            out.append('### ' + head)
            out.append('')
            if rest:
                out.append(rest)
            continue
        out.append(collapse(ln))
    while out and out[0] == '':
        out.pop(0)
    while out and out[-1] == '':
        out.pop()
    return promo, out

def cn_date(iso):
    y, m, d = iso.split('-')
    return f"{int(y)}年{int(m)}月{int(d)}日"

def make_promo(meta):
    if meta.get('promo'):
        return '（' + meta['promo'].strip('（）()') + '）'
    # doc_number already includes the issuing authority (国务院令/主席令/法释/住建部令…)
    p = cn_date(meta['publish_date']) + meta['doc_number'] + '公布'
    if meta.get('revise_note'):
        p += '；' + meta['revise_note']
    return '（' + p + '）'

def make_md(meta, promo, body):
    y = []
    y.append('---')
    y.append('title: ' + meta['title'])
    y.append('level: ' + meta['level'])
    y.append('region: ' + meta.get('region', "''"))
    y.append('publisher: ' + meta['publisher'])
    y.append('doc_number: ' + meta['doc_number'])
    y.append('publish_date: ' + meta['publish_date'])
    y.append('effective_date: ' + meta['effective_date'])
    y.append('revise_date: ' + meta.get('revise_date', "''"))
    y.append('status: ' + meta.get('status', '现行'))
    y.append('field: ' + meta['field'])
    y.append('source_url: ' + meta['source_url'])
    y.append('verify_status: 初稿待校核')
    y.append('---')
    y.append('')
    y.append('# ' + meta['title'])
    y.append('')
    parenthetical = [p for p in promo if p.startswith('（') or p.startswith('(')]
    if parenthetical:
        y.append('（' + parenthetical[0].strip('（）()') + '）')
    else:
        y.append(make_promo(meta))
    y.append('')
    y.extend(body)
    y.append('')
    return '\n'.join(y)

def generate(meta, outdir):
    url = meta['source_url']
    try:
        html = fetch(url)
    except Exception as e:
        return f"FETCH_FAIL {url}: {e}"
    lines = extract_lines(html)
    if not any(ARTICLE_RE.match(l) for l in lines):
        return f"NO_ARTICLES {url}: body has no 第X条 (maybe paywall/JS). Got {len(lines)} lines."
    promo, body = build_body(lines)
    if not body:
        return f"EMPTY_BODY {url}"
    md = make_md(meta, promo, body)
    # filename
    eff = meta['effective_date'].replace('-', '')
    fn = f"{eff}-{meta['doc_number']}-{meta['title']}.md"
    fn = re.sub(r'[\\/:*?"<>|]', '_', fn)
    path = os.path.join(outdir, fn)
    # avoid overwrite existing
    if os.path.exists(path):
        return f"EXISTS {fn}"
    with open(path, 'w', encoding='utf-8') as f:
        f.write(md)
    # sniff doc-number / dates from page for verification
    sniff = ""
    mm = re.search(r'(主席令|国务院令|部令|委员会令|法释|公告)[（(]?第[零一二三四五六七八九十百0-9]+号', html)
    if mm:
        sniff += " DOC:" + mm.group(0).replace('（','').replace('(','') + " "
    ds = re.findall(r'(\d{4})年(\d{1,2})月(\d{1,2})日', html)
    if ds:
        sniff += " DATES:" + ",".join("-".join(d) for d in ds[:4])
    return f"OK {fn} ({len(body)} body lines){sniff}"

if __name__ == '__main__':
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    outdir = sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    for meta in spec:
        print(generate(meta, outdir))
