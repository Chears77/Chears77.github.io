# -*- coding: utf-8 -*-
"""对 3第二版/法规库（网站部署真实数据源，560 文件）补写法规动态说明。
  - 61 个已联网核实的修订类文件：写入核实后的标准括号说明（rev_result_batch*.json）。
  - 其余法律/法规/规章/规范性文件/标准类文件：若无标准说明，则自动生成"（公布日期+机构+文号+动词，自施行日期起施行）"。
  - 跳过：司法案例/行政案例/政策解读、无 FM 的辅助文档、已有标准说明的文件。
  - 修订类但不在核实清单中的（应按需另核）：跳过并登记，绝不用"公布+施行"冒充。
安全：用 FM 结束位置插入，绝不匹配 FM 开头的 ---。
"""
import os, re, json
from collections import Counter

V1 = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\2第一版"
LIB = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\3第二版\法规库"

notes = {}
for i in range(1, 9):
    p = os.path.join(V1, f"rev_result_batch{i}.json")
    if os.path.exists(p):
        notes.update(json.load(open(p, encoding='utf-8')))

NEED = {'法律','司法解释','中央行政法规','中央部门规章','中央规范性文件',
        '地方行政法规','地方规章','地方规范性文件','标准规范'}
SKIP_LEVEL = {'司法案例','行政案例','政策解读'}
KW = {'发布','公布','通过','修订','修正','施行','颁布'}

def parse_fm(txt):
    m = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n', txt, re.S)
    if not m:
        return None, txt, txt
    fm = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            fm[k.strip()] = v.strip()
    return fm, m.group(0), txt[m.end():]

def cn(d):
    d = (d or '').strip().strip('"')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', d):
        return ''
    y, m, dd = d.split('-')
    return f"{int(y)}年{int(m)}月{int(dd)}日"

def verb(lv):
    return {'法律':'公布','中央行政法规':'公布','中央部门规章':'发布','中央规范性文件':'印发',
            '地方行政法规':'公布','地方规章':'发布','地方规范性文件':'印发','标准规范':'发布'}.get(lv,'公布')

def org(lv, doc, publ):
    doc = doc or ''; publ = publ or ''
    if lv in ('法律','中央行政法规','中央部门规章'):
        return '中华人民共和国' + doc
    if lv in ('中央规范性文件','地方规范性文件'):
        return (publ + doc) if publ else doc
    if lv in ('地方行政法规','地方规章'):
        return doc
    if lv == '标准规范':
        return publ if publ else ('中华人民共和国' + doc)
    return doc

def build(fm):
    lv = fm.get('level','')
    pub = fm.get('publish_date',''); eff = fm.get('effective_date','')
    doc = fm.get('doc_number',''); publ = fm.get('publisher','')
    pc = cn(pub); ec = cn(eff)
    if not (pc and ec):
        return None
    return f"（{pc}{org(lv,doc,publ)}{verb(lv)}，自{ec}起施行）"

def is_debris(ln):
    s = ln.strip()
    if not s:
        return False
    if s.startswith('>'):
        s2 = s[1:].strip()
        if '发布机构' in s2 or '说明' in s2 or '颁布' in s2:
            return True
        if s2.startswith('（') and s2.endswith('）'):
            return True
        return False
    if s.startswith('（') and s.endswith('）'):
        return any(k in s for k in KW)
    return False

def has_std(body):
    lines = body.split('\n'); started = False
    for ln in lines:
        if ln.startswith('# ') and not started:
            started = True; continue
        if started:
            if ln.startswith('## '):
                break
            s = ln.strip()
            if s.startswith('（') and s.endswith('）') and any(k in s for k in KW):
                return True
    return False

def apply_note(full, note):
    txt = open(full, encoding='utf-8').read()
    fm, fm_raw, body = parse_fm(txt)
    if fm is None:
        return 'nofm'
    title = (fm.get('title') or '').strip().strip('"')
    body_lines = body.split('\n')
    h1_idx = None
    for idx, ln in enumerate(body_lines):
        if ln.startswith('# ') and not ln.startswith('## '):
            h1_idx = idx; break
    if h1_idx is None:
        kept = [l for l in body_lines if not is_debris(l)]
        new_body = ['# ' + title, '', note]
        if kept:
            new_body.append(''); new_body.extend(kept)
        new_full = fm_raw + '\n' + '\n'.join(new_body) + '\n'
        open(full, 'w', encoding='utf-8').write(new_full)
        return 'no_h1_added'
    h1_line = body_lines[h1_idx]
    kept_after = []
    for idx, ln in enumerate(body_lines):
        if idx == h1_idx:
            continue
        if idx < h1_idx:
            kept_after.append(ln); continue
        if is_debris(ln):
            continue
        kept_after.append(ln)
    new_body = [h1_line, '', note]
    if kept_after:
        new_body.append(''); new_body.extend(kept_after)
    new_full = fm_raw + '\n' + '\n'.join(new_body) + '\n'
    open(full, 'w', encoding='utf-8').write(new_full)
    return 'ok'

stats = Counter()
revision_unverified = []
for root, _, files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'):
            continue
        full = os.path.join(root, f)
        rel = os.path.relpath(full, LIB).replace(os.sep, '/')
        txt = open(full, encoding='utf-8').read()
        fm, _, body = parse_fm(txt)
        if fm is None:
            stats['skip_helperdoc'] += 1
            continue
        level = fm.get('level', '')
        if level in SKIP_LEVEL:
            stats['skip_doclevel'] += 1
            continue
        if rel in notes:
            r = apply_note(full, notes[rel])
            stats['revision_' + r] += 1
            continue
        # 修订类但不在核实清单：登记并跳过（不用公布+施行冒充）
        title = (fm.get('title') or '')
        if (('修正' in title or '修订' in title) or fm.get('revise_date')) and level in NEED:
            revision_unverified.append(rel)
            stats['skip_revision_unverified'] += 1
            continue
        if has_std(body):
            stats['skip_has_std'] += 1
            continue
        if level in NEED:
            note = build(fm)
            if note:
                r = apply_note(full, note)
                stats['autogen_' + r] += 1
            else:
                stats['skip_nodate'] += 1
        else:
            stats['skip_other_level'] += 1

print("=== 统计 ===")
for k, v in stats.most_common():
    print(f"  {k}: {v}")
print(f"\n修订类但未在核实清单(已跳过,待另核): {len(revision_unverified)}")
for x in revision_unverified:
    print("  ", x)
print(f"\n合并核实修订说明数: {len(notes)}")
