#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch authoritative HTML for a regulation and convert to the knowledge-base .md format."""
import re, sys, html as ihtml, os, urllib.request, json, time

CN_NUM = r'[零一二三四五六七八九十百千两]'
CHAPTER_RE = re.compile(r'^第' + CN_NUM + r'+章[ \t　]*(.*)$')
ARTICLE_RE = re.compile(r'^第[零一二三四五六七八九十百千两0-9]+条[ \t　]*(.*)$')

def fetch(url, ua="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    # try decode
    for enc in ("utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")

def extract_lines(htmldoc):
    # Prefer the gongbao content container
    m = re.search(r'id="UCAP-CONTENT">(.*?)<div class="pages_content_footer"', htmldoc, re.S)
    if not m:
        m = re.search(r'id="UCAP-CONTENT">(.*?)</div>\s*<div', htmldoc, re.S)
    if not m:
        m = re.search(r'id="UCAP-CONTENT">(.*?)</div>', htmldoc, re.S)
    body = m.group(1) if m else htmldoc
    body = re.sub(r'</p>', '\n', body, flags=re.I)
    body = re.sub(r'<br\s*/?>', '\n', body, flags=re.I)
    text = re.sub(r'<[^>]+>', '', body)
    text = ihtml.unescape(text)
    lines = [ln.strip() for ln in text.split('\n')]
    # drop pure-punctuation / empty
    cleaned = []
    for ln in lines:
        if not ln:
            continue
        if re.fullmatch(r'[\s　\.·•\-—]*', ln):
            continue
        cleaned.append(ln)
    return cleaned

def collapse(s):
    s = s.replace('　', ' ')
    s = re.sub(r'[ \t]+', ' ', s).strip()
    return s

def build_body(lines):
    # find first chapter
    first_chap = None
    for i, ln in enumerate(lines):
        if CHAPTER_RE.match(ln):
            first_chap = i
            break
    promo = []
    if first_chap is None:
        # no chapter markers; treat whole as body
        body_lines = lines
    else:
        promo = [collapse(ln) for ln in lines[:first_chap] if not CHAPTER_RE.match(ln)]
        body_lines = lines[first_chap:]
    out = []
    for ln in body_lines:
        cm = CHAPTER_RE.match(ln)
        if cm:
            name = collapse(cm.group(1))
            out.append('')
            out.append('## 第' + re.search(r'第' + CN_NUM + r'+章', ln).group(0) + ' ' + name)
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
        # continuation
        out.append(collapse(ln))
    # trim leading/trailing blanks
    while out and out[0] == '':
        out.pop(0)
    while out and out[-1] == '':
        out.pop()
    return promo, out

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
    if promo:
        y.append('')
        y.append('（' + '；'.join(promo) + '）' if not promo[0].startswith('（') else '；'.join(promo))
    y.append('')
    y.extend(body)
    y.append('')
    return '\n'.join(y)

if __name__ == '__main__':
    # test mode
    html = open('_tmp_qm.html', encoding='utf-8', errors='ignore').read()
    lines = extract_lines(html)
    promo, body = build_body(lines)
    print("PROMO:", promo)
    print("BODY HEAD:")
    for l in body[:12]:
        print(l)
