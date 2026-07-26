# -*- coding: utf-8 -*-
import json, os
BASE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(BASE, "_gap_report.json"), encoding="utf-8"))

# 民法典合同编(建设工程合同) 是节选(788-804)，属于正常 curated 子集，非缺陷
CURATED = {"中华人民共和国民法典（合同编·建设工程合同）.md"}

small, stub, curated = [], [], []
for r in data:
    f = r["file"]
    missing = r["interior_missing"]
    lo, hi = r["min"], r["max"]
    span = hi - lo + 1
    ratio = len(missing) / span if span else 0
    if any(c in f for c in CURATED):
        curated.append(r); continue
    # 判定：缺失条数少且比例低 => 局部小缺口；否则残本
    if len(missing) <= 10 and ratio < 0.25:
        small.append((f, lo, hi, len(missing), ratio, missing))
    else:
        stub.append((f, lo, hi, len(missing), ratio, missing))

def show(title, lst):
    print(f"\n########## {title}（{len(lst)} 个）##########")
    for f, lo, hi, n, ratio, miss in sorted(lst, key=lambda x:-x[3]):
        print(f"  [{n}缺/{ratio*100:.0f}%] {f}")
        print(f"        缺失: {miss}")

show("局部小缺口（可精准补条）", small)
show("整段残本（需补全文）", stub)
print(f"\n########## 节选子集（正常，跳过）##########  {len(curated)} 个")

print(f"\n汇总: 小缺口 {len(small)} | 残本 {len(stub)} | 节选 {len(curated)}")

# 写出便于 agent 使用的清单
with open(os.path.join(BASE, "_gap_small.json"), "w", encoding="utf-8") as fo:
    json.dump([{"file":f,"min":lo,"max":hi,"missing":m} for f,lo,hi,n,r,m in small], fo, ensure_ascii=False, indent=1)
with open(os.path.join(BASE, "_gap_stub.json"), "w", encoding="utf-8") as fo:
    json.dump([{"file":f,"min":lo,"max":hi,"missing":m} for f,lo,hi,n,r,m in stub], fo, ensure_ascii=False, indent=1)
print("已写出 _gap_small.json / _gap_stub.json")
