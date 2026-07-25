#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract text from a standard PDF and show structure for inspection."""
import sys, re
import fitz

def main():
    path = sys.argv[1]
    doc = fitz.open(path)
    print(f"PAGES={doc.page_count}")
    texts = []
    for pg in doc:
        texts.append(pg.get_text())
    full = "\n".join(texts)
    # stats
    arts = re.findall(r'(?m)^\s*(\d+(?:\.\d+){1,3})\s', full)
    print(f"ARTICLE-LIKE LINES (N.N.N): {len(arts)}")
    # show first 50 non-empty lines
    lines = [l.rstrip() for l in full.splitlines() if l.strip()]
    print("=== FIRST 50 LINES ===")
    for l in lines[:50]:
        print(l[:120])
    print("=== SAMPLE MIDDLE (around 3.1.1) ===")
    idx = full.find('3.1.1')
    if idx >= 0:
        print(full[idx-200:idx+400])

if __name__ == '__main__':
    main()
