#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Classify stub files in 法规库/ and report counts by type + source host."""
import os, re, json, urllib.parse
from collections import defaultdict, OrderedDict

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(ROOT, "法规库")

PLACE = re.compile(r"待补全|全文待补|条文全文|（条文|待补校|待补录|占位|placeholder|暂缺|内容待补|待补充|待校核|待补全")
RE_H1 = re.compile(r'^#\s+\S', re.M)
RE_ART = re.compile(r'^###\s*第[一二三四五六七八九十百零0-9]+[条款]', re.M)
RE_STD = re.compile(r'^###\s*[\d]+(?:\.\d+)*\s', re.M)

LAW_LEVELS = {"法律","行政法规","部门规章","司法解释","地方行政法规","地方规章","地方规范性文件","中央行政法规","中央部门规章","中央规范性文件"}

def fm(text):
    if text.startswith('---'):
        parts = text.split('---', 2)
        if len(parts) >= 3:
            body = parts[2]
            raw = parts[1]
            d = {}
            for line in raw.splitlines():
                if ':' in line:
                    k,v = line.split(':',1)
                    d[k.strip()] = v.strip()
            return d, body
    return {}, text

rows = []
for dirpath, dirs, files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'): continue
        p = os.path.join(dirpath, f)
        try:
            t = open(p, encoding='utf-8').read()
        except Exception as e:
            rows.append((p, 'READ_ERR', '', 0, '', 0, 0, 0)); continue
        meta, body = fm(t)
        level = meta.get('level','').strip()
        src = meta.get('source_url','').strip()
        host = ''
        if src:
            try: host = urllib.parse.urlparse(src).netloc
            except: host = ''
        has_place = bool(PLACE.search(body))
        h1 = bool(RE_H1.search(body))
        arts = len(RE_ART.findall(body))
        stds = len(RE_STD.findall(body))
        rows.append((p, level, host, len(body), 'Y' if has_place else '', arts, stds, 1 if h1 else 0))

stubs = [r for r in rows if r[4]=='Y']
print(f"TOTAL md files scanned: {len(rows)}")
print(f"STUB files (contain placeholder text): {len(stubs)}")
print()

# classify stubs
law_stubs = [r for r in stubs if r[1] in LAW_LEVELS]
std_stubs = [r for r in stubs if r[1]=='标准规范']
other_stubs = [r for r in stubs if r[1] not in LAW_LEVELS and r[1]!='标准规范']
print(f"  law-type stubs: {len(law_stubs)}")
print(f"  standard-type stubs: {len(std_stubs)}")
print(f"  other stubs: {len(other_stubs)}")
print()

# by level
byl = defaultdict(int)
for r in stubs: byl[r[1]] += 1
print("By level:")
for k in sorted(byl): print(f"  {k}: {byl[k]}")
print()

# by host (for source reachability planning)
byh = defaultdict(int)
for r in stubs: byh[r[2]] += 1
print("By source host:")
for k in sorted(byh, key=lambda x:-byh[x]): print(f"  {k or '(none)'}: {byh[k]}")
print()

# law stubs detail
print("=== LAW-TYPE STUBS (detail) ===")
for r in law_stubs:
    name = os.path.basename(r[0])
    print(f"  [{r[1]}] arts={r[5]} | {name}")
print()
print("=== OTHER STUBS ===")
for r in other_stubs:
    print(f"  [{r[1]}] | {os.path.basename(r[0])}")
