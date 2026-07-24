# -*- coding: utf-8 -*-
# 收集「非中央规范性文件」且 revision-type 且缺说明 的文件，写 rev2_batches.txt 供 Agent 核实。
import os, re
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

missing=[]
for root,_,files in os.walk(LIB):
    for f in files:
        if not f.endswith('.md'): continue
        full=os.path.join(root,f)
        txt=open(full,encoding='utf-8').read()
        fm,body=parse_fm(txt)
        if fm is None: continue
        lvl=fm.get('level','')
        if lvl in SKIP or lvl=='中央规范性文件': continue
        if lvl not in NEED: continue
        if has_std(body): continue
        title=fm.get('title','')
        if ('修正' in title or '修订' in title) or fm.get('revise_date'):
            missing.append(full)
order={'法律':0,'司法解释':1,'中央行政法规':2,'中央部门规章':3,'地方行政法规':5,
       '地方规章':6,'地方规范性文件':7,'标准规范':8}
missing.sort(key=lambda p: (order.get(parse_fm(open(p,encoding='utf-8').read())[0].get('level',''),9), p))
n=len(missing)
per=max(1,n//8)
batches=[missing[i*per:(i+1)*per] for i in range(8)]
batches[7].extend(missing[8*per:])
batches=[b for b in batches if b]
with open(os.path.join(LIB,'..','rev2_batches.txt'),'w',encoding='utf-8') as fo:
    for bi,bt in enumerate(batches,1):
        fo.write(f"=== 批次{bi} ({len(bt)}个) ===\n")
        for p in bt:
            fo.write(p.replace('/',os.sep)+"\n")
print(f"待核实修订类(非中央规范性文件): {n} 个，分 {len(batches)} 批")
for bi,bt in enumerate(batches,1):
    print(f"  批次{bi}: {len(bt)}")
