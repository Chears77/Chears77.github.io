#!/usr/bin/env python
"""解析思源笔记导出HTML，生成独立日记文章页面"""
import os, re, shutil, json
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString

# 路径配置
SOURCE_HTML = r"C:\Users\admin\Desktop\任以沐成长记录\index.html"
SOURCE_ASSETS = r"C:\Users\admin\Desktop\任以沐成长记录\assets"
V2_DIR = Path(r"E:\AI\workbuddy\20260630女儿主页\v2")
DIARIES_DIR = V2_DIR / "diaries"
CSS_REL = "../../css/style.css"

# 创建diaries目录
DIARIES_DIR.mkdir(parents=True, exist_ok=True)

def sanitize_filename(name):
    """清理文件夹名"""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = name.strip()
    return name[:60]  # 限制长度

def extract_date_from_title(title):
    """从标题中提取日期，返回 (date_str, clean_title)"""
    date_match = re.search(r'(20\d{2})[-年](\d{1,2})[-月](\d{1,2})', title)
    if date_match:
        y, m, d = date_match.group(1), date_match.group(2).zfill(2), date_match.group(3).zfill(2)
        return f"{y}{m}{d}", title
    # 尝试从末尾提取日期如 -20201111
    date_match = re.search(r'[-_](\d{8})', title)
    if date_match:
        return date_match.group(1), title
    # 从anchor ID时间戳推断
    return "", title

def extract_article_date(article_data):
    """综合推断文章日期"""
    title = article_data.get('title', '')
    date_str, _ = extract_date_from_title(title)
    if date_str:
        return date_str
    
    # 从anchor ID推测 (格式: 20230406235624-csq0574, 前8位是日期)
    anchor = article_data.get('anchor', '')
    if len(anchor) >= 8 and anchor[:8].isdigit():
        return anchor[:8]
    
    return "00000000"

def get_text_content(elem):
    """提取元素纯文本"""
    if isinstance(elem, NavigableString):
        return str(elem).strip()
    text = elem.get_text(separator=' ', strip=True)
    return text

def find_heading_boundaries(soup):
    """找到所有h1标题节点作为文章边界"""
    headings = []
    preview_div = soup.find('div', id='preview')
    if not preview_div:
        preview_div = soup.find('div', class_='protyle-wysiwyg')
    
    if not preview_div:
        return headings
    
    # 找所有 h1 标题对应的div
    for div in preview_div.find_all('div', attrs={'data-type': 'NodeHeading'}):
        if div.get('data-subtype') == 'h1':
            text = get_text_content(div)
            if text and len(text) > 2:
                headings.append({
                    'element': div,
                    'title': text,
                    'anchor': div.get('id', ''),
                    'line': div.sourceline if hasattr(div, 'sourceline') else 0
                })
    
    return headings

def extract_images_between(start_elem, end_elem):
    """提取两个元素之间的所有图片"""
    images = []
    current = start_elem
    while current and current != end_elem:
        for img in current.find_all('img', recursive=True):
            src = img.get('src', '') or img.get('data-src', '')
            if src and 'assets/' in src:
                images.append(src)
        current = current.find_next_sibling() if hasattr(current, 'find_next_sibling') else None
    return list(set(images))  # 去重

def extract_content_between(start_elem, end_elem):
    """提取两个h1之间的所有内容元素"""
    content = []
    current = start_elem
    
    # 找到start的下一个兄弟（跳过标题自身）
    current = current.find_next_sibling() if hasattr(current, 'find_next_sibling') else None
    
    while current and current != end_elem:
        if current.name:
            content.append(current)
        current = current.find_next_sibling() if hasattr(current, 'find_next_sibling') else None
    
    return content

def generate_article_html(article, image_map):
    """为单篇文章生成HTML页面"""
    title = article['title']
    date_str = article.get('date', '')
    if date_str and len(date_str) == 8:
        display_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
    else:
        display_date = ""
    
    folder_name = sanitize_filename(f"{date_str}_{title}" if date_str else title)
    folder_path = DIARIES_DIR / folder_name
    folder_path.mkdir(parents=True, exist_ok=True)
    
    # 复制图片
    images_dir = folder_path / "images"
    images_dir.mkdir(exist_ok=True)
    
    image_html = ""
    for img_path in article.get('images', []):
        src = img_path.replace('assets/', '')
        dest_name = os.path.basename(src)
        src_full = os.path.join(SOURCE_ASSETS, dest_name)
        if os.path.exists(src_full):
            shutil.copy2(src_full, images_dir / dest_name)
            image_html += f'\n        <div class="diary-img"><img src="images/{dest_name}" alt="照片" loading="lazy"></div>'
    
    # 处理文本内容
    paragraphs_html = ""
    for para in article.get('paragraphs', []):
        text = para.strip()
        if not text or text in ['​', '\u200b', 'END', '~END~']:
            continue
        if text.startswith('~') and text.endswith('~'):
            continue
        paragraphs_html += f'\n        <p>{text}</p>'
    
    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} · Alisa 成长日记</title>
<link rel="stylesheet" href="{CSS_REL}">
<style>
  .article-page {{ max-width:800px; margin:0 auto; padding:var(--space-xl) var(--space-lg); }}
  .article-title {{ font-size:var(--font-xl); color:var(--pink-dark); font-weight:700; margin-bottom:var(--space-sm); line-height:1.4; }}
  .article-date {{ font-size:var(--font-sm); color:var(--text-light); margin-bottom:var(--space-xl); }}
  .article-body {{ font-size:var(--font-base); color:var(--text); line-height:2; }}
  .article-body p {{ margin-bottom:var(--space-md); text-indent:2em; }}
  .diary-img {{ margin:var(--space-lg) 0; text-align:center; }}
  .diary-img img {{ max-width:100%; border-radius:var(--radius-md); box-shadow:var(--shadow-sm); }}
  .article-footer {{ margin-top:var(--space-2xl); padding-top:var(--space-lg); border-top:1px solid var(--pink-light); text-align:center; color:var(--text-light); font-size:var(--font-sm); }}
</style>
</head>
<body>

<nav class="topbar">
  <div class="topbar-inner">
    <a href="../diary.html" class="topbar-back">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      返回成长日记
    </a>
    <span class="topbar-title">成长日记</span>
    <span style="width:80px"></span>
  </div>
</nav>

<div class="article-page">
  <h1 class="article-title">{title}</h1>
  {f'<p class="article-date">{display_date}</p>' if display_date else ''}
  <div class="article-body">{paragraphs_html}{image_html}</div>
  <div class="article-footer">
    <p>— Alisa 成长纪念册 —</p>
  </div>
</div>

<footer class="footer">
  <div class="footer-hearts">&#10084; &#10084; &#10084;</div>
  <p class="footer-quote">"记录每一个成长的瞬间"</p>
  <p class="footer-copy">&copy; Alisa 成长纪念册</p>
</footer>

</body>
</html>'''
    
    with open(folder_path / "index.html", 'w', encoding='utf-8') as f:
        f.write(html)
    
    return folder_name

def parse_siyuan_html():
    """主解析函数"""
    print("读取思源笔记HTML...")
    with open(SOURCE_HTML, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    soup = BeautifulSoup(html_content, 'html.parser')
    preview = soup.find('div', id='preview')
    if not preview:
        preview = soup.find('div', class_='protyle-wysiwyg')
    
    if not preview:
        print("ERROR: 找不到preview容器")
        return []
    
    # 找所有h1标题
    all_h1 = preview.find_all('div', attrs={'data-type': 'NodeHeading', 'data-subtype': 'h1'})
    print(f"找到 {len(all_h1)} 个 h1 标题")
    
    articles = []
    
    for i, h1 in enumerate(all_h1):
        title = get_text_content(h1).strip()
        if not title or len(title) < 2:
            continue
        
        anchor = h1.get('id', '')
        
        # 确定文章结束边界（下一个h1）
        next_h1 = all_h1[i + 1] if i + 1 < len(all_h1) else None
        
        # 收集本篇文章的所有内容元素
        content_els = extract_content_between(h1, next_h1)
        
        # 提取文本段落
        paragraphs = []
        images = []
        
        for el in content_els:
            # 提取图片
            for img in el.find_all('img', recursive=True):
                src = img.get('src', '') or img.get('data-src', '')
                if src:
                    images.append(src)
            
            # 提取文本（过滤掉纯空白和特殊字符）
            text = get_text_content(el)
            if text and text not in ['​', '\u200b', ''] and not re.match(r'^[\s\u200b​]+$', text):
                paragraphs.append(text)
        
        # 跳过空内容（重复的heading-only）
        if len(paragraphs) == 0 and len(images) == 0:
            continue
        
        article = {
            'title': title,
            'anchor': anchor,
            'paragraphs': paragraphs,
            'images': images,
            'date': extract_article_date({'title': title, 'anchor': anchor})
        }
        
        articles.append(article)
        print(f"  [{len(articles)}] {title[:50]}... ({len(paragraphs)}段, {len(images)}图)")
    
    return articles

def generate_diary_list_json(articles, folder_names):
    """生成日记列表数据"""
    diary_list = []
    for i, article in enumerate(articles):
        folder = folder_names[i] if i < len(folder_names) else ""
        diary_list.append({
            'title': article['title'],
            'date': article.get('date', ''),
            'folder': folder,
            'summary': article['paragraphs'][0][:80] + '...' if article['paragraphs'] else '',
            'image_count': len(article.get('images', []))
        })
    return diary_list

def main():
    print("=" * 60)
    print("思源笔记 → 独立日记文章 转换器")
    print("=" * 60)
    
    # 解析
    articles = parse_siyuan_html()
    print(f"\n共解析 {len(articles)} 篇文章")
    
    if not articles:
        print("未找到文章，退出")
        return
    
    # 生成HTML文件
    print("\n生成文章HTML...")
    folder_names = []
    for i, article in enumerate(articles):
        folder = generate_article_html(article, {})
        folder_names.append(folder)
        print(f"  [{i+1}/{len(articles)}] {folder}")
    
    # 保存列表JSON供diary.html使用
    diary_data = generate_diary_list_json(articles, folder_names)
    json_path = DIARIES_DIR / "diary_list.json"
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(diary_data, f, ensure_ascii=False, indent=2)
    print(f"\n日记列表已保存: {json_path}")
    print(f"文章页面: {DIARIES_DIR}")
    print("完成!")

if __name__ == '__main__':
    main()
