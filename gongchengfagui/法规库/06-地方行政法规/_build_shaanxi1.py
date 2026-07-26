import re

SRC_PDF = "shaanxi_ztb.txt"
SRC_MD  = "20041001-陕西省人大常委会公告第25号-陕西省实施《中华人民共和国招标投标法》办法.md"
OUT_MD  = SRC_MD

# ---- parse PDF ----
cn_num = "零一二三四五六七八九十"
def cn2int(s):
    if s == "十":
        return 10
    if "十" in s:
        a, b = s.split("十", 1)
        return (cn_num.index(a) if a else 1) * 10 + (cn_num.index(b) if b else 0)
    return cn_num.index(s)

raw = open(SRC_PDF, encoding="utf-8").read().splitlines()
chap_re = re.compile(r'^第[一二三四五六七八九十]+章$')
art_re = re.compile(r'^第([零一二三四五六七八九十]+)条$')
skip = {"－", "目录", "总则", "招标范围和规模标准", "招标、投标", "招标和投标",
        "开标、评标和中标", "开标评标中标", "监督", "法律责任", "附则"}
articles = {}
cur = None
buf = []
for line in raw:
    line = line.strip()
    if not line or line in skip or chap_re.match(line):
        continue
    m = art_re.match(line)
    if m:
        if cur is not None:
            articles[cur] = buf
        cur = cn2int(m.group(1))
        buf = []
        continue
    if re.match(r'^\d+$', line) or line == "－":
        continue
    if cur is not None:
        buf.append(line)
if cur is not None:
    articles[cur] = buf

def int2cn(n):
    if n <= 10:
        return "一二三四五六七八九十"[n - 1]
    if 10 < n < 20:
        return "十" + "一二三四五六七八九"[n - 11]
    t = n // 10
    o = n % 10
    s = "一二三四五六七八九"[t - 1] + "十"
    if o:
        s += "一二三四五六七八九"[o - 1]
    return s

def fmt_body(lines):
    full = "".join(lines)
    parts = re.split(r'(?=（[一二三四五六七八九十]+）)', full)
    return [p.strip() for p in parts if p.strip()]

# ---- chapter structure (original titles) ----
chapters = [
    ("第一章 总则", list(range(1, 6))),
    ("第二章 招标范围和规模标准", list(range(6, 17))),
    ("第三章 招标和投标", list(range(17, 42))),
    ("第四章 开标评标中标", list(range(42, 60))),
    ("第五章 监督", list(range(60, 65))),
    ("第六章 法律责任", list(range(65, 76))),
    ("第七章 附则", list(range(76, 79))),
]
summary_table = (
    "**规模标准汇总表**（第十二条、第十三条、第十四条）\n\n"
    "| 项目类别 | 施工 | 货物采购 | 服务采购 | 总投资兜底标准 |\n"
    "| --- | --- | --- | --- | --- |\n"
    "| 交通、能源、水利、信息产业等基础设施 | ≥200万元 | ≥100万元 | ≥50万元 | ≥1000万元 |\n"
    "| 房屋建筑和市政基础设施等 | ≥100万元 | ≥50万元 | ≥30万元 | ≥500万元 |\n"
    "| 室内装饰装修 | 各类≥30万元 | 各类≥30万元 | 各类≥30万元 | ≥100万元 |"
)

# ---- frontmatter ----
md = open(SRC_MD, encoding="utf-8").read()
fm_match = re.search(r'(?s)^---\n(.*?)\n---', md)
fm = fm_match.group(1)
fm = fm.replace("verify_status: 初稿待校核", "verify_status: 已校核")

# ---- build body ----
body = []
body.append("# 陕西省实施《中华人民共和国招标投标法》办法")
body.append("(2004年8月3日陕西省人大常委会公告第25号公布，自2004年10月1日起施行)")
body.append("")
for title, nums in chapters:
    body.append("## " + title)
    body.append("")
    for num in nums:
        body.append("### 第" + int2cn(num) + "条")
        for ln in fmt_body(articles[num]):
            body.append(ln)
        body.append("")
        if title.startswith("第二章") and num == 14:
            body.append(summary_table)
            body.append("")

content = "---\n" + fm + "\n---\n\n" + "\n".join(body).rstrip() + "\n"
open(OUT_MD, "w", encoding="utf-8").write(content)
print("written", OUT_MD, "bytes:", len(content))
