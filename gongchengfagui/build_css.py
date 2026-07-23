# -*- coding: utf-8 -*-
"""
build_css.py — 从 v1 gen_website.py 的 <style> 块生成第二版 assets/app.css。
与 build_appjs.py 同理：CSS 一律以 gen_website.py 源为唯一来源，改源后重跑本脚本即可同步。
"""
import os

BASE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(BASE, '..', 'law-knowledge-base', 'scripts', 'gen_website.py')
OUT = os.path.join(BASE, 'assets', 'app.css')

src = open(GEN, encoding='utf-8').read()
i = src.index('<style>') + len('<style>')
j = src.index('</style>', i)
css = src[i:j].strip()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(css + '\n')
print('app.css bytes:', len(css))
print('contains lawtable:', '.lawtable' in css)
print('contains dtag variants:', 'dt-xiu' in css)
print('old red dtag gone:', 'd4380d' not in css)
