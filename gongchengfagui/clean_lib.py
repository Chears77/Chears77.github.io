# -*- coding: utf-8 -*-
"""clean_lib.py — 清洗法规库 md 源文件：
1) 去除抓取时混入的网页 HTML/JS 残留（rel_appendix、showTitleBox、网站无障碍、字号：、来源：、分享到 等）；
2) 补全缺失的 field（领域）标签，避免前端显示 undefined。
只修改 法规库/ 下的源文件（活源）；laws/ 与 data/ 稍后由 build_data.py 重建。
"""
import os, re

LIB = '法规库'

# ---- 强标记：出现即代表“代码/脚本开始”，用于截断（法条正文在条首，垃圾在条尾） ----
STRONG = [
    r'var\s+[\w$]', r'function\s*\(', r'\$\(', r'\$\.', r'<script', r'<style', r'<!--',
    r'document\.', r'window\.', r"if\('\d+'.*?\{", r'mCustomScrollbar', r'JumpObj',
    r'rel_appendix', r'showTitle', r'gknb_content', r'event\.', r'#tipr', r'\.itemr',
    r'onclick\s*=', r'<[a-zA-Z/]', r'getElementById', r'\.bind\(', r'\$\w',
]
STRONG_RE = re.compile('|'.join(STRONG), re.IGNORECASE)

# ---- 标签类垃圾：直接剔除这些子串 ----
LABEL = [
    r'网站无障碍开关\s*-->?', r'网站无障碍', r'字号：\s*默认\s*大\s*超大\s*\|?\s*打印\s*\|?',
    r'字号：\s*[^）\n]*', r'字体：\s*\[?[^\]]*\]?', r'来源：\s*[^）\n]*',
    r'分享到[^，。\n）]*', r'视频下载', r'打印\s*\|?', r'默认\s*大\s*超大',
    r'国务院公报\s*>\s*\d+年第\d+号', r'名\s*称：\s*[^）\n]*', r'文\s*号：\s*[^）\n]*',
    r'发布日期：\s*[^）\n]*', r'目\s*录', r'字体：',
]
LABEL_RE = re.compile('|'.join(LABEL))
HTML_RE = re.compile(r'<!--.*?-->', re.DOTALL | re.IGNORECASE)
SCRIPT_RE = re.compile(r'<script.*?</script>', re.DOTALL | re.IGNORECASE)
STYLE_RE = re.compile(r'<style.*?</style>', re.DOTALL | re.IGNORECASE)
TAG_RE = re.compile(r'<[^>]+>')
WS_RE = re.compile(r'[ \t]{2,}')

def clean_block(text):
    """清洗一个文本块（法条正文）：去标签/脚本/标签垃圾，必要时按强标记截断。"""
    t = text
    t = HTML_RE.sub('', t)
    t = SCRIPT_RE.sub('', t)
    t = STYLE_RE.sub('', t)
    t = TAG_RE.sub('', t)
    t = LABEL_RE.sub('', t)
    m = STRONG_RE.search(t)
    if m and m.start() > 0:
        t = t[:m.start()]
    t = WS_RE.sub(' ', t)
    return t.strip()

# ---- field 推断 ----
FIELD_KW = [
    ('招投标','招投标'),('招标','招投标'),('投标','招投标'),('采购','招投标'),
    ('施工','施工管理'),('安全','施工安全'),('质量','工程质量'),('资质','企业资质'),('分包','施工管理'),('劳务','施工管理'),
    ('建筑','建筑市场'),('住房','建筑市场'),('房地产','建筑市场'),('市政','市政水务'),('给水','市政水务'),
    ('排水','市政水务'),('供水','市政水务'),('水务','市政水务'),('污水','市政水务'),('燃气','市政水务'),('园林','市政水务'),
    ('交通','交通运输'),('公路','交通运输'),('桥梁','交通运输'),('铁路','交通运输'),('轨道','交通运输'),('港口','交通运输'),('水运','交通运输'),
    ('标准化','标准化'),('标准','工程建设标准'),('规范','工程建设标准'),('节能','绿色建筑'),('绿色','绿色建筑'),
    ('防水','市政水务'),('勘察','工程设计'),('设计','工程设计'),('造价','工程造价'),('合同','合同造价'),
    ('用地','土地规划'),('规划','土地规划'),('立项','前期管理'),('发包','前期管理'),('监理','工程监理'),
    ('环境','生态环境'),('污染','生态环境'),('水土保持','水利'),('防洪','水利'),('水利','水利'),('水资源','水利'),
    ('河道','水利'),('岸线','水利'),('地震','抗震防灾'),('消防','消防安全'),('诉讼','争议解决'),
    ('仲裁','争议解决'),('行政','行政管理'),('许可','行政管理'),('处罚','行政管理'),('财税','财税'),('税收','财税'),('契税','财税'),
]
LEVEL_FIELD = {'标准规范':'工程建设标准', '法律':'法律综合', '司法案例':'典型案例', '行政案例':'典型案例'}
def infer_field(level, title, field):
    if field and field.strip():
        return field.strip()
    for kw, f in FIELD_KW:
        if kw in (title or ''):
            return f
    return LEVEL_FIELD.get(level, '通用')

def parse_fm(text):
    meta = {}; body = text
    if text.startswith('---'):
        parts = text.split('---', 2)
        if len(parts) >= 3:
            for line in parts[1].splitlines():
                if ':' in line:
                    k, _, v = line.partition(':')
                    meta[k.strip()] = v.strip()
            body = parts[2]
    return meta, body

def meta_intro(meta):
    dn = meta.get('doc_number',''); pd = meta.get('publish_date',''); ed = meta.get('effective_date','')
    mi = ''
    if dn: mi += dn
    if pd: mi += (('，'+pd+'公布') if mi else (pd+'公布'))
    if ed: mi += ('，自'+ed+'起施行')
    return ('（'+mi+'）') if mi else ''

def rebuild_fm(meta):
    lines = ['---']
    for k in ['title','level','region','publisher','doc_number','publish_date','effective_date','revise_date','status','doc_type','field','source_url','verify_status']:
        if k in meta and meta[k] != '':
            lines.append('%s: %s' % (k, meta[k]))
    lines.append('---')
    return '\n'.join(lines) + '\n'

def clean_file(path):
    text = open(path, encoding='utf-8').read()
    meta, body = parse_fm(text)
    meta['field'] = infer_field(meta.get('level',''), meta.get('title',''), meta.get('field',''))
    lines = body.split('\n')
    result = []
    intro = []
    seen_body = False
    for raw in lines:
        st = raw.strip()
        if not seen_body:
            if st.startswith('# '):            # 一级标题（法规名）
                result.append(raw); continue
            if st.startswith('## ') or RE_ART.match(st):   # 章/节 或 首条
                seen_body = True; result.append(raw); continue
            intro.append(st); continue
        # 正文
        if st.startswith('#'):
            result.append(raw)
        elif st == '':
            result.append(raw)
        else:
            c = clean_block(raw)
            if c: result.append(c)
    # 前言：含垃圾则替换为规范前言，否则保留原前言
    junk = any(HTML_RE.search(x) or SCRIPT_RE.search(x) or LABEL_RE.search(x) or STRONG_RE.search(x) for x in intro)
    if junk:
        mi = meta_intro(meta)
        if mi:
            for i, r in enumerate(result):
                if r.strip().startswith('# '):
                    result.insert(i+1, mi); break
    else:
        # 把原前言（非空）插回标题之后
        kept = [x for x in intro if x]
        if kept:
            for i, r in enumerate(result):
                if r.strip().startswith('# '):
                    for j, k in enumerate(kept):
                        result.insert(i+1+j, k)
                    break
    new_text = rebuild_fm(meta) + '\n' + '\n'.join(result)
    if new_text != text:
        open(path, 'w', encoding='utf-8').write(new_text)
        return True
    return False

RE_ART = re.compile(r'^###\s*第[一二三四五六七八九十百零0-9]+[条款]')

def main():
    changed = 0; field_fixed = 0; total = 0
    for root, _, files in os.walk(LIB):
        for fn in sorted(files):
            if not fn.endswith('.md'): continue
            total += 1
            p = os.path.join(root, fn)
            before = open(p, encoding='utf-8').read()
            bm = parse_fm(before)[0]
            if clean_file(p):
                changed += 1
            after = open(p, encoding='utf-8').read()
            am = parse_fm(after)[0]
            if bm.get('field','').strip() != am.get('field','').strip() and am.get('field','').strip():
                field_fixed += 1
    print('TOTAL:', total, 'CHANGED:', changed, 'FIELD_FIXED:', field_fixed)

if __name__ == '__main__':
    main()
