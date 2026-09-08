#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""刷新 index.html 中四个专题数据脚本的缓存戳（?v=），确保一键更新后首页拉到最新数据。"""
import re
import time

p = r'D:\github\homepage\Chears77.github.io\mumu\index.html'
s = open(p, encoding='utf-8').read()
ts = str(int(time.time() * 1000))
changed = False
for name in ['honor-photos.js', 'gallery-photos.js', 'diary-data.js', 'timeline-summary.js']:
    ns, n = re.subn(r'(src="[^"]*' + re.escape(name) + r')(\?v=\d+)?(")', r'\1?v=' + ts + r'\3', s)
    if n:
        s = ns
        changed = True
open(p, 'w', encoding='utf-8').write(s)
print('index.html 数据缓存已刷新' if changed else 'index.html 无需刷新')
