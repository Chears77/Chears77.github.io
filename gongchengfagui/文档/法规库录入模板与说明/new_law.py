# -*- coding: utf-8 -*-
# new_law.py — 法规录入辅助：按 level 自动归位 + 录入向导
# 放在 2法规库/ 下。
#   python new_law.py scan            # 列出放错文件夹的 md（只读，不改动）
#   python new_law.py place --all     # 把放错的全部移回正确文件夹
#   python new_law.py place <文件.md> # 归位单个文件
#   python new_law.py new             # 交互式录入向导，直接生成规范 md 到正确文件夹
#
# 设计原则（重要）：
#   * 本工具只做「文件夹归位」（按 level 字段），【不重命名】文件、
#     【不为地方类建省/市子目录】。理由：现有 294 部法规的文件名日期
#     写在文件名里、地方类平铺在 NN-层级 文件夹下；擅自改名/建子目录会
#     破坏现有结构。文件名与子目录结构由人工/生成器统一维护。
#   * 归类唯一依据：Front Matter 的 level 字段。
import os, re, sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))   # 2法规库
SKIP = {'格式说明.md', 'README.md', '法规清单初稿.xlsx'}
FM_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.DOTALL)
# doc_type 推断：判例/解读用 doc，其余 law
DOC_DOC = {'司法案例', '行政案例', '政策解读'}


def parse_fm(path):
    try:
        t = open(path, encoding='utf-8').read()
    except Exception:
        return {}
    m = FM_RE.match(t)
    if not m:
        return {}
    d = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            d[k.strip()] = v.strip()
    return d


def cat_folders():
    """level -> (文件夹名, 文件夹绝对路径)；地方类返回平铺的 NN-层级 目录"""
    out = {}
    for name in sorted(os.listdir(BASE)):
        full = os.path.join(BASE, name)
        if os.path.isdir(full) and re.match(r'^\d{2}-', name):
            out[re.sub(r'^\d{2}-', '', name)] = (name, full)
    return out


def expected_dir(fm):
    """返回该文件应处的目录(绝对)。地方类平铺在 NN-层级 下。返回 (dir, err)"""
    level = (fm.get('level') or '').strip()
    cats = cat_folders()
    if level not in cats:
        return None, '未知 level="%s"（合法值：%s）' % (level, ' / '.join(cats.keys()))
    # 地方类也平铺，不建省/市子目录（与现有 294 部结构一致；region 由 FM 驱动网页地区树）
    return cats[level][1], None


def in_correct_folder(path):
    fm = parse_fm(path)
    if not fm:
        return None, '无 Front Matter，无法判断'
    edir, err = expected_dir(fm)
    if err:
        return None, err
    cur = os.path.dirname(os.path.abspath(path))
    return (os.path.normpath(cur) == os.path.normpath(edir)), None


def canonical_name(fm):
    """仅 new 向导使用：日期-文号-标题.md；日期优先级 revise>effective>publish(YYYYMMDD)"""
    date = (fm.get('revise_date') or fm.get('effective_date') or fm.get('publish_date') or '').replace('-', '')
    docno = (fm.get('doc_number') or '').strip()
    title = (fm.get('title') or '').strip()
    parts = [p for p in (date, docno, title) if p]
    name = '-'.join(parts) + '.md' if parts else '未命名.md'
    for ch in r'\\/:*?"<>|':
        name = name.replace(ch, '-')
    return name.strip()


def place_file(path, go):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        print('[跳过] 文件不存在: %s' % path)
        return
    if os.path.basename(path) in SKIP:
        print('[跳过] 系统文件: %s' % os.path.basename(path))
        return
    ok, err = in_correct_folder(path)
    if err:
        print('[问题] %s -> %s' % (os.path.relpath(path, BASE), err))
        return
    if ok:
        print('[已就位] %s' % os.path.relpath(path, BASE))
        return
    fm = parse_fm(path)
    edir, _ = expected_dir(fm)
    dest = os.path.join(edir, os.path.basename(path))
    if os.path.exists(dest):
        print('[跳过] 目标已存在同名文件: %s' % os.path.relpath(dest, BASE))
        return
    if go:
        os.makedirs(edir, exist_ok=True)
        import shutil
        shutil.move(path, dest)
        print('[已归位] %s  ->  %s' % (os.path.relpath(path, BASE), os.path.relpath(dest, BASE)))
    else:
        print('[待归位] %s  ->  %s  (加 --go 执行)' % (os.path.relpath(path, BASE), os.path.relpath(edir, BASE)))


def scan(go=False):
    mis = 0
    for folder in sorted(os.listdir(BASE)):
        full = os.path.join(BASE, folder)
        if not os.path.isdir(full):
            continue
        for root, _, files in os.walk(full):
            for fn in files:
                if not fn.endswith('.md') or fn in SKIP:
                    continue
                fp = os.path.join(root, fn)
                ok, err = in_correct_folder(fp)
                if err:
                    continue  # 由 check.py 报告
                if not ok:
                    mis += 1
                    place_file(fp, go)
    if mis == 0:
        print('所有 md 均已在正确文件夹（按 level 归类）。')
    else:
        print('共 %d 个待归位。' % mis)
    return mis


def new_wizard():
    cats = cat_folders()
    levels = list(cats.keys())
    print('=== 新法规录入向导 ===')
    title = input('法规名称: ').strip()
    if not title:
        print('名称不能为空，已取消。')
        return
    print('效力层级（输入序号）:')
    for i, l in enumerate(levels, 1):
        print('  %d. %s' % (i, l))
    try:
        idx = int(input('选择: ').strip()) - 1
        level = levels[idx]
    except (ValueError, IndexError):
        print('选择无效，已取消。')
        return
    publisher = input('发布机构: ').strip()
    doc_number = input('文号(无则回车): ').strip()
    publish_date = input('发布日期(YYYY-MM-DD): ').strip()
    effective_date = input('实施日期(YYYY-MM-DD, 无则回车): ').strip()
    revise_date = input('修订日期(YYYY-MM-DD, 无则回车): ').strip()
    field = input('专业领域(如 招投标/施工/质量, 无则回车): ').strip()
    source_url = input('官方来源URL(无则回车): ').strip()
    region = ''
    if level.startswith('地方'):
        region = input('地区(省 或 省/市, 如 四川省 或 四川省/成都市): ').strip()
    print('粘贴正文（以单独一行 END 结束）:')
    body_lines = []
    while True:
        line = input()
        if line.strip() == 'END':
            break
        body_lines.append(line)
    body = '\n'.join(body_lines).strip()

    fm = {
        'title': title,
        'level': level,
        'doc_type': 'doc' if level in DOC_DOC else 'law',
        'publisher': publisher,
        'doc_number': doc_number,
        'publish_date': publish_date,
        'effective_date': effective_date,
        'revise_date': revise_date,
        'field': field,
        'region': region,
        'status': '现行',
        'verify_status': '初稿待校核',
        'source_url': source_url,
        'tags': '',
        'note': '',
    }
    fm_block = '---\n'
    order = ['title', 'level', 'doc_type', 'publisher', 'doc_number', 'publish_date',
             'effective_date', 'revise_date', 'field', 'region', 'status',
             'verify_status', 'source_url', 'tags', 'note']
    for k in order:
        fm_block += '%s: %s\n' % (k, fm.get(k, '') or '')
    fm_block += '---\n\n'

    edir, err = expected_dir(fm)
    if err:
        print('[错误] %s' % err)
        return
    os.makedirs(edir, exist_ok=True)
    cname = canonical_name(fm)
    dest = os.path.join(edir, cname)
    if os.path.exists(dest):
        print('[跳过] 目标已存在同名文件: %s' % os.path.relpath(dest, BASE))
        return
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(fm_block + body + '\n')
    print('[已创建] %s' % os.path.relpath(dest, BASE))
    print('提示：运行 check.py 校验，或直接双击 rebuild.bat 上线。')


def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help', 'help'):
        print(__doc__)
        return 0
    cmd = args[0]
    if cmd == 'scan':
        return 0 if scan(go=False) == 0 else 1
    if cmd == 'place':
        go = '--go' in args
        if '--all' in args:
            scan(go=True)
            return 0
        targets = [a for a in args[1:] if not a.startswith('--')]
        if not targets:
            print('用法: python new_law.py place <文件.md>  或  place --all [--go]')
            return 1
        for t in targets:
            place_file(t, go)
        return 0
    if cmd == 'new':
        new_wizard()
        return 0
    print('未知命令: %s' % cmd)
    print(__doc__)
    return 1


if __name__ == '__main__':
    sys.exit(main())
