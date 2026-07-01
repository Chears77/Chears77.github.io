#!/usr/bin/env python3
"""
清理所有文章HTML中的思源笔记冗余结构，消除过多留白。
- 将 <div class="p"> 结构转换为干净的 <p> 或 <div class="img">
- 移除空 protyle-attr div
- 移除无用的 contenteditable 属性
- 简化图片包裹结构
"""
import re
import os
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString, Tag

DIARIES_DIR = Path(r"E:\AI\workbuddy\20260630女儿主页\v2\diaries")

def clean_article_html(filepath: Path):
    """清理单个文章HTML文件"""
    with open(filepath, 'r', encoding='utf-8') as f:
        html = f.read()
    
    soup = BeautifulSoup(html, 'html.parser')
    article_body = soup.find('div', class_='article-body')
    if not article_body:
        print(f"  [SKIP] 未找到 .article-body: {filepath.name}")
        return False
    
    # 找到所有 div.p 元素
    p_divs = article_body.find_all('div', class_='p')
    
    for p_div in p_divs:
        # 检查是否包含图片
        img_tags = p_div.find_all('img')
        text_divs = p_div.find_all('div', contenteditable='false')
        
        if img_tags:
            # 图片段落：创建干净的图片容器
            new_div = soup.new_tag('div')
            new_div['class'] = 'img'
            for img in img_tags:
                # 获取src属性，清洗思源命名的图片路径
                src = img.get('src', '')
                alt = img.get('alt', '')
                clean_img = soup.new_tag('img', src=src, alt=alt)
                new_div.append(clean_img)
            p_div.replace_with(new_div)
        else:
            # 文本段落：提取干净文本，创建 <p>
            texts = []
            for td in text_divs:
                # 获取纯文本，保留内联格式
                content = extract_inline_content(td, soup)
                if content.strip():
                    texts.append(content)
            
            combined = ' '.join(texts).strip()
            if combined:
                new_p = soup.new_tag('p')
                # 将组合后的HTML内容放入p标签（保留内联格式）
                if any(td.find(['strong', 'em', 'a', 'span']) for td in text_divs):
                    # 有内联格式，合并HTML
                    new_p.append(BeautifulSoup(combined, 'html.parser'))
                else:
                    new_p.string = BeautifulSoup(combined, 'html.parser').get_text()
                p_div.replace_with(new_p)
            else:
                # 空段落，直接删除
                p_div.decompose()
    
    # 移除所有残留的 protyle-attr 空div
    for attr_div in article_body.find_all('div', class_='protyle-attr'):
        attr_div.decompose()
    
    # 移除所有 contenteditable 属性
    for tag in article_body.find_all(attrs={'contenteditable': 'false'}):
        del tag['contenteditable']
        del tag['spellcheck']
    
    # 移除空的div.p（如果还有残留）
    for p_div in article_body.find_all('div', class_='p'):
        p_div.decompose()
    
    # 移除连续的空白p标签
    prev_was_empty = False
    for child in list(article_body.children):
        if isinstance(child, Tag) and child.name == 'p':
            text = child.get_text(strip=True)
            if not text:
                child.decompose()
    
    # 移除开头/结尾的空白导航字符串
    for child in list(article_body.children):
        if isinstance(child, NavigableString) and not child.strip():
            child.extract()
    
    # 美化输出
    cleaned = soup.prettify(formatter='html5')
    
    # 修复prettify可能产生的多余空白
    cleaned = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned)
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(cleaned)
    
    return True


def extract_inline_content(tag, soup):
    """提取标签中的内联内容，保留 strong/em/a/span 格式"""
    parts = []
    for child in tag.contents:
        if isinstance(child, NavigableString):
            parts.append(str(child))
        elif isinstance(child, Tag):
            if child.name in ('strong', 'em', 'a', 'span'):
                # 保留内联格式
                text = child.get_text()
                if child.name == 'strong':
                    text = f'<strong>{text}</strong>'
                elif child.name == 'em':
                    text = f'<em>{text}</em>'
                elif child.name == 'a':
                    href = child.get('href', '#')
                    if 'javascript:' in href:
                        text = f'<span>{text}</span>'
                    else:
                        text = f'<a href="{href}">{text}</a>'
                elif child.name == 'span':
                    dt = child.get('data-type', '')
                    if dt == 'strong':
                        text = f'<strong>{text}</strong>'
                    elif dt == 'em':
                        text = f'<em>{text}</em>'
                    else:
                        text = text  # 普通span保留文本
                parts.append(text)
            else:
                parts.append(child.get_text())
    return ''.join(parts)


def main():
    print("=" * 60)
    print("清理文章HTML留白问题")
    print("=" * 60)
    
    article_dirs = sorted(DIARIES_DIR.iterdir())
    total = 0
    cleaned = 0
    
    for d in article_dirs:
        if not d.is_dir():
            continue
        html_path = d / 'index.html'
        if not html_path.exists():
            continue
        
        total += 1
        print(f"\n[{total}] {d.name[:60]}...")
        
        try:
            if clean_article_html(html_path):
                cleaned += 1
                print(f"  ✓ 已清理")
            else:
                print(f"  - 无需清理")
        except Exception as e:
            print(f"  ✗ 错误: {e}")
    
    print(f"\n{'=' * 60}")
    print(f"完成: {cleaned}/{total} 篇文章已清理")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
