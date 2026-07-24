# -*- coding: utf-8 -*-
"""
build_data.py — 第二版数据构建脚本
读取 3第二版/法规库 下的全部法规 md，解析 front matter + 章/条结构，
生成：
  data/manifest.json  —— 轻量清单（首屏侧栏/导航/即时筛选检索用，体积小）
  data/search.json    —— 紧凑全文检索索引（懒加载，用户点检索时才 fetch）
保留 md 为唯一数据源；本脚本不修改 md。
"""
import os, re, json, hashlib, shutil

BASE = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(BASE, '法规库')
DATA_DIR = os.path.join(BASE, 'data')
LAWS_DIR = os.path.join(BASE, 'laws')   # ASCII 部署副本（GitHub Pages 对中文路径支持不佳，fetch 中文路径会 404）

LEVEL_ORDER = {'法律':0,'司法解释':1,'中央行政法规':2,'中央部门规章':3,'中央规范性文件':4,
               '地方行政法规':5,'地方规章':6,'地方规范性文件':7,'标准规范':8,
               '司法案例':9,'行政案例':10,'政策解读':11}

# ---- 库判定规则（与 v1 gen_website.py libMatch 保持一致）----
LIB_DEFS = {
    'zong':'法规总库','zhujian':'住建库','shizheng':'市政给排水库','jiaotong':'交通库',
    'zhaobiao':'招投标库','jianshe':'建设单位常用库','shigong':'施工单位常用库',
    'difang':'地方库'
}
def lib_match(key, field, title, region):
    hay = (field or '') + ' ' + (title or '')
    if key == 'zong': return True
    if key == 'zhujian': return bool(re.search(r'住建|住房|城乡建设|房地产|建筑市场|施工|工程质量|市政|城市更新|好房子', hay))
    if key == 'shizheng': return bool(re.search(r'排水|给水|供水|防水|水务|污水|海绵|燃气|园林绿化', hay))
    if key == 'jiaotong': return bool(re.search(r'交通|公路|桥梁|铁路|轨道', hay))
    if key == 'zhaobiao': return bool(re.search(r'招投标|招标|投标|采购', hay))
    if key == 'jianshe': return bool(re.search(r'招投标|招标|投标|采购|合同|造价|用地|规划|立项|发包|房地产|前期', hay))
    if key == 'shigong': return bool(re.search(r'施工|安全|质量|资质|分包|劳务|特种作业|技术|工程总承包', hay))
    if key == 'difang': return bool(region) and region != '国家级'
    return False

def norm_region(r):
    if not r or str(r).strip() in ('', "''", '""'):
        return '国家级'
    return str(r).strip().strip('\'"')

def norm_date(v):
    if not v: return ''
    v = str(v).strip().strip('\'"')
    return '' if v in ('', "''", '""') else v

RE_ART = re.compile(r'^###\s*第[一二三四五六七八九十百零0-9]+[条款]')          # 条 / 款
RE_CH  = re.compile(r'^##\s+第[一二三四五六七八九十百零0-9]+章')              # 章
RE_SEC = re.compile(r'^(##|###)\s+第[一二三四五六七八九十百零0-9]+节')        # 节

def parse_md(text):
    """返回 (meta_dict, chapters_list, articles_flat)
    chapters_list: [{'title':..., 'arts':[article_no,...]}]
    articles_flat: [{'chapter':..., 'article':..., 'content':...}]
    """
    # front matter
    meta = {}
    body = text
    if text.startswith('---'):
        parts = text.split('---', 2)
        if len(parts) >= 3:
            fm = parts[1]
            body = parts[2]
            for line in fm.splitlines():
                if ':' in line:
                    k, _, v = line.partition(':')
                    meta[k.strip()] = v.strip()
    # 逐行解析结构
    chapters = []          # 当前章列表
    cur_ch = None
    arts = []
    cur_art = None         # {chapter, article, lines:[]}
    in_quote = False
    for raw in body.split('\n'):
        line = raw.rstrip('\r')
        if line.startswith('>'):
            in_quote = True
            # 引文不计入条/章结构（仅在渲染层处理为说明）
            continue
        in_quote = False
        if line.startswith('###'):
            m = line.strip()
            if RE_ART.match(m):                      # 条
                if cur_art: arts.append(_flush(cur_art))
                if cur_ch is None:
                    cur_ch = {'title': '（未分章）', 'arts': []}
                    chapters.append(cur_ch)
                art_no = m[3:].strip()
                cur_art = {'chapter': cur_ch['title'], 'article': art_no, 'lines': []}
                cur_ch['arts'].append(art_no)
            else:                                   # 其它 ###（节/子标题），不算条
                if cur_art: arts.append(_flush(cur_art)); cur_art = None
                if cur_ch is None:
                    cur_ch = {'title': '（未分章）', 'arts': []}
                    chapters.append(cur_ch)
        elif line.startswith('##'):
            m = line.strip()
            if RE_CH.match(m):                       # 新章
                if cur_art: arts.append(_flush(cur_art)); cur_art = None
                title = m[2:].strip()
                cur_ch = {'title': title, 'arts': []}
                chapters.append(cur_ch)
            elif RE_SEC.match(m):                    # 节（作为章内子标题，不单列章）
                if cur_art: arts.append(_flush(cur_art)); cur_art = None
                if cur_ch is None:
                    cur_ch = {'title': '（未分章）', 'arts': []}
                    chapters.append(cur_ch)
                # 节不计入条，仅作分隔
            else:
                # 其它 ## 标题也视为章
                if cur_art: arts.append(_flush(cur_art)); cur_art = None
                title = m[2:].strip()
                cur_ch = {'title': title, 'arts': []}
                chapters.append(cur_ch)
        else:
            if cur_art is not None:
                cur_art['lines'].append(line)
    if cur_art: arts.append(_flush(cur_art))
    return meta, chapters, arts

def _flush(art):
    art['content'] = '\n'.join(art['lines']).strip()
    del art['lines']
    return art

def main():
    laws = []
    search = []
    # 清空旧 ASCII 副本，避免残留
    if os.path.isdir(LAWS_DIR):
        shutil.rmtree(LAWS_DIR)
    os.makedirs(LAWS_DIR, exist_ok=True)
    for root, _, files in os.walk(LIB_DIR):
        for fn in sorted(files):
            if not fn.endswith('.md'):
                continue
            path = os.path.join(root, fn)
            try:
                text = open(path, encoding='utf-8').read()
            except Exception as e:
                print('SKIP (read error):', path, e); continue
            meta, chapters, arts = parse_md(text)
            title = meta.get('title', fn[:-3])
            level = meta.get('level', '')
            region = norm_region(meta.get('region', ''))
            field = meta.get('field', '')
            status = meta.get('status', '现行')
            doc_number = meta.get('doc_number', '')
            publisher = meta.get('publisher', '')
            verify_status = meta.get('verify_status', '初稿待校核')
            publish_date = norm_date(meta.get('publish_date', ''))
            effective_date = norm_date(meta.get('effective_date', ''))
            revise_date = norm_date(meta.get('revise_date', ''))
            source_url = meta.get('source_url', '')
            # 生成 ASCII 部署副本（GitHub Pages 对中文路径支持不佳，fetch 中文路径会 404）
            ascii_base = '%02d_%s' % (LEVEL_ORDER.get(level, 99), hashlib.sha1(title.encode('utf-8')).hexdigest()[:12])
            dest = os.path.join(LAWS_DIR, ascii_base + '.md')
            with open(dest, 'w', encoding='utf-8') as _f:
                _f.write(text)
            rel = 'laws/' + ascii_base + '.md'
            # 库标签
            libs = [k for k in LIB_DEFS if lib_match(k, field, title, region)]
            law = {
                'id': ascii_base,
                'title': title,
                'level': level,
                'region': region,
                'publisher': publisher,
                'doc_number': doc_number,
                'status': status,
                'field': field,
                'verify_status': verify_status,
                'publish_date': publish_date,
                'effective_date': effective_date,
                'revise_date': revise_date,
                'source_url': source_url,
                'libs': libs,
                'count': len(arts),
                'chapters': [{'title': c['title'], 'count': len(c['arts'])} for c in chapters],
                'file': rel,
            }
            laws.append(law)
            for a in arts:
                search.append({
                    'lid': ascii_base,
                    'law_title': title,
                    'level': level,
                    'region': region,
                    'status': status,
                    'chapter_title': a['chapter'],
                    'article': a['article'],
                    'content': a['content'],
                })
    # 排序（与 v1 一致）
    laws.sort(key=lambda x: (LEVEL_ORDER.get(x['level'], 9), x['title']))
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(laws, f, ensure_ascii=False)
    with open(os.path.join(DATA_DIR, 'search.json'), 'w', encoding='utf-8') as f:
        json.dump(search, f, ensure_ascii=False)
    total_art = sum(l['count'] for l in laws)
    print('法规部数:', len(laws))
    print('条文总数:', total_art)
    print('检索条目:', len(search))
    # 库计数
    for k in LIB_DEFS:
        print('  库 %s: %d' % (LIB_DEFS[k], sum(1 for l in laws if k in l['libs'])))
    # 体积
    import os as _os
    m = _os.path.getsize(os.path.join(DATA_DIR, 'manifest.json'))
    s = _os.path.getsize(os.path.join(DATA_DIR, 'search.json'))
    print('manifest.json: %.2f MB' % (m/1024/1024))
    print('search.json:   %.2f MB' % (s/1024/1024))

if __name__ == '__main__':
    main()
