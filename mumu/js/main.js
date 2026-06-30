/* ============================================================
   Alisa 成长纪念 V2 — 共享脚本
   导航 · 淡入动画 · 音乐播放器 · 灯箱
   ============================================================ */

// ----- 1. 滚动淡入动画 -----
(function() {
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -40px 0px', threshold: 0.1 });

  document.querySelectorAll('.fade-in').forEach(function(el) {
    observer.observe(el);
  });
})();

// ----- 2. 音乐播放器 (Web Audio API 八音盒/轻音乐) -----
(function() {
  var toggle = document.getElementById('musicToggle');
  if (!toggle) return;

  var ctx = null, playing = false, master = null, nodes = [];

  // 八音盒音色：三角波+正弦波叠加，快速衰减
  function bell(time, freq, dur, amp, dest) {
    if (freq <= 0) return;
    // 三角波（明亮主音）
    var o1 = ctx.createOscillator(), g1 = ctx.createGain();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(freq, time);
    o1.frequency.setValueAtTime(freq * 1.003, time + 0.01); // 微颤
    g1.gain.setValueAtTime(0, time);
    g1.gain.linearRampToValueAtTime(amp, time + 0.003);
    g1.gain.exponentialRampToValueAtTime(amp * 0.2, time + dur * 0.15);
    g1.gain.exponentialRampToValueAtTime(0.0005, time + dur);
    o1.connect(g1); g1.connect(dest);
    o1.start(time); o1.stop(time + dur + 0.1);
    nodes.push(o1, g1);

    // 正弦泛音（柔和余韵）
    var o2 = ctx.createOscillator(), g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 2.002, time);
    g2.gain.setValueAtTime(0, time);
    g2.gain.linearRampToValueAtTime(amp * 0.4, time + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.0005, time + dur * 0.6);
    o2.connect(g2); g2.connect(dest);
    o2.start(time); o2.stop(time + dur * 0.6 + 0.1);
    nodes.push(o2, g2);

    // 低八度温暖底音
    var o3 = ctx.createOscillator(), g3 = ctx.createGain();
    o3.type = 'sine';
    o3.frequency.setValueAtTime(freq * 0.5, time);
    g3.gain.setValueAtTime(0, time);
    g3.gain.linearRampToValueAtTime(amp * 0.25, time + 0.01);
    g3.gain.exponentialRampToValueAtTime(0.0005, time + dur * 0.9);
    o3.connect(g3); g3.connect(dest);
    o3.start(time); o3.stop(time + dur * 0.9 + 0.1);
    nodes.push(o3, g3);
  }

  // 简单的混响模拟 — 延迟衰减副本
  function reverbNote(time, freq, dur, amp, dest, delay) {
    bell(time + delay, freq * 0.999, dur * 0.5, amp * 0.15, dest);
    bell(time + delay * 1.8, freq * 1.001, dur * 0.3, amp * 0.08, dest);
  }

  function schedulePiece() {
    if (!playing || !ctx) return;
    nodes = [];
    var t = ctx.currentTime + 0.05;
    // 60 bpm, 每拍1秒, 每小节4拍
    var b = 1.0;
    var m = b * 4;

    // ===== 美丽的和弦进行 =====
    // Cadd9 - G/B - Am7 - Em7 - Fmaj7 - C/E - Dm7 - G7
    var prog = [];

    function chord(start, bass, notes, vel) {
      prog.push({ t: start, b: bass, n: notes, v: vel });
    }

    // 十六小节，每小节4拍
    chord(0*m, 130.81, [261.63,329.63,392.00,523.25], 0.22);              // Cadd9
    chord(1*m, 196.00, [246.94,329.63,392.00,493.88], 0.20);              // G/B
    chord(2*m, 220.00, [261.63,329.63,440.00,523.25], 0.22);              // Am7
    chord(3*m, 164.81, [246.94,329.63,392.00,493.88], 0.20);              // Em7
    chord(4*m, 174.61, [261.63,329.63,440.00,523.25], 0.22);              // Fmaj7
    chord(5*m, 164.81, [261.63,329.63,392.00,523.25], 0.20);              // C/E
    chord(6*m, 146.83, [261.63,349.23,440.00,523.25], 0.20);              // Dm7
    chord(7*m, 196.00, [246.94,329.63,392.00,493.88], 0.22);              // G7

    chord(8*m, 130.81, [261.63,329.63,392.00,523.25], 0.24);              // Cadd9 (变亮)

    chord(9*m, 196.00, [246.94,329.63,392.00,493.88], 0.20);
    chord(10*m,220.00, [261.63,329.63,440.00,523.25], 0.22);

    chord(11*m,164.81, [246.94,329.63,392.00,493.88], 0.18);
    chord(12*m,174.61, [261.63,329.63,440.00,523.25], 0.22);

    chord(13*m,164.81, [261.63,329.63,392.00,523.25], 0.20);
    chord(14*m,146.83, [220.00,293.66,349.23,440.00], 0.18);
    chord(15*m,196.00, [246.94,329.63,392.00,493.88], 0.20);

    // ===== 演奏和弦 + 琶音 + 旋律 =====
    prog.forEach(function(c) {
      var start = t + c.t;
      // 低音根音
      bell(start, c.b, m * 1.5, c.v * 0.8, master);
      reverbNote(start, c.b, m * 1.5, c.v * 0.8, master, 0.06);

      // 琶音：上行 1-3-5-8-5-3
      var arp = [c.n[0], c.n[1], c.n[2], c.n[3], c.n[2], c.n[1]];
      var arpLen = m / arp.length;
      arp.forEach(function(f, i) {
        var delay = i * arpLen;
        bell(start + delay, f, arpLen * 1.4, c.v * 0.65, master);
        reverbNote(start + delay, f, arpLen * 1.4, c.v * 0.65, master, arpLen * 0.3);
      });
    });

    // ===== 旋律线 (高音八音盒风格) =====
    var melody = [
      // 小节1-2: Cadd9 - G/B
      [t+0.0, 783.99, 1.5, 0.42],   // G5
      [t+1.5, 880.00, 0.8, 0.30],   // A5
      [t+2.3, 783.99, 0.7, 0.30],
      [t+3.0, 659.25, 1.0, 0.38],   // E5
      [t+4.0, 587.33, 1.5, 0.38],   // D5
      [t+5.5, 659.25, 0.5, 0.25],
      // 小节3-4: Am7 - Em7
      [t+6.0, 783.99, 1.0, 0.40],
      [t+7.0, 880.00, 2.0, 0.42],   // A5 长音
      [t+9.0, 783.99, 0.8, 0.32],
      [t+9.8, 659.25, 1.2, 0.35],
      [t+11.0,587.33, 1.0, 0.32],
      // 小节5-6: Fmaj7 - C/E
      [t+12.0,659.25, 1.0, 0.38],
      [t+13.0,783.99, 0.5, 0.30],
      [t+13.5,880.00, 0.5, 0.30],
      [t+14.0,1046.5,1.5, 0.40],    // C6 高音
      [t+15.5,880.00, 0.5, 0.30],
      // 小节7-8: Dm7 - G7
      [t+16.0,783.99, 1.5, 0.38],
      [t+17.5,659.25, 2.5, 0.40],   // E5 长音结束
      // 小节9-10: Cadd9 (重复变奏)
      [t+20.0,1046.5,0.5, 0.35],
      [t+20.5,880.00, 0.5, 0.28],
      [t+21.0,783.99, 1.0, 0.40],
      [t+22.0,659.25, 1.5, 0.35],
      [t+23.5,587.33, 0.5, 0.25],
      // 小节11-12: G/B - Am7
      [t+24.0,783.99, 1.0, 0.36],
      [t+25.0,880.00, 1.0, 0.32],
      [t+26.0,783.99, 1.5, 0.38],
      [t+27.5,880.00, 2.5, 0.40],   // 高音长音
      // 小节13-14: Em7 - Fmaj7
      [t+30.0,783.99, 1.0, 0.34],
      [t+31.0,659.25, 1.0, 0.32],
      [t+32.0,587.33, 1.0, 0.30],
      [t+33.0,523.25, 0.8, 0.28],
      [t+33.8,659.25, 0.7, 0.28],
      [t+34.5,783.99, 1.5, 0.40],
      [t+36.0,659.25, 2.0, 0.42],
      // 小节15-16: C/E - Dm7 - G7
      [t+38.0,587.33, 0.5, 0.28],
      [t+38.5,659.25, 0.5, 0.30],
      [t+39.0,783.99, 0.5, 0.32],
      [t+39.5,880.00, 0.5, 0.34],
      [t+40.0,783.99, 0.8, 0.30],
      [t+40.8,659.25, 4.2, 0.42],   // 结尾长音 E5
    ];

    melody.forEach(function(n) {
      bell(n[0], n[1], n[2] * 0.9, n[3], master);
      // 旋律添加混响
      if (n[2] > 0.8) {
        reverbNote(n[0], n[1], n[2] * 0.9, n[3], master, 0.08);
      }
    });

    // 循环调度 (约68秒)
    var total = t + 64;
    setTimeout(schedulePiece, (total - ctx.currentTime) * 1000 - 300);
  }

  function start() {
    if (playing) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.setValueAtTime(0.3, ctx.currentTime);
      master.connect(ctx.destination);
      playing = true;
      toggle.classList.add('playing');
      schedulePiece();
    } catch(e) { playing = false; }
  }

  function stop() {
    playing = false;
    nodes.forEach(function(n) { try { n.stop(0); } catch(e) {} });
    nodes = [];
    if (ctx) { ctx.close().catch(function(){}); ctx = null; }
    master = null;
    toggle.classList.remove('playing');
  }

  toggle.addEventListener('click', function() {
    playing ? stop() : start();
  });

  document.addEventListener('click', function once() {
    if (!playing) start();
  }, { once: true });
})();

// ----- 3. 灯箱 (相册页面使用) -----
(function() {
  var lightbox  = document.getElementById('lightbox');
  if (!lightbox) return;
  var img       = document.getElementById('lightboxImg');
  var captionEl = document.getElementById('lightboxCaption');
  var closeBtn  = lightbox.querySelector('.lightbox-close');
  var prevBtn   = lightbox.querySelector('.lightbox-prev');
  var nextBtn   = lightbox.querySelector('.lightbox-next');
  var items     = [];
  var index     = 0;

  function collect() {
    items = Array.from(document.querySelectorAll('.masonry-item'));
  }

  function open(i) {
    index = i;
    var caption = items[index].querySelector('.masonry-caption');
    img.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">' +
      '<rect width="600" height="400" fill="#FDE8EF"/>' +
      '<circle cx="300" cy="140" r="60" fill="none" stroke="#E8A0B8" stroke-width="2" stroke-dasharray="8 4"/>' +
      '<text x="300" y="155" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#E8A0B8">&#128247;</text>' +
      '<text x="300" y="280" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#5D4E4E">放入真实照片后自动展示</text>' +
      '</svg>'
    );
    captionEl.textContent = caption ? caption.textContent : '';
    lightbox.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    img.src = '';
  }

  function prev() { open((index - 1 + items.length) % items.length); }
  function next() { open((index + 1) % items.length); }

  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);

  lightbox.addEventListener('click', function(e) {
    if (e.target === lightbox) close();
  });

  document.addEventListener('keydown', function(e) {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  });

  document.addEventListener('click', function(e) {
    var target = e.target.closest('.masonry-item');
    if (!target) return;
    collect();
    var idx = items.indexOf(target);
    if (idx >= 0) open(idx);
  });
})();
