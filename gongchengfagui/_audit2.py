#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Global structural audit of 法规库/ (560 md). Checks FM integrity, dates, H1, duplicates, level-dir match."""
import os, re, datetime
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(ROOT, "法规库")

VALID_LEVELS = {
    "法律","司法解释","中央行政法规","中央部门规章","中央规范性文件",
    "地方行政法规","地方规章","地方规范性文件","标准规范",
    "司法案例","行政案例","政策解读",
}
# dir prefix -> level (approx)
DIR_LEVEL = {
    "01-法律":"法律","02-司法解释":"司法解释","03-中央行政法规":"中央行政法规",
    "04-中央部门规章":"中央部门规章","05-中央规范性文件":"中央规范性文件",
    "06-地方行政法规":"地方行政法规","07-地方规章":"地方规章",
    "08-地方规范性文件":"地方规范性文件","09-标准规范":"标准规范",
    "10-司法案例":"司法案例","11-行政案例":"行政案例","12-政策解读":"政策解读",
}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

def parse_fm(text):
    if not text.startswith('---'):
        return None, text
    parts = text.split('---', 2)
    if len(parts) < 3:
        return None, text
    raw, body = parts[1], parts[2]
    d = {}
    for ln in raw.splitlines():
        if ':' in ln:
            k, v = ln.split(':', 1)
            d[k.strip()] = v.strip()
    return d, body

issues = defaultdict(list)
titles = Counter()
total = 0
no_fm = 0
for dp, dirs, files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'): continue
        total += 1
        p = os.path.join(dp, f)
        t = open(p, encoding='utf-8').read()
        meta, body = parse_fm(t)
        if meta is None:
            no_fm += 1; issues['no_fm'].append(f); continue
        # level
        lvl = meta.get('level','').strip()
        if lvl not in VALID_LEVELS:
            issues['bad_level'].append((f, lvl))
        # title
        if not meta.get('title','').strip():
            issues['missing_title'].append(f)
        else:
            titles[meta['title'].strip()] += 1
        # dates
        for fk in ('publish_date','effective_date','revise_date'):
            v = meta.get(fk,'').strip()
            if v and v != '""' and v != "''" and not DATE_RE.match(v):
                issues['bad_date'].append((f, fk, v))
        # H1
        if not re.search(r'(?m)^#\s+\S', body):
            issues['no_h1'].append(f)
        # level vs dir
        for pref, exp in DIR_LEVEL.items():
            if pref in dp:
                if lvl and lvl != exp:
                    issues['level_dir_mismatch'].append((f, lvl, exp))
                break

# duplicates
dups = {t:c for t,c in titles.items() if c > 1}

print(f"TOTAL files: {total} | no_frontmatter: {no_fm}")
print(f"bad_level: {len(issues['bad_level'])}")
for x in issues['bad_level'][:10]: print("   ", x)
print(f"missing_title: {len(issues['missing_title'])}")
print(f"bad_date: {len(issues['bad_date'])}")
for x in issues['bad_date'][:10]: print("   ", x)
print(f"no_h1 (body lacks # title): {len(issues['no_h1'])}")
for x in issues['no_h1'][:15]: print("   ", x)
print(f"level_dir_mismatch: {len(issues['level_dir_mismatch'])}")
for x in issues['level_dir_mismatch'][:10]: print("   ", x)
print(f"duplicate titles: {len(dups)}")
for t,c in list(dups.items())[:15]: print(f"   [{c}x] {t}")
