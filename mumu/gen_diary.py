#!/usr/bin/env python
"""生成带缩略图的diary.html - 智能选择有人像的照片"""
import os, json, re
from PIL import Image

diary_dir = r'E:\AI\workbuddy\20260630女儿主页\v2\diaries'
folders = sorted([d for d in os.listdir(diary_dir) if os.path.isdir(os.path.join(diary_dir, d))])

def score_image(img_path, file_size):
    """评分图片：分数越高越可能是有人像的好照片"""
    score = 0
    try:
        with Image.open(img_path) as im:
            w, h = im.size
            ratio = w / h if h > 0 else 0
            area = w * h

            # 1. 尺寸评分：太小扣分，适中加分
            if area < 40000:       # <200x200
                score -= 50
            elif area > 200000:    # >500x400
                score += 20
            if area > 500000:      # >800x600
                score += 15

            # 2. 宽高比评分：手机照片比例加分，横幅/长条扣分
            if 0.65 <= ratio <= 0.85:   # 竖屏人像 3:4
                score += 30
            elif 1.2 <= ratio <= 1.6:   # 横屏 4:3
                score += 20
            elif 0.9 <= ratio <= 1.1:   # 方形
                score += 10
            elif ratio > 3.0:           # 超宽横幅（公众号头图）
                score -= 40
            elif ratio < 0.4:           # 超长竖条
                score -= 40

            # 3. 文件大小评分（大图通常质量更高）
            if file_size > 100000:   # >100KB
                score += 25
            elif file_size > 50000:
                score += 10
            elif file_size < 15000:  # <15KB 太小的图
                score -= 30

            # 4. 色彩评分：检查是否大面积白色/浅色背景（公众号横幅特征）
            if area > 50000:
                im_small = im.resize((20, 20)).convert('RGB')
                pixels = list(im_small.getdata())
                light_pixels = sum(1 for p in pixels if p[0] > 230 and p[1] > 230 and p[2] > 230)
                light_ratio = light_pixels / len(pixels)
                if light_ratio > 0.7:  # 大部分是白色/浅色 → 可能是横幅
                    score -= 35
                elif light_ratio < 0.3:  # 色彩丰富 → 更可能有人物
                    score += 15

    except Exception as e:
        pass

    return score


def get_category(title):
    if '作文' in title:
        return 'essay'
    if title in ['夁石峡谷穿越', '清明出游']:
        return 'diary'
    return 'school'

entries = []
for f in folders:
    date_part = f[:8] if len(f) >= 8 and f[:8].isdigit() else '00000000'
    # Read title from article h1 tag
    html_path = os.path.join(diary_dir, f, 'index.html')
    title = f[9:] if len(f) > 9 and f[8] == '_' else f  # fallback
    if os.path.exists(html_path):
        with open(html_path, 'r', encoding='utf-8') as hf:
            hm = re.search(r'<h1 class="article-title">(.*?)</h1>', hf.read())
            if hm: title = hm.group(1)
    img_dir = os.path.join(diary_dir, f, 'images')

    scored_imgs = []
    if os.path.exists(img_dir):
        for img in os.listdir(img_dir):
            if img.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                full = os.path.join(img_dir, img)
                size = os.path.getsize(full)
                s = score_image(full, size)
                scored_imgs.append((s, size, img))

    # 按评分降序排列
    scored_imgs.sort(key=lambda x: x[0], reverse=True)

    first_img = ''
    if scored_imgs:
        # 只选评分 > 0 的图片，如果没有则选评分最高的
        good = [x for x in scored_imgs if x[0] > 0]
        pick = good[0] if good else scored_imgs[0]
        first_img = 'diaries/' + f + '/images/' + pick[2]

    entries.append({
        'folder': f,
        'date': date_part,
        'title': title,
        'imgs': len(scored_imgs),
        'cat': get_category(title),
        'thumb': first_img
    })

entries.sort(key=lambda e: e['date'], reverse=True)

data_js = 'var DIARY_DATA = ' + json.dumps(entries, ensure_ascii=True) + ';'

html = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>成长日记 · Alisa</title>
<link rel="stylesheet" href="css/style.css">
<style>
.diary-container{max-width:900px;margin:0 auto}
.cat-tabs{display:flex;justify-content:center;gap:var(--space-sm);flex-wrap:wrap;margin-bottom:var(--space-xl)}
.cat-tab{padding:var(--space-sm) var(--space-lg);border-radius:var(--radius-full);background:var(--white);color:var(--text-light);font-size:var(--font-sm);border:1.5px solid var(--pink-light);cursor:pointer;transition:all var(--trans-fast)}
.cat-tab:hover{border-color:var(--pink);color:var(--pink-dark)}
.cat-tab.active{background:var(--pink);color:var(--white);border-color:var(--pink);font-weight:600}
.diary-grid{display:grid;grid-template-columns:1fr;gap:var(--space-md);max-width:900px;margin:0 auto}
.diary-entry{background:var(--white);border-radius:var(--radius-md);box-shadow:var(--shadow-sm);padding:var(--space-lg);transition:transform var(--trans-base),box-shadow var(--trans-base);display:flex;gap:var(--space-md);align-items:flex-start;text-decoration:none;color:inherit}
.diary-entry:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
.diary-entry-thumb{width:90px;height:68px;border-radius:var(--radius-sm);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:28px;overflow:hidden;background:var(--pink-light)}
.diary-entry-thumb img{width:100%;height:100%;object-fit:cover}
.diary-entry-body{flex:1;min-width:0}
.diary-entry-cat{display:inline-block;padding:1px 10px;border-radius:var(--radius-full);font-size:11px;font-weight:600;margin-bottom:var(--space-xs)}
.cat-school{background:var(--blue-light);color:var(--blue-dark)}
.cat-diary{background:var(--pink-light);color:var(--pink-dark)}
.cat-parents{background:linear-gradient(135deg,var(--pink-light),var(--yellow));color:var(--pink-dark)}
.cat-video{background:#1a1a2e;color:#fff}
.cat-photo{background:var(--yellow);color:#c8a040}
.diary-entry-title{font-size:var(--font-base);font-weight:700;color:var(--text-dark);margin-bottom:var(--space-xs);line-height:1.4}
.diary-entry-meta{font-size:var(--font-xs);color:var(--text-light);display:flex;gap:var(--space-md);flex-wrap:wrap}
.empty-tip{text-align:center;padding:var(--space-2xl);color:var(--text-light);font-size:var(--font-base)}
@media(min-width:768px){.diary-grid{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<nav class="topbar">
<div class="topbar-inner">
<a href="index.html" class="topbar-back">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
返回首页
</a>
<span class="topbar-title">成长日记</span>
<span style="width:80px"></span>
</div>
</nav>
<div class="page-content diary-container">
<div class="cat-tabs" id="catTabs">
<button class="cat-tab active" data-cat="all">全部</button>
<button class="cat-tab" data-cat="school">校园报道</button>
<button class="cat-tab" data-cat="diary">个人日记</button>
<button class="cat-tab" data-cat="parents">父母期许</button>
<button class="cat-tab" data-cat="video">视频记录</button>
<button class="cat-tab" data-cat="photo">图片记录</button>
</div>
<p style="text-align:center;color:var(--text-light);margin-bottom:var(--space-lg);font-size:var(--font-sm)" id="diaryDesc">共 0 篇记录</p>
<div class="diary-grid" id="diaryGrid"></div>
<div class="empty-tip" id="emptyTip" style="display:none">暂无内容，敬请期待</div>
</div>
<footer class="footer">
<div class="footer-hearts">&#10084; &#10084; &#10084;</div>
<p class="footer-quote">"每一篇文章，都是成长的足迹"</p>
<p class="footer-copy">&copy; Alisa 成长纪念册</p>
</footer>
<script>
'''

# Append the data and JS
DATA_SCRIPT = data_js + r'''
(function(){
var g=document.getElementById("diaryGrid"),t=document.getElementById("catTabs"),d=document.getElementById("diaryDesc"),e=document.getElementById("emptyTip"),
L={school:"校园报道",diary:"个人日记",parents:"父母期许",video:"视频记录",photo:"图片记录"},
I={school:"\ud83d\udcf0",diary:"\u270f\ufe0f",parents:"\u2764\ufe0f",video:"\ud83c\udfac",photo:"\ud83d\udcf7"};
function r(c){
g.innerHTML="";
var a=c==="all"?DIARY_DATA:DIARY_DATA.filter(function(x){return x.cat===c});
d.textContent="共 "+a.length+" 篇记录";
e.style.display=a.length===0?"block":"none";
a.forEach(function(x){
var dd=x.date;
if(x.date.length===8)dd=x.date.substr(0,4)+"-"+x.date.substr(4,2)+"-"+x.date.substr(6,2);
else if(x.date.length===6)dd=x.date.substr(0,4)+"-"+x.date.substr(4,2);
var thumbHTML;
if(x.thumb){
thumbHTML='<img src="'+x.thumb+'" alt="" loading="lazy">';
}else{
thumbHTML='<span>'+(I[x.cat]||"\ud83d\udcc4")+'</span>';
}
var el=document.createElement("a");
el.className="diary-entry";
el.href="diaries/"+encodeURI(x.folder)+"/index.html";
el.innerHTML='<div class="diary-entry-thumb">'+thumbHTML+'</div>'+
'<div class="diary-entry-body">'+
'<span class="diary-entry-cat cat-'+(x.cat||"school")+'">'+(L[x.cat]||"")+'</span>'+
'<div class="diary-entry-title">'+x.title+'</div>'+
'<div class="diary-entry-meta"><span>'+dd+'</span><span>\ud83d\uddbc '+(x.imgs||0)+'张</span></div>'+
'</div>';
g.appendChild(el);
});
}
r("all");
t.addEventListener("click",function(ev){
if(!ev.target.classList.contains("cat-tab"))return;
t.querySelectorAll(".cat-tab").forEach(function(x){x.classList.remove("active")});
ev.target.classList.add("active");
r(ev.target.dataset.cat);
});
})();
</script>
</body>
</html>'''

html_final = html + DATA_SCRIPT

with open(r'E:\AI\workbuddy\20260630女儿主页\v2\diary.html', 'w', encoding='utf-8') as f:
    f.write(html_final)

print('OK - diary.html with image thumbnails')
