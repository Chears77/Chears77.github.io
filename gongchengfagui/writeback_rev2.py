# -*- coding: utf-8 -*-
# 将第二轮核实的 rev2_result_batch*.json 写回 3第二版/法规库。
import os, re, json
from collections import Counter
V1 = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\3第二版"
LIB = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\3第二版\法规库"
def norm_note(v):
    if isinstance(v, str):
        s=v
    elif isinstance(v, dict):
        s=None
        for k in ('note','说明文本','statement','text','value'):
            if k in v and isinstance(v[k], str):
                s=v[k]; break
        if s is None:
            for vv in v.values():
                if isinstance(vv, str) and vv.startswith('（'):
                    s=vv; break
        if s is None:
            return None
    else:
        return None
    # 统一半角括号为全角，保证与全库风格一致
    if s.startswith('(') and s.endswith(')'):
        s='（'+s[1:-1]+'）'
    return s
notes={}
for i in range(1,9):
    p=os.path.join(V1, f"rev2_result_batch{i}.json")
    if os.path.exists(p):
        for k,v in json.load(open(p,encoding='utf-8')).items():
            nn=norm_note(v)
            if nn: notes[k]=nn
            else: print("  跳过无法解析:", k)
print("合并核实条目:", len(notes))
KW={'发布','公布','通过','修订','修正','施行','颁布'}
def parse_fm(txt):
    m=re.match(r'^---\r?\n(.*?)\r?\n---\r?\n', txt, re.S)
    if not m: return None, txt, txt
    fm={}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k,v=line.split(':',1); fm[k.strip()]=v.strip()
    return fm, m.group(0), txt[m.end():]
def is_debris(ln):
    s=ln.strip()
    if not s: return False
    if s.startswith('>'):
        s2=s[1:].strip()
        if '发布机构' in s2 or '说明' in s2 or '颁布' in s2: return True
        if s2.startswith('（') and s2.endswith('）'): return True
        if s2.startswith('(') and s2.endswith(')'): return True
        return False
    if s.startswith('（') and s.endswith('）'): return any(k in s for k in KW)
    if s.startswith('(') and s.endswith(')'): return any(k in s for k in KW)
    return False
def apply_note(full, note):
    txt=open(full,encoding='utf-8').read()
    fm,fm_raw,body=parse_fm(txt)
    if fm is None: return 'nofm'
    title=(fm.get('title') or '').strip().strip('"')
    bl=body.split('\n'); h1=None
    for i,ln in enumerate(bl):
        if ln.startswith('# ') and not ln.startswith('## '): h1=i; break
    if h1 is None:
        kept=[l for l in bl if not is_debris(l)]
        nb=['# '+title,'',note]
        if kept: nb.append(''); nb.extend(kept)
        open(full,'w',encoding='utf-8').write(fm_raw+'\n'+'\n'.join(nb)+'\n'); return 'no_h1'
    h1line=bl[h1]; ka=[]
    for i,ln in enumerate(bl):
        if i==h1: continue
        if i<h1: ka.append(ln); continue
        if is_debris(ln): continue
        ka.append(ln)
    nb=[h1line,'',note]
    if ka: nb.append(''); nb.extend(ka)
    open(full,'w',encoding='utf-8').write(fm_raw+'\n'+'\n'.join(nb)+'\n'); return 'ok'
stats=Counter(); missing=[]
for rel,note in notes.items():
    full=os.path.join(LIB, rel.replace('/',os.sep))
    if not os.path.exists(full):
        missing.append(rel); stats['missing']+=1; continue
    stats['_'+apply_note(full,note)]+=1
print("写回统计:", dict(stats))
if missing:
    print("缺失文件:", missing)
