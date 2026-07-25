# -*- coding: utf-8 -*-
import os, re, json
from collections import Counter, defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(BASE, "法规库")

LEVEL_ORDER = ['法律','司法解释','中央行政法规','中央部门规章','中央规范性文件',
               '地方行政法规','地方规章','地方规范性文件','标准规范','司法案例','行政案例','政策解读']
VALID_LEVELS = set(LEVEL_ORDER)
LAW_LEVELS = {'法律','司法解释','中央行政法规','中央部门规章','中央规范性文件',
              '地方行政法规','地方规章','地方规范性文件','标准规范'}
DOC_LEVELS = {'司法案例','行政案例','政策解读'}

RE_ART = re.compile(r'^###\s*第[一二三四五六七八九十百零0-9]+[条款]', re.M)
RE_H1  = re.compile(r'^#\s+\S', re.M)
RE_ART_BROAD = re.compile(r'第[一二三四五六七八九十百零0-9]+条')
RE_CH = re.compile(r'^##\s*第[一二三四五六七八九十百零0-9]+章', re.M)
RE_PLACE = re.compile(r'待补全|待补|全文待|条文全文|placeholder|（条文|要点：|要点:')

def parse_fm(text):
    if not text.startswith('---'):
        return {}, text, False
    parts = text.split('---', 2)
    if len(parts) < 3:
        return {}, text, False
    fm = {}
    for line in parts[1].splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, parts[2], True

def valid_date(s):
    if not s: return False
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', s)
    if m:
        y,mo,d = map(int, m.groups())
        return 1<=mo<=12 and 1<=d<=31
    m2 = re.match(r'^(\d{4})(\d{2})(\d{2})$', s)
    if m2:
        y,mo,d = map(int, m2.groups())
        return 1<=mo<=12 and 1<=d<=31
    return False

def to_iso(s):
    if not s: return None
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', s)
    if m: return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m2 = re.match(r'^(\d{4})(\d{2})(\d{2})$', s)
    if m2: return f"{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"
    return None

files = []
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if f.lower().endswith('.md'):
            files.append(os.path.join(dp, f))
files.sort()

issues = []
level_counts = Counter()
status_counts = Counter()
doc_type_vals = Counter()
articles_per_law = []
no_article_laws = []
duplicate_titles = defaultdict(list)
bad_level = []
missing_title = []
bad_dates = []
date_order = []
no_h1 = []
empty_body = []
doc_type_mismatch_level = []

for fp in files:
    rel = os.path.relpath(fp, ROOT)
    level_dir = rel.split(os.sep)[0]
    try:
        text = open(fp, encoding='utf-8').read()
    except Exception as e:
        issues.append({"file":rel,"issues":[f"read-error:{e}"]}); continue
    fm, body, ok = parse_fm(text)
    if not ok:
        issues.append({"file":rel,"issues":["no-frontmatter"]}); continue
    level_counts[level_dir]+=1
    fi=[]
    level = fm.get('level','').strip()
    if level not in VALID_LEVELS:
        bad_level.append((rel, level)); fi.append(f"bad-level:{level!r}")
    title = fm.get('title','').strip()
    if not title:
        missing_title.append(rel); fi.append("missing:title")
    else:
        duplicate_titles[title].append(rel)
    status = fm.get('status','').strip()
    if status: status_counts[status]+=1
    dt = fm.get('doc_type')
    if dt:
        doc_type_vals[dt]+=1
        if level in DOC_LEVELS and dt=='law': doc_type_mismatch_level.append((rel,level,dt))
        if level in LAW_LEVELS and dt=='doc': doc_type_mismatch_level.append((rel,level,dt))
    # dates
    pd_raw = fm.get('publish_date','')
    ed_raw = fm.get('effective_date','')
    if pd_raw and not valid_date(pd_raw):
        bad_dates.append((rel,'publish_date',pd_raw)); fi.append(f"bad-date:publish={pd_raw}")
    if ed_raw and not valid_date(ed_raw):
        bad_dates.append((rel,'effective_date',ed_raw)); fi.append(f"bad-date:effective={ed_raw}")
    pd, ed = to_iso(pd_raw), to_iso(ed_raw)
    if pd and ed and pd > ed:
        # 司法案例/行政案例/政策解读 的 publish_date 常为入库/通报日，晚于 underlying 裁判/施行日，属正常
        if level not in DOC_LEVELS:
            date_order.append((rel,pd,ed)); fi.append("date-order:publish>effective")
    # body
    if len(body.strip()) < 40:
        empty_body.append(rel); fi.append("empty-body")
    else:
        if not RE_H1.search(body):
            no_h1.append(rel); fi.append("no-h1")
        if level in LAW_LEVELS:
            n = len(RE_ART.findall(body))
            broad = len(RE_ART_BROAD.findall(body))
            nch = len(RE_CH.findall(body))
            has_place = bool(RE_PLACE.search(body))
            articles_per_law.append((rel, level, n, broad, nch, has_place))
            if n == 0:
                # classify why no strict articles
                if broad == 0 and (nch>0 or has_place):
                    cls = "STUB_NO_TEXT"      # chapter skeleton but no article text
                elif broad > 0:
                    cls = "OTHER_FORMAT"      # has 条 text but not as ### 第X条 heading
                elif level == '司法解释':
                    cls = "NARRATIVE_OK"      # 司法解释 narrative, acceptable
                else:
                    cls = "NO_ART_UNKNOWN"
                no_article_laws.append((rel, level, cls, broad, nch, has_place))
                fi.append(f"law-{cls.lower()}")
    if fi:
        issues.append({"file":rel,"issues":fi})

dup = {t:ps for t,ps in duplicate_titles.items() if len(ps)>1}

summary = {
    "total_files": len(files),
    "level_counts_dir": dict(level_counts),
    "status_counts": dict(status_counts),
    "doc_type_values": dict(doc_type_vals),
    "bad_level": bad_level,
    "missing_title": missing_title,
    "bad_dates": bad_dates,
    "date_order_pub_gt_eff": date_order,
    "no_h1": no_h1,
    "empty_body": empty_body,
    "law_no_articles": no_article_laws,
    "doc_type_level_mismatch": doc_type_mismatch_level,
    "duplicates": dup,
    "files_with_issues": len(issues),
    "article_count_stats": {
        "law_files": len(articles_per_law),
        "min": min((a[2] for a in articles_per_law), default=0),
        "max": max((a[2] for a in articles_per_law), default=0),
        "zero": sum(1 for a in articles_per_law if a[2]==0),
        "lt3": sum(1 for a in articles_per_law if 0<a[2]<3),
    },
    "stub_classification": {c: sum(1 for x in no_article_laws if x[2]==c) for c in
        sorted(set(x[2] for x in no_article_laws))},
    "stub_by_level": {lv: sum(1 for x in no_article_laws if x[1]==lv and x[2] in ('STUB_NO_TEXT','NO_ART_UNKNOWN'))
                      for lv in LEVEL_ORDER if any(x[1]==lv for x in no_article_laws)},
}
out = {"summary":summary, "details": issues}
with open(os.path.join(BASE,"_audit_report.json"),"w",encoding="utf-8") as f:
    json.dump(out,f,ensure_ascii=False,indent=1)

print("=== 审计汇总（修正后）===")
print("总文件数:", len(files))
print("有问题文件:", len(issues))
print("层级目录:", dict(level_counts))
print("状态分布:", dict(status_counts))
print("\n关键问题:")
print("  bad_level(层级非法):", len(bad_level), bad_level[:10])
print("  missing_title:", len(missing_title))
print("  bad_dates(非法日期):", len(bad_dates), bad_dates[:10])
print("  date_order(publish>effective):", len(date_order), date_order[:10])
print("  no_h1(缺H1标题):", len(no_h1), no_h1)
print("  empty_body:", len(empty_body))
print("  law_no_articles(法规级但无条文):", len(no_article_laws), no_article_laws[:20])
print("  doc_type与level矛盾:", len(doc_type_mismatch_level), doc_type_mismatch_level[:10])
print("  duplicate_titles:", len(dup))
print("\n条文数统计(law级):", summary["article_count_stats"])
print("stub 分类(无严格条文):", summary["stub_classification"])
print("真正缺全文的 stub 按层级:", summary["stub_by_level"])
print("\ndoc_type 取值分布:", dict(doc_type_vals))
print("\n=== 详情(全部 issue 文件) ===")
for it in issues:
    print(it["file"], "->", ", ".join(it["issues"]))
