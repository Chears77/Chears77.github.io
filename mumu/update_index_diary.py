#!/usr/bin/env python3
"""
更新 index.html 的成长日记板块：
- 从 diary.html 提取 DIARY_DATA
- 替换 index.html 中硬编码的日记条目为动态渲染
"""
import re, json

# 读取 diary.html 提取 DIARY_DATA
with open(r'E:\AI\workbuddy\20260630女儿主页\v2\diary.html', 'r', encoding='utf-8') as f:
    diary_html = f.read()

m = re.search(r'var DIARY_DATA = (\[.*?\]);', diary_html, re.DOTALL)
if not m:
    print("ERROR: 未找到 DIARY_DATA")
    exit(1)

diary_data_str = m.group(1)
# 验证JSON
data = json.loads(diary_data_str)
print(f"读取到 {len(data)} 条日记记录")

# 读取 index.html
with open(r'E:\AI\workbuddy\20260630女儿主页\v2\index.html', 'r', encoding='utf-8') as f:
    index_html = f.read()

# --- 替换: 成长日记板块的硬编码条目 ---
old_diary_block = """    <!-- 4. 成长日记 -->
    <div class="preview-cell fade-in" id="preview-diary">
      <div class="preview-cell-header">
        <span class="preview-cell-icon diary">&#128214;</span>
        <span class="preview-cell-title">成长日记</span>
      </div>
      <div class="preview-cell-item">作文《我的爸爸》· 获班级优秀</div>
      <div class="preview-cell-item">学校公众号报道 · 绘画比赛获奖</div>
      <div class="preview-cell-item">爸爸写给Alisa的11岁生日信</div>
      <a href="diary.html" class="preview-cell-more">阅读日记 →</a>
    </div>"""

new_diary_block = """    <!-- 4. 成长日记 -->
    <div class="preview-cell fade-in" id="preview-diary">
      <div class="preview-cell-header">
        <span class="preview-cell-icon diary">&#128214;</span>
        <span class="preview-cell-title">成长日记</span>
      </div>
      <div id="diaryPreviewList"></div>
      <a href="diary.html" class="preview-cell-more">阅读全部日记 →</a>
    </div>"""

if old_diary_block in index_html:
    index_html = index_html.replace(old_diary_block, new_diary_block)
    print("已替换硬编码日记条目为动态容器")
else:
    print("WARNING: 未找到旧日记板块代码，请手动检查")
    # 尝试更宽松的匹配
    if 'id="preview-diary"' in index_html:
        print("  但找到了 preview-diary，可能需要调整匹配")
    exit(1)

# --- 在 </body> 前插入 DIARY_DATA + 渲染脚本 ---
render_script = f"""
<!-- 成长日记动态数据 -->
<script>
var DIARY_DATA = {diary_data_str};

(function() {{
  var list = document.getElementById('diaryPreviewList');
  if (!list) return;

  // 分类标签映射
  var catLabel = {{school:'校园报道', essay:'作文', diary:'个人日记'}};
  var catEmoji = {{school:'📰', essay:'✏️', diary:'📷'}};

  // 取最新5条
  var latest = DIARY_DATA.slice(0, 5);

  latest.forEach(function(x) {{
    var dd = x.date;
    if (x.date.length === 8) dd = x.date.substr(0,4)+'-'+x.date.substr(4,2)+'-'+x.date.substr(6,2);
    else if (x.date.length === 6) dd = x.date.substr(0,4)+'-'+x.date.substr(4,2);

    var item = document.createElement('div');
    item.className = 'preview-cell-item';

    var catTag = document.createElement('span');
    catTag.style.cssText = 'display:inline-block;padding:0 6px;border-radius:10px;font-size:10px;font-weight:600;margin-right:4px';
    catTag.textContent = catLabel[x.cat] || x.cat;
    if (x.cat === 'essay') catTag.style.cssText += 'background:var(--pink-light);color:var(--pink-dark)';
    else if (x.cat === 'diary') catTag.style.cssText += 'background:linear-gradient(135deg,var(--pink-light),var(--yellow));color:var(--pink-dark)';
    else catTag.style.cssText += 'background:var(--blue-light);color:var(--blue-dark)';

    var titleSpan = document.createElement('span');
    titleSpan.textContent = x.title.length > 18 ? x.title.substr(0,18)+'...' : x.title;

    item.appendChild(catTag);
    item.appendChild(titleSpan);
    list.appendChild(item);
  }});
}})();
</script>
"""

# 找到 </body> 前最后一个 <script> 标签之后插入
body_end = index_html.rfind('</body>')
if body_end == -1:
    print("ERROR: 未找到 </body>")
    exit(1)

index_html = index_html[:body_end] + render_script + '\n' + index_html[body_end:]

# 写回
with open(r'E:\AI\workbuddy\20260630女儿主页\v2\index.html', 'w', encoding='utf-8') as f:
    f.write(index_html)

print("✓ index.html 已更新，成长日记板块现在自动显示最新5条日记")
