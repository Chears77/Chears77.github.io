# -*- coding: utf-8 -*-
"""条文连续性扫描：检测每个法规文件内 `### 第X条` 序号是否存在跳号（如 22→24 缺23）。
仅扫描 LAW_LEVELS（法规级）文件；标准规范(09)用数字编号，单独处理。
输出 _gap_report.json + 可读报告。"""
import os, re, json

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(BASE, "法规库")
LAW_LEVELS = {'法律','司法解释','中央行政法规','中央部门规章','中央规范性文件',
              '地方行政法规','地方规章','地方规范性文件','标准规范'}

CN = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'零':0,'两':2}
UNITS = {'十':10,'百':100,'千':1000,'万':10000}

def cn2int(s):
    s = s.strip()
    if s.isdigit():
        return int(s)
    num = 0; buf = 0
    for ch in s:
        if ch in CN:
            buf = CN[ch]
        elif ch in UNITS:
            u = UNITS[ch]
            if buf == 0:
                buf = 1
            num += buf * u
            buf = 0
    num += buf
    return num

RE_ART = re.compile(r'^###\s*第\s*([一二三四五六七八九十百零两0-9]+)\s*条', re.M)
RE_FM = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.S)

def parse_level(text):
    m = RE_FM.match(text)
    if not m:
        return None
    for line in m.group(1).splitlines():
        if line.startswith('level:'):
            return line.split(':',1)[1].strip()
    return None

results = []
total_articles = 0
for dp, dn, fn in os.walk(ROOT):
    for f in sorted(fn):
        if not f.lower().endswith('.md'):
            continue
        fp = os.path.join(dp, f)
        try:
            text = open(fp, encoding='utf-8').read()
        except Exception as e:
            results.append({"file": f, "error": str(e)})
            continue
        level = parse_level(text)
        if level not in LAW_LEVELS:
            continue
        arts = []
        for m in RE_ART.finditer(text):
            try:
                arts.append(cn2int(m.group(1)))
            except Exception:
                pass
        if not arts:
            continue
        total_articles += len(arts)
        nums = sorted(set(arts))
        lo, hi = nums[0], nums[-1]
        full = set(range(lo, hi+1))
        missing = sorted(full - set(nums))
        # 只在「内部跳号」时报告（尾部缺失可能是节选，单独标注）
        interior = [n for n in missing if lo < n < hi]
        tail_missing = [n for n in missing if n > hi]  # 不会出现（hi是最大）
        if interior:
            results.append({
                "file": f, "level": level, "count": len(nums),
                "min": lo, "max": hi,
                "interior_missing": interior,
                "dup": len(arts) != len(set(arts)),
                "raw_seq_sample": nums[:6] + (['...'] if len(nums) > 6 else []) + nums[-3:]
            })

print(f"扫描法规级文件，命中条文总数约 {total_articles}")
print(f"存在内部跳号的文件数：{len(results)}")
print("=" * 70)
for r in results:
    print(f"\n📄 {r['file']}  [{r['level']}]  共{len(r.get('interior_missing',[]))}处跳号")
    print(f"   条文范围 {r['min']}–{r['max']}，缺失: {r['interior_missing']}")
    if r.get('dup'):
        print("   ⚠ 存在重复条号")

with open(os.path.join(BASE, "_gap_report.json"), "w", encoding="utf-8") as fo:
    json.dump(results, fo, ensure_ascii=False, indent=1)
print("\n已写出 _gap_report.json")
