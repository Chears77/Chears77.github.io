#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 4diaries/diary.html（美化的成长日记列表）与 4diaries/diary-data.js（供首页调用）

日期 / 主题 / 标题 三者权威来源统一 = 文件夹名「时间-主题-标题」：
  文件夹名  >  文章 index.html 内的 <h1>/<meta>（仅作兜底）
  用户会手动改文件夹名上的日期、主题词、标题，故一律以文件夹名为最高优先级。
  仅当文件夹名缺对应段（如旧式命名无日期前缀）时，才退回 meta diary-date / H1 / 解析兜底。
分类机器码（仅用于配色/筛选）由主题词推导（theme_to_cat），不依赖 meta diary-cat。
"""
import os, re, json, html
from PIL import Image

DIARY_DIR = r'D:\github\homepage\Chears77.github.io\mumu\4diaries'

# 分类：机器码 -> 中文标签
CAT_LABEL = {
    'essay':   '作文',
    'diary':   '日记',
    'school':  '校园',
    'parents': '父母期许',
    'video':   '视频记录',
    'photo':   '图片',
}

def score_image(img_path, file_size):
    """评分图片：分数越高越可能是有人像/好看的好照片（用作封面）"""
    score = 0
    try:
        with Image.open(img_path) as im:
            w, h = im.size
            ratio = w / h if h > 0 else 0
            area = w * h
            if area < 40000:       score -= 50
            elif area > 200000:    score += 20
            if area > 500000:      score += 15
            if 0.65 <= ratio <= 0.85:   score += 30
            elif 1.2 <= ratio <= 1.6:   score += 20
            elif 0.9 <= ratio <= 1.1:   score += 10
            elif ratio > 3.0:           score -= 40
            elif ratio < 0.4:           score -= 40
            if file_size > 100000:      score += 25
            elif file_size > 50000:     score += 10
            elif file_size < 15000:     score -= 30
            if area > 50000:
                im_small = im.resize((20, 20)).convert('RGB')
                pixels = list(im_small.getdata())
                light = sum(1 for p in pixels if p[0] > 230 and p[1] > 230 and p[2] > 230)
                if light / len(pixels) > 0.7:  score -= 35
                elif light / len(pixels) < 0.3: score += 15
    except Exception:
        pass
    return score

def read_meta(html):
    """从文章 HTML 读取 diary-* meta 标签"""
    meta = {}
    for m in re.finditer(r'<meta\s+name=["\'](diary-[a-z]+)["\']\s+content=["\'](.*?)["\']', html, re.I):
        meta[m.group(1)] = m.group(2).strip()
    return meta

def infer_cat_from_title(title, folder=''):
    """依据标题与文件夹名推断分类（meta 缺失时的兜底）"""
    t = (title or '') + ' ' + (folder or '')
    if '作文' in t: return 'essay'
    if any(k in t for k in ['日记', '出游', '穿越', '旅行', '游记', '爬山', '露营']): return 'diary'
    if any(k in t for k in ['父母', '期许', '寄语', '写给']): return 'parents'
    if '视频' in t: return 'video'
    if any(k in t for k in ['图片', '相册', '影集']): return 'photo'
    if any(k in t for k in ['幼儿园', '学校', '小学', '中学', '班', '活动', '典礼', '节', '运动会', '演练', '毕业']): return 'school'
    return 'school'

def theme_to_cat(theme):
    """由主题词推导分类机器码（仅用于配色 / 筛选）。未知主题返回 'other'。"""
    t = theme or ''
    if '作文' in t: return 'essay'
    if any(k in t for k in ['日记', '游记', '穿越', '出游', '爬山', '露营', '旅行']): return 'diary'
    if any(k in t for k in ['父母', '期许', '寄语', '写给']): return 'parents'
    if '视频' in t: return 'video'
    if any(k in t for k in ['图片', '照片', '相册', '影集']): return 'photo'
    if any(k in t for k in ['校园', '幼儿园', '学校', '小学', '中学', '班', '活动', '典礼', '节', '运动会', '演练', '毕业']): return 'school'
    return 'other'

def clean_text(s):
    """去标签 + 解码 HTML 实体（&ldquo; &mdash; 等）"""
    if not s:
        return ''
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()

def fmt_cn_date(d):
    """YYYYMMDD -> 2026年3月16日（文章内「日期·主题」显示用）"""
    if not d or len(d) < 8:
        return d or ''
    try:
        y, m, day = int(d[0:4]), int(d[4:6]), int(d[6:8])
    except ValueError:
        return d
    return '{}年{}月{}日'.format(y, m, day)

def fmt_iso_date(d):
    """YYYYMMDD -> 2026-03-16（<meta diary-date> 用）"""
    if not d or len(d) < 8:
        return d or ''
    return '{}-{}-{}'.format(d[0:4], d[4:6], d[6:8])

def sync_article_html(html_text, folder_date, folder_theme, folder_title, cat):
    """把单篇文章 index.html 的 日期/主题/标题 同步为文件夹名的值。

    单数据源 = 文件夹名；仅当文件夹采用「时间-主题-标题」规范命名时才同步。
    兼容两种内部写法：
      · 新模板：<span class="article-date">中文日期</span><span class="article-theme">主题</span>
      · 老校园：<p   class="article-date">ISO日期<span class="article-theme">主题</span></p>
    保护 <!-- --> 注释，避免误改模板里的示例 meta。
    """
    # 保护注释，避免改到模板头部说明里的示例 meta
    comments = re.findall(r'<!--.*?-->', html_text, re.S)
    for i, c in enumerate(comments):
        html_text = html_text.replace(c, '\x00CMT%d\x00' % i, 1)
    orig = html_text

    # meta: diary-cat / diary-date / diary-theme
    html_text = re.sub(r'(<meta\s+name=["\']diary-cat["\']\s+content=["\'])[^"\']*(["\'])',
                       lambda m: m.group(1) + cat + m.group(2), html_text, flags=re.I)
    html_text = re.sub(r'(<meta\s+name=["\']diary-date["\']\s+content=["\'])[^"\']*(["\'])',
                       lambda m: m.group(1) + fmt_iso_date(folder_date) + m.group(2), html_text, flags=re.I)
    html_text = re.sub(r'(<meta\s+name=["\']diary-theme["\']\s+content=["\'])[^"\']*(["\'])',
                       lambda m: m.group(1) + folder_theme + m.group(2), html_text, flags=re.I)

    # <title>
    html_text = re.sub(r'<title>.*?</title>',
                       lambda m: '<title>' + folder_title + ' · Alisa 成长日记</title>',
                       html_text, flags=re.I | re.S)

    # <h1 class="article-title">
    html_text = re.sub(r'<h1[^>]*class=["\']article-title["\'][^>]*>.*?</h1>',
                       lambda m: '<h1 class="article-title">' + folder_title + '</h1>',
                       html_text, flags=re.I | re.S)

    # 日期+主题标签：统一规范为
    #   <span class="article-date">中文日期</span><span class="article-theme">主题</span>
    # 兼容两类历史写法：
    #   ① 主题平级（新模板）：日期容器闭合后，可能夹一段「填这里」注释，再跟主题 span
    #   ② 主题嵌套（旧校园 <p> 写法）：主题 span 在日期容器内部
    def repl_a(m):  # 主题平级（保留中间可能夹的注释占位）
        cmt = m.group(2) or ''
        return '<span class="article-date">' + fmt_cn_date(folder_date) + '</span>' \
               + cmt + '<span class="article-theme">' + folder_theme + '</span>'
    def repl_b(m):  # 主题嵌套（旧 <p> 写法，无平级主题 span）
        return '<span class="article-date">' + fmt_cn_date(folder_date) + '</span>' \
               + '<span class="article-theme">' + folder_theme + '</span>'
    # ① 先处理「主题平级」：日期容器闭合 → 可选注释占位 → 主题 span
    html_text = re.sub(
        r'<(span|p)[^>]*class=["\']article-date["\'][^>]*>.*?</\1>'
        r'\s*(\x00CMT\d+\x00)?\s*'
        r'<span[^>]*class=["\']article-theme["\'][^>]*>.*?</span>',
        repl_a, html_text, flags=re.I | re.S)
    # ② 再处理「主题嵌套」：主题 span 在日期容器内部（旧 <p> 写法）
    html_text = re.sub(
        r'<(span|p)[^>]*class=["\']article-date["\'][^>]*>'
        r'.*?<span[^>]*class=["\']article-theme["\'][^>]*>.*?</span>'
        r'.*?</\1>',
        repl_b, html_text, flags=re.I | re.S)

    # ===== 老文章结构规范化：日期+主题未居中、字号不一 → 包进 flex 居中容器 =====
    html_text = normalize_legacy_meta(html_text)

    # 还原注释
    for i, c in enumerate(comments):
        html_text = html_text.replace('\x00CMT%d\x00' % i, c)
    return html_text


def normalize_legacy_meta(html_text):
    """老文章（日期+主题未居中、字体大小不一）的结构规范化。

    仅对「尚无 .article-meta 容器」的文章生效（已规范的新文章不改动）：
      · 把平级的「日期 / 主题」两个 span 包进 <div class="article-meta">（flex 居中）
      · CSS：新增 .article-meta 居中规则；.article-theme 补 font-size 与日期一致；
             去掉 .article-date 上无效的 text-align:center 与多余 margin-bottom。
    兼容日期与主题之间可能夹的注释占位（形如 \\x00CMT0\\x00）。
    """
    if '<div class="article-meta">' in html_text:
        return html_text

    META_CSS = ('.article-meta{display:flex;align-items:center;justify-content:center;'
                'gap:8px;margin-bottom:var(--space-xl);font-size:var(--font-sm);color:var(--text-light)}')

    # HTML：包一层居中容器（兼容主题与日期之间可能夹的注释占位）
    html_text = re.sub(
        r'(<span[^>]*class=["\']article-date["\'][^>]*>.*?</span>)'
        r'(\s*\x00CMT\d+\x00)?'
        r'(<span[^>]*class=["\']article-theme["\'][^>]*>.*?</span>)',
        r'<div class="article-meta">\1\2\3</div>',
        html_text, flags=re.S)

    # CSS：清理 .article-date 旧写法 + 紧跟新增 .article-meta 规则
    html_text = re.sub(
        r'\s*\.article-date\{font-size:var\(--font-sm\);color:var\(--text-light\);margin-bottom:var\(--space-xl\);text-align:center\}',
        '.article-date{font-size:var(--font-sm);color:var(--text-light)}\n ' + META_CSS,
        html_text)

    # CSS：.article-theme 补字号（与日期一致）
    html_text = re.sub(
        r'\s*\.article-theme\{margin-left:6px;color:var\(--text-light\)\}',
        ' .article-theme{margin-left:6px;color:var(--text-light);font-size:var(--font-sm)}',
        html_text)
    return html_text

def parse_folder_name(folder):
    """兜底：从文件夹名解析 日期 / 标题 / （主题）"""
    date_part = '00000000'
    m = re.match(r'^(\d{8})', folder)
    if m:
        date_part = m.group(1)
    elif re.match(r'^(\d{6})', folder):
        date_part = re.match(r'^(\d{6})', folder).group(1) + '01'
    rest = folder[8:] if folder[:8].isdigit() else folder
    rest = rest.lstrip('_').lstrip()
    theme_in_name = ''
    mm = re.search(r'[（(](.+?)[)）]\s*$', rest)
    if mm:
        theme_in_name = mm.group(1).strip()
        rest = rest[:mm.start()].strip()
    return date_part, rest, theme_in_name

def normalize_date(raw):
    if not raw:
        return '00000000'
    digits = re.sub(r'\D', '', raw)
    if len(digits) >= 8:
        return digits[:8]
    if len(digits) == 6:
        return digits + '01'
    return '00000000'

entries = []
synced = 0
for f in sorted(os.listdir(DIARY_DIR)):
    full = os.path.join(DIARY_DIR, f)
    if not os.path.isdir(full):
        continue
    if f.startswith('.'):
        continue
    html_path = os.path.join(full, 'index.html')
    if not os.path.exists(html_path):
        continue

    with open(html_path, 'r', encoding='utf-8') as hf:
        html_content = hf.read()
    meta = read_meta(html_content)

    # ===== 文件夹名是 日期 / 主题 / 标题 的权威来源（用户会手动改文件夹名）=====
    # 命名约定：时间-主题-标题（如 20260406-日记-夬石峡谷穿越）
    # 三者均优先取文件夹名；仅当文件夹缺失对应段时，才退回 meta / 文章 H1。
    folder_parts = f.split('-')
    folder_has_prefix = (len(folder_parts) >= 3 and folder_parts[0].isdigit() and len(folder_parts[0]) == 8)
    folder_date = folder_parts[0] if folder_has_prefix else ''
    folder_theme = folder_parts[1].strip() if folder_has_prefix else ''
    folder_title = '-'.join(folder_parts[2:]).strip() if folder_has_prefix else ''

    # 日期：文件夹前缀 > meta diary-date
    date_part = normalize_date(folder_date) if folder_date else '00000000'
    if date_part == '00000000':
        date_part = normalize_date(meta.get('diary-date', ''))

    # 标题：文件夹末段 > 文章 H1 > 解析兜底
    hm = re.search(r'<h1[^>]*class=["\']article-title["\'][^>]*>(.*?)</h1>', html_content, re.I | re.S)
    h1_title = clean_text(hm.group(1)) if hm else ''
    title = clean_text(folder_title) or h1_title or clean_text(parse_folder_name(f)[1])

    # 主题：文件夹中段 > meta diary-theme > 按标题推断
    theme = clean_text(folder_theme) or clean_text(meta.get('diary-theme', ''))
    if not theme:  # 异常兜底：按标题推断分类再取中文标签
        cat_fb = infer_cat_from_title(title, f)
        theme = CAT_LABEL.get(cat_fb, cat_fb)

    # 分类机器码（仅用于配色 / 筛选），由主题词推导；未知主题归 'other'
    cat = theme_to_cat(theme)

    # 摘要
    excerpt = clean_text(meta.get('diary-excerpt', ''))

    # 图片
    img_dir = os.path.join(full, 'images')
    img_files = []
    if os.path.isdir(img_dir):
        for img in os.listdir(img_dir):
            if img.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
                img_files.append(img)
    imgs_count = len(img_files)

    # 封面：优先 meta 指定，否则选评分最高的图
    thumb = ''
    cover_meta = meta.get('diary-cover', '').strip()
    if cover_meta:
        cover_path = os.path.join(full, cover_meta.lstrip('./\\'))
        if os.path.exists(cover_path):
            thumb = f + '/' + cover_meta.lstrip('./\\').replace('\\', '/')
    if not thumb and img_files:
        scored = []
        for img in img_files:
            p = os.path.join(img_dir, img)
            scored.append((score_image(p, os.path.getsize(p)), img))
        scored.sort(key=lambda x: x[0], reverse=True)
        good = [x for x in scored if x[0] > 0]
        pick = (good or scored)[0][1]
        thumb = f + '/images/' + pick

    entries.append({
        'folder': f,
        'date':   date_part,
        'title':  title,
        'imgs':   imgs_count,
        'cat':    cat,
        'theme':  theme,
        'excerpt': excerpt,
        'thumb':  thumb,
    })

    # ===== 同步文章内部 日期/主题/标题 为文件夹值（单数据源 = 文件夹）=====
    if folder_has_prefix and folder_title:
        new_html = sync_article_html(html_content, folder_date, folder_theme, folder_title, cat)
        if new_html != html_content:
            with open(html_path, 'w', encoding='utf-8') as wf:
                wf.write(new_html)
            synced += 1

entries.sort(key=lambda e: e['date'], reverse=True)
data_js = 'var DIARY_DATA = ' + json.dumps(entries, ensure_ascii=True) + ';'

# ===================== 渲染美化的 diary.html =====================
CSS = """
/* ===== 内联共享基础样式：保证独立打开 / 预览沙箱也能正常渲染（不依赖 ../css/style.css） ===== */
:root{
  --pink:#F8C8D8; --pink-dark:#E8A0B8; --pink-light:#FDE8EF; --pink-deep:#D985A3; --cream:#FFF8F0;
  --yellow:#FFF5E0; --white:#FFFFFF; --text:#5D4E4E; --text-light:#9B8E8E; --text-dark:#3D3030;
  --blue-light:#E8F2FC; --blue-dark:#8BB8E0; --yellow-dark:#F5E6C8;
  --space-xs:4px; --space-sm:8px; --space-md:16px; --space-lg:24px; --space-xl:32px; --space-2xl:48px; --space-3xl:64px;
  --radius-sm:8px; --radius-md:16px; --radius-lg:24px; --radius-full:50%;
  --shadow-sm:0 2px 8px rgba(248,200,216,0.15); --shadow-md:0 4px 16px rgba(248,200,216,0.20);
  --font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
  --font-xs:12px; --font-sm:14px; --font-base:16px; --font-md:18px; --font-lg:24px;
  --trans-fast:0.2s ease; --max-width:1200px;
}
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--font-family);font-size:var(--font-base);color:var(--text);background:var(--cream);line-height:1.8;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{max-width:100%;display:block}
a{text-decoration:none;color:inherit}
ul{list-style:none}
button{font-family:inherit;cursor:pointer;border:none}
.topbar{position:sticky;top:0;z-index:1000;background:rgba(255,255,255,0.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 2px 12px rgba(0,0,0,0.05);height:56px;display:flex;align-items:center}
.topbar-inner{max-width:var(--max-width);margin:0 auto;width:100%;display:flex;align-items:center;justify-content:space-between;padding:0 var(--space-lg)}
.topbar-back{display:flex;align-items:center;gap:var(--space-sm);color:var(--pink-dark);font-weight:600;font-size:var(--font-base);transition:color var(--trans-fast)}
.topbar-back:hover{color:var(--pink)}
.topbar-back svg{width:20px;height:20px}
.topbar-title{font-size:var(--font-md);font-weight:700;color:var(--text-dark)}
.footer{text-align:center;padding:var(--space-3xl) var(--space-lg);background:var(--cream)}
.footer-hearts{color:var(--pink);font-size:22px;margin-bottom:var(--space-md);letter-spacing:4px}
.footer-quote{font-size:var(--font-md);color:var(--text);font-style:italic;margin-bottom:var(--space-sm)}
.footer-copy{font-size:var(--font-xs);color:var(--text-light)}
.year-filter{display:flex;justify-content:center;gap:var(--space-sm);flex-wrap:wrap;max-width:var(--max-width);margin:0 auto var(--space-xl);padding:0 var(--space-lg)}
.year-filter-btn{padding:var(--space-xs) var(--space-md);border-radius:var(--radius-full);background:var(--white);color:var(--text-light);font-size:var(--font-sm);border:1.5px solid var(--pink-light);transition:all var(--trans-fast)}
.year-filter-btn:hover,.year-filter-btn.active{background:var(--pink);color:var(--white);border-color:var(--pink)}

/* ===== 日记列表专属 ===== */
.d-wrap{max-width:760px;margin:0 auto;padding:var(--space-lg) var(--space-lg) var(--space-2xl)}
.d-list{display:flex;flex-direction:column;gap:5px;padding-bottom:var(--space-2xl)}
.d-row{display:flex;align-items:center;gap:12px;background:#fff;border-radius:var(--radius-sm);padding:8px 13px;
  box-shadow:var(--shadow-sm);transition:background .15s;text-decoration:none}
.d-row:hover{background:var(--pink-light)}
.d-title{flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--text-dark);line-height:1.4;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d-date{font-variant-numeric:tabular-nums;font-size:var(--font-xs);font-weight:700;color:var(--pink-deep);
  background:var(--pink-light);padding:3px 9px;border-radius:999px;letter-spacing:.3px;white-space:nowrap;flex-shrink:0}
.d-chip{font-size:var(--font-xs);font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;flex-shrink:0}
.d-chip[data-cat="essay"]{background:var(--pink-light);color:var(--pink-deep)}
.d-chip[data-cat="diary"]{background:#FFF3D6;color:#C5912F}
.d-chip[data-cat="school"]{background:var(--blue-light);color:var(--blue-dark)}
.d-chip[data-cat="parents"]{background:#F1E9FB;color:#9A78C8}
.d-chip[data-cat="video"]{background:#1a1a2e;color:#fff}
.d-chip[data-cat="photo"]{background:#E8F5E9;color:#5BA16F}
.d-chip[data-cat="other"]{background:#EDE7F6;color:#7E6AA8}
@media(max-width:560px){.d-title{font-size:14px}.d-chip{display:none}.d-row{padding:7px 10px}}
.empty-tip{text-align:center;padding:var(--space-xl);color:var(--text-light);font-size:var(--font-base)}
"""

JS = r"""
(function(){
 var GRID=document.getElementById('diaryGrid');
 var TABS=document.getElementById('dTabs');
 function fmt(d){if(!d||d.length<8)return d||'';return d.substr(0,4)+'.'+d.substr(4,2)+'.'+d.substr(6,2);}
 function yr(d){return d?String(d).substr(0,4):'';}
 function card(x){
  var cat=x.cat||'school';
  var a=document.createElement('a');a.className='d-row';a.href=encodeURI(x.folder+'/index.html');
  var dt=document.createElement('span');dt.className='d-date';dt.textContent=fmt(x.date);
  var ti=document.createElement('span');ti.className='d-title';ti.textContent=x.title;
  var chip=document.createElement('span');chip.className='d-chip';chip.setAttribute('data-cat',cat);chip.textContent=(x.theme||cat);
  a.appendChild(dt);a.appendChild(ti);a.appendChild(chip);return a;
 }
 function render(y){
  GRID.innerHTML='';
  var list=DIARY_DATA.filter(function(x){return y==='all'||yr(x.date)===y;});
  document.getElementById('dEmpty').style.display=list.length?'none':'block';
  list.forEach(function(x){GRID.appendChild(card(x));});
 }
 // 年份筛选按钮（按年份倒序，自动生成，新增年份无需改 HTML）
 var ys={};DIARY_DATA.forEach(function(x){var y=yr(x.date);if(y)ys[y]=1;});
 var ylist=Object.keys(ys).sort(function(a,b){return b.localeCompare(a);});
 var html='<button class="year-filter-btn active" data-year="all">全部</button>';
 ylist.forEach(function(y){html+='<button class="year-filter-btn" data-year="'+y+'">'+y+'</button>';});
 TABS.innerHTML=html;
 render('all');
 TABS.addEventListener('click',function(e){var t=e.target.closest('.year-filter-btn');if(!t)return;
  TABS.querySelectorAll('.year-filter-btn').forEach(function(b){b.classList.remove('active');});
  t.classList.add('active');render(t.getAttribute('data-year'));});
})();
"""

HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>成长日记 · Alisa</title>
<link rel="stylesheet" href="../css/style.css">
<style>__CSS__</style>
</head>
<body>
<nav class="topbar">
<div class="topbar-inner">
<a href="../index.html" class="topbar-back">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
返回首页
</a>
<span class="topbar-title">成长日记</span>
<span style="width:80px"></span>
</div>
</nav>

<div class="d-wrap">
<div class="year-filter" id="dTabs"></div>
<div class="d-list" id="diaryGrid"></div>
<p class="empty-tip" id="dEmpty" style="display:none">该年份暂无日记</p>
</div>

<footer class="footer">
<div class="footer-hearts">&#10084; &#10084; &#10084;</div>
<p class="footer-quote">"每一篇文章，都是成长的足迹"</p>
<p class="footer-copy">&copy; Alisa 成长纪念册</p>
</footer>

<script>__DATA____JS__</script>
</body>
</html>
"""

html_out = (HTML
            .replace('__CSS__', CSS)
            .replace('__DATA__', data_js + '\n')
            .replace('__JS__', JS))

with open(os.path.join(DIARY_DIR, 'diary.html'), 'w', encoding='utf-8') as f:
    f.write(html_out)

with open(os.path.join(DIARY_DIR, 'diary-data.js'), 'w', encoding='utf-8') as f:
    f.write(data_js + '\n')

print('OK - diary.html  (%d 篇)' % len(entries))
print('OK - diary-data.js')
print('OK - 同步文章内部标签 %d 篇（日期/主题/标题 已对齐文件夹名）' % synced)
