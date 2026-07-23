# -*- coding: utf-8 -*-
"""
生成 3第二版/nav.html（法规导航门户）。
视觉 100% 沿用 v1 门户（2第一版/3网站版/index.html）：同样的 topbar、渐变 hero、
按效力层级分组的卡片、官方库导航、免责声明页脚；数据层改用 v2 的 manifest.json 懒加载，
法规深链指向 v2 阅读站 ./index.html#标题。
"""
import os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
V1 = os.path.normpath(os.path.join(ROOT, '..', '2第一版', '3网站版', 'index.html'))

html = open(V1, encoding='utf-8').read()

# 1) 提取 v1 门户的整套 CSS（保证视觉一致）
css = re.search(r'<style>(.*?)</style>', html, re.S).group(1)

# 2) 提取 v1 的「官方规章库导航」+ 页脚（静态内容，原样复用）
ff = re.search(r'<div class="footlinks">.*?</footer>', html, re.S).group(0)

# 3) v2 独有：顶栏 + 渐变 hero（DOM 与 v1 一致，链接改指 v2 页面）
TOPBAR = '''<header class="topbar"><div class="wrap tb-inner">
  <a class="logo" href="./nav.html">工建法研<small>工程建设法规库</small></a>
  <div class="tb-btns">
    <a class="tb-btn active" href="./nav.html">导航页</a>
    <a class="tb-btn" href="./index.html" target="_blank">法规库</a>
  </div>
  <div class="tb-search" id="tbSearch">
    <div class="hs-input"><span class="hs-ico">🔍</span>
      <input id="q2" placeholder="搜索法规、条文、关键词…" onkeydown="kd2(event)"></div>
    <button class="btn btn-search" onclick="navSearch2()">原文检索</button>
    <button class="btn btn-ai" onclick="navAI2()">AI问答</button>
  </div>
</div></header>

<section class="hero"><div class="wrap hero-inner">
  <div class="hero-search">
    <div class="hs-input"><span class="hs-ico">🔍</span>
      <input id="q" placeholder="搜索法规、条文、关键词…（如：招投标、安全生产许可证）" onkeydown="kd(event)"></div>
    <button class="btn btn-search" onclick="navSearch()">原文检索</button>
    <button class="btn btn-ai" onclick="navAI()">AI问答</button>
  </div>
</div></section>'''

# 4) v2 数据加载 + 卡片渲染 JS（复用 manifest 字段；与 v1 卡片 DOM 一致）
JS = r'''
const LEVEL_ORDER={'法律':0,'司法解释':1,'标准规范':2,'中央行政法规':3,'中央部门规章':4,'中央规范性文件':5,'地方行政法规':6,'地方规章':7,'地方规范性文件':8,'司法案例':9,'行政案例':10,'政策解读':11};
let LAWS=[];
function esc(s){return (s==null?'':String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function fmtDate(l){
  if(l.effective_date) return '📅 实施 '+l.effective_date;
  if(l.revise_date) return '📅 修订 '+l.revise_date;
  if(l.publish_date) return '📅 颁布 '+l.publish_date;
  return '';
}
const LOCAL_LEVELS={'地方行政法规':1,'地方规章':1,'地方规范性文件':1};
function regionBadge(r,lv){ if(LOCAL_LEVELS[lv]) return ''; if(!r||r==='国家级'||r==='全国') return ''; return '<span class="li-region">'+esc(r)+'</span>'; }
function dateKey(l){ return l.effective_date || l.revise_date || l.publish_date || ''; }
function buildCards(){
  const levels=[...new Set(LAWS.map(l=>l.level))].sort((a,b)=>(LEVEL_ORDER[a]==null?9:LEVEL_ORDER[a])-(LEVEL_ORDER[b]==null?9:LEVEL_ORDER[b]));
  let html='';
  levels.forEach(lv=>{
    const all=LAWS.filter(l=>l.level===lv);
    // 按实施/修订/颁布日期倒序，取「最近」的三个
    const sorted=all.slice().sort(function(a,b){ var da=dateKey(a),db=dateKey(b); return db<da?-1:(db>da?1:0); });
    const list=sorted.slice(0,3);
    let items='';
    list.forEach(l=>{
      const url='./index.html#'+encodeURIComponent(l.title);
      const pubCls='li-pub'+(l.status==='已废止'?' li-pub-abol':'');
      items+='<a class="law-item" href="'+url+'" target="_blank" title="'+esc(l.title)+'">'+
        '<span class="li-main"><span class="li-title">'+esc(l.title)+'</span></span>'+
        '<span class="li-meta">'+regionBadge(l.region,lv)+
        '<span class="'+pubCls+'">'+esc(l.publisher)+'</span>'+
        '<span class="li-date">'+fmtDate(l)+'</span></span></a>';
    });
    const moreTxt = all.length>3 ? ('进入法规库查看全部（共 '+all.length+' 部） →') : '进入法规库查看全部 →';
    html+='<div class="card"><div class="card-h"><span class="lv">'+esc(lv)+'</span><span class="lv-n">'+all.length+' 部</span></div>'+
      '<div class="law-list">'+items+'</div>'+
      '<a class="more" href="./index.html" target="_blank">'+moreTxt+'</a></div>';
  });
  document.getElementById('lawGrid').innerHTML=html;
  let arts=0; LAWS.forEach(l=>{arts+=(l.count||0);});
  document.getElementById('navStat').textContent='共 '+LAWS.length+' 部法规 · '+arts+' 条 · 按效力层级分类（每类显示最近 3 部）';
}
function go(q){ var v=(q||'').trim(); if(!v) return null; return './index.html?q='+encodeURIComponent(v); }
function navSearch(){ var u=go(document.getElementById('q').value); if(!u){document.getElementById('q').focus();return;} window.open(u,'_blank'); }
function navAI(){ var u=go(document.getElementById('q').value); if(!u){document.getElementById('q').focus();return;} window.open(u+'&ai=1','_blank'); }
function navSearch2(){ var u=go(document.getElementById('q2').value); if(!u){document.getElementById('q2').focus();return;} window.open(u,'_blank'); }
function navAI2(){ var u=go(document.getElementById('q2').value); if(!u){document.getElementById('q2').focus();return;} window.open(u+'&ai=1','_blank'); }
function kd(e){ if(e.key==='Enter') navSearch(); }
function kd2(e){ if(e.key==='Enter') navSearch2(); }
window.addEventListener('scroll',function(){
  var h=document.querySelector('.topbar'); var ts=document.getElementById('tbSearch'); if(!ts) return;
  if(window.scrollY>220){ ts.classList.add('show'); if(h) h.classList.add('scrolled'); }
  else { ts.classList.remove('show'); if(h) h.classList.remove('scrolled'); }
});
fetch(encodeURI('./data/manifest.json'),{cache:'force-cache'}).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(d){ LAWS=d; buildCards(); }).catch(function(e){
  document.getElementById('lawGrid').innerHTML='<div class="nav-err">⚠️ 无法加载 manifest.json：'+(e&&e.message?e.message:e)+'<br>请通过本地服务器或 GitHub Pages 访问（直接双击 file:// 会被浏览器安全策略拦截）。</div>';
});
'''

OUT = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>工建法研 · 法规导航</title>
<style>@@CSS@@</style>
<style>
.nav-loading,.nav-err{padding:48px 20px;text-align:center;color:#8c8c8c;font-size:14px}
.nav-err{color:#cf1322}
.nav-stat{font-size:13px;color:#8c8c8c;margin:0 0 16px}
</style>
</head>
<body>
@@TOPBAR@@
<div class="wrap">
  <div class="section" id="recent">
    <div class="section-h"><h2>法规总览</h2><span class="sub" id="navStat">正在加载法规清单…</span></div>
    <div class="recent-rows"><div class="row-block"><div class="grid" id="lawGrid"><div class="nav-loading">⏳ 正在加载法规清单…</div></div></div></div>
  </div>
  @@FF@@
</div>
<script>@@JS@@</script>
</body>
</html>
'''
OUT = OUT.replace('@@CSS@@', css).replace('@@TOPBAR@@', TOPBAR).replace('@@FF@@', ff).replace('@@JS@@', JS)

with open(os.path.join(ROOT, 'nav.html'), 'w', encoding='utf-8') as f:
    f.write(OUT)

print('nav.html 已生成，大小', len(OUT), '字符')
