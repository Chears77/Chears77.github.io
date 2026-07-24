# -*- coding: utf-8 -*-
# 对 3第二版/法规库 中「中央规范性文件」类、且尚无法规动态说明的文件，
# 依 FM 的 publish_date/effective_date/doc_number/publisher 自动生成
# "（印发日期+发布机关+文号+印发，自施行日期起施行）" 说明。无需联网。
import os, re
LIB = r"E:\AI\workbuddy\20260624副业\20260713工程建设法规AI知识库\3第二版\法规库"
KW = {'发布','公布','通过','修订','修正','施行','颁布'}
def parse_fm(txt):
    m = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n', txt, re.S)
    if not m: return None, txt, txt
    fm={}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k,v=line.split(':',1); fm[k.strip()]=v.strip()
    return fm, m.group(0), txt[m.end():]
def cn(d):
    d=(d or '').strip().strip('"')
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', d): return ''
    y,mo,dd=d.split('-'); return f"{int(y)}年{int(mo)}月{int(dd)}日"
def has_std(body):
    lines=body.split('\n'); started=False
    for ln in lines:
        if ln.startswith('# ') and not started: started=True; continue
        if started:
            if ln.startswith('## '): break
            s=ln.strip()
            if s.startswith('（') and s.endswith('）') and any(k in s for k in KW): return True
    return False
def is_debris(ln):
    s=ln.strip()
    if not s: return False
    if s.startswith('>'):
        s2=s[1:].strip()
        if '发布机构' in s2 or '说明' in s2 or '颁布' in s2: return True
        if s2.startswith('（') and s2.endswith('）'): return True
        return False
    if s.startswith('（') and s.endswith('）'): return any(k in s for k in KW)
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

done=0; skip=0; nodate=0
for root,_,files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'): continue
        full=os.path.join(root,f)
        txt=open(full,encoding='utf-8').read()
        fm,_,body=parse_fm(txt)
        if fm is None: continue
        if fm.get('level')!='中央规范性文件': continue
        if has_std(body): skip+=1; continue
        pub=cn(fm.get('publish_date','')); eff=cn(fm.get('effective_date',''))
        if not(pub and eff): nodate+=1; continue
        doc=fm.get('doc_number','') or ''; publ=fm.get('publisher','') or ''
        org=(publ+doc) if publ else doc
        note=f"（{pub}{org}印发，自{eff}起施行）"
        apply_note(full, note); done+=1
print(f"中央规范性文件 自动生成说明: {done}; 已有跳过: {skip}; 缺日期跳过: {nodate}")
