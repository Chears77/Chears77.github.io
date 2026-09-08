# -*- coding: utf-8 -*-
# check.py — 法规库校验：level 与文件夹匹配 + 跨文件夹重复检测 + 必填字段
# 放在 2法规库/ 下，由 rebuild.bat 在构建前调用；无问题返回 0，有问题返回 1。
import os, re, sys, hashlib

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))   # 2法规库
SKIP_FILES = {'格式说明.md', 'README.md', '法规清单初稿.xlsx'}
FM_RE = re.compile(r'^---\s*\n(.*?)\n---\s*\n', re.DOTALL)


def parse_fm(path):
    try:
        t = open(path, encoding='utf-8').read()
    except Exception as e:
        return None, 'READ_ERROR:' + str(e)
    m = FM_RE.match(t)
    if not m:
        return {}, 'NO_FRONT_MATTER'
    d = {}
    for line in m.group(1).split('\n'):
        if ':' in line:
            k, v = line.split(':', 1)
            d[k.strip()] = v.strip()
    return d, None


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(8192), b''):
            h.update(b)
    return h.hexdigest()


def main():
    # 识别分类文件夹 NN-层级名
    cat_dirs = []
    for name in sorted(os.listdir(BASE)):
        full = os.path.join(BASE, name)
        if os.path.isdir(full) and re.match(r'^\d{2}-', name):
            level = re.sub(r'^\d{2}-', '', name)
            cat_dirs.append((name, level, full))

    issues = []
    by_name = {}          # 文件名 -> [相对路径...]
    by_hash = {}          # sha256 -> [相对路径...]
    files_checked = 0

    for folder, exp_level, full in cat_dirs:
        for root, dirs, files in os.walk(full):
            for fn in files:
                if not fn.lower().endswith('.md'):
                    continue
                if fn in SKIP_FILES:
                    continue
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, BASE)
                files_checked += 1
                fm, err = parse_fm(fp)

                # level 检查
                lv = (fm or {}).get('level', '').strip()
                if err == 'NO_FRONT_MATTER':
                    issues.append('[缺失FrontMatter] %s' % rel)
                elif not lv:
                    issues.append('[缺失level] %s' % rel)
                elif lv != exp_level:
                    issues.append('[level不匹配] %s 文件level="%s" 但文件夹期望"%s"' % (rel, lv, exp_level))

                # 必填字段
                if not (fm or {}).get('title', '').strip():
                    issues.append('[缺失title] %s' % rel)

                by_name.setdefault(fn, []).append(rel)
                by_hash.setdefault(sha256(fp), []).append(rel)

    # 重名跨文件夹
    for name, lst in by_name.items():
        if len(lst) > 1:
            issues.append('[重名文件] "%s" 出现在 %d 处: %s' % (name, len(lst), ' | '.join(lst)))

    # 同内容但不同名（同名的已由上面覆盖，避免重复提示）
    for h, lst in by_hash.items():
        if len(lst) > 1 and len(set(os.path.basename(p) for p in lst)) > 1:
            issues.append('[同内容重复] 哈希%s... 出现在 %d 处: %s' % (h[:10], len(lst), ' | '.join(lst)))

    print('校验完成：检查 %d 个 md 文件，分类文件夹 %d 个。' % (files_checked, len(cat_dirs)))
    if not issues:
        print('OK：未发现 level 不匹配或重复文件问题。')
        return 0
    print('发现 %d 个问题：' % len(issues))
    for i in issues:
        print('  - ' + i)
    return 1


if __name__ == '__main__':
    sys.exit(main())
