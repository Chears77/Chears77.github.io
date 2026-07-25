# -*- coding: utf-8 -*-
"""PDF -> 清理后的纯文本(作 HTML 喂给 _fill_law.py)。
只做结构化清洗：去目录(TOC)、去页码水印、去"目录"字样；
不改变任何法律条文内容。
"""
import re, sys
from pypdf import PdfReader

CH_RE = re.compile(r'第[一二三四五六七八九十百零0-9]+章')
ART_RE = re.compile(r'第[一二三四五六七八九十百零0-9]+条')
SEC_RE = re.compile(r'第[一二三四五六七八九十百零0-9]+节')

def pdf_to_text(path):
    r = PdfReader(path)
    return '\n'.join(p.extract_text() or '' for p in r.pages)

def clean_for_fill(txt):
    # 1) 去掉页码水印： —２１— / — 2 — / - 1 - 等（含两侧空格）
    txt = re.sub(r'[—\-−]\s*[０-９0-9]+\s*[—\-−]', ' ', txt)
    txt = re.sub(r'（[０-９0-9]+）', ' ', txt)
    # 1b) 去掉章前冗余的"标题 + （YYYY年…通过）"块（避免撑爆 preamble 窗口；允许跨换行）
    txt = re.sub(r'[^\n]*\n（\d{4}\s*年[\s\S]*?通过）\s*', '\n', txt)
    # 1c) 去掉 PDF 中偶发的孤立 "X" 图标占位（两侧为中文时）
    txt = re.sub(r'(?<=[\u4e00-\u9fff])\s*X\s*(?=[\u4e00-\u9fff])', '', txt)
    # 1d) 去掉广东政府 PDF 的页眉"广东省人民政府规章广东省人民政府发布"（会注入正文）
    txt = re.sub(r'广东省人民政府规章\s*广东省人民政府发布', '', txt)
    # 2) 去掉 "目 录" 字样
    txt = re.sub(r'目[ 　\u3000]*录', ' ', txt)
    # 3) 去掉多余全角空格
    txt = txt.replace('\u3000', ' ')
    # 3b) 合并 PDF 字距产生的 "建 设 发 展" 类单字间隔（仅横向空格，保留换行）
    txt = re.sub(r'(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])', '', txt)
    # 4) 定位首个条文，找到其前紧邻的"真实第一章"，删除其间的目录块
    arts = list(ART_RE.finditer(txt))
    if not arts:
        return txt
    first_art = arts[0].start()
    chs = [m for m in CH_RE.finditer(txt) if m.start() < first_art]
    if not chs:
        return txt
    real_ch = chs[-1].start()          # 真实第一章（紧邻首条之前的章）
    first_ch = CH_RE.search(txt).start()  # 文档第一个章（目录里的章）
    # 删除 first_ch .. real_ch 之间的目录
    txt = txt[:first_ch] + txt[real_ch:]
    # 5) 确保每个 章/节/条 位于行首（PDF 偶尔会粘连），仅在非中文前导时断开
    #    先按现有换行整理
    lines = [l.rstrip() for l in txt.split('\n')]
    out = []
    for l in lines:
        out.append(l)
    return '\n'.join(out)

if __name__ == '__main__':
    pdf_path = sys.argv[1]
    out_path = sys.argv[2]
    t = clean_for_fill(pdf_to_text(pdf_path))
    open(out_path, 'w', encoding='utf-8').write(t)
    print('wrote', out_path, len(t), 'chars')
