# -*- coding: utf-8 -*-
import os, re
from collections import Counter
LIB = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\3第二版\法规库"
NEED = {'法律','司法解释','中央行政法规','中央部门规章','中央规范性文件',
        '地方行政法规','地方规章','地方规范性文件','标准规范'}
SKIP = {'司法案例','行政案例','政策解读'}
KW = {'发布','公布','通过','修订','修正','施行','颁布'}
def parse_fm(txt):
    m = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n', txt, re.S)
    if not m: return None, txt
    fm={}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k,v=line.split(':',1); fm[k.strip()]=v.strip()
    return fm, txt[m.end():]
def has_std(body):
    lines=body.split('\n'); started=False
    for ln in lines:
        if ln.startswith('# ') and not started: started=True; continue
        if started:
            if ln.startswith('## '): break
            s=ln.strip()
            if s.startswith('（') and s.endswith('）') and any(k in s for k in KW): return True
    return False
bad_fm=[]; no_h1=[]; missing_note_need=[]; rev_unverified_missing=[]; rev_unverified_has=[]; helper=[]
for root,_,files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'): continue
        full=os.path.join(root,f)
        txt=open(full,encoding='utf-8').read()
        fm,body=parse_fm(txt)
        if fm is None:
            helper.append(f); continue
        lvl=fm.get('level','')
        if lvl in SKIP: continue
        bl=txt.split('\n')
        h1=any(ln.startswith('# ') and not ln.startswith('## ') for ln in bl)
        if not h1:
            no_h1.append(full); continue
        hs=has_std(body)
        if lvl in NEED:
            if not hs:
                missing_note_need.append(full)
        # revision-type (未核实清单) 缺说明统计
        title=fm.get('title','')
        if (('修正' in title or '修订' in title) or fm.get('revise_date')) and lvl in NEED:
            if hs: rev_unverified_has.append(full)
            else: rev_unverified_missing.append(full)
print("坏FM(辅助文档):", len(helper))
print("缺H1:", len(no_h1))
print("NEED 类缺说明(总数):", len(missing_note_need))
print("  其中 revision-type未核实 缺说明:", len(rev_unverified_missing))
print("  其中 非revision-type 缺说明:", len(missing_note_need)-len(rev_unverified_missing))
print("revision-type未核实 已有说明(无需处理):", len(rev_unverified_has))
print("\n--- NEED 非revision 缺说明明细(应为0) ---")
for x in missing_note_need:
    if x in rev_unverified_missing: continue
    print("  ", os.path.relpath(x, LIB))
print("\n--- revision-type未核实 且缺说明(待后续核实) ---")
for x in rev_unverified_missing:
    print("  ", os.path.relpath(x, LIB))
