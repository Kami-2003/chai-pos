'use strict';

/* =========================================================
 * 「記録する」を押したときの演出
 * 紙吹雪・ポップアップ・効果音・バイブ。画面操作は止めない。
 * ========================================================= */
const FX = (() => {
  const COLORS = ['#e9a23b', '#c0703a', '#9a4a24', '#f6d27a', '#ffffff', '#7a3b1d', '#f08a5d'];
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 紙吹雪 ----------
  const canvas = document.getElementById('fx');
  const ctx = canvas.getContext('2d');
  let parts = [];
  let running = false;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener('resize', resize); resize();

  function burst(x, y, n, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
      const v = 7 + Math.random() * 9;
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0, max: 70 + Math.random() * 50,
        cup: Math.random() < 0.08,          // たまに ☕ が飛ぶ
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function rain(n) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        life: 0, max: 160 + Math.random() * 80, cup: Math.random() < 0.1,
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.life < p.max && p.y < innerHeight + 40);
    for (const p of parts) {
      p.life++; p.vy += 0.28; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      const fade = Math.min(1, (p.max - p.life) / 20);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      if (p.cup) { ctx.font = '22px serif'; ctx.fillText('☕', -11, 8); }
      else { ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6))); }
      ctx.restore();
    }
    if (parts.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  // ---------- ポップアップ ----------
  const pop = document.getElementById('pop');
  function showPop(main, sub, big) {
    pop.innerHTML = `<div class="pop-main">${main}</div>${sub ? `<div class="pop-sub">${sub}</div>` : ''}`;
    pop.className = 'pop' + (big ? ' big' : '');
    void pop.offsetWidth;                    // アニメーションを再始動
    pop.classList.add('show');
    clearTimeout(showPop._t);
    showPop._t = setTimeout(() => pop.classList.remove('show'), big ? 2600 : 1300);
  }

  // ---------- 効果音（ちゃりーん） ----------
  let audio;
  function tone(t0, freq, dur, vol) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function chime(big) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      const notes = big ? [1047, 1319, 1568, 2093, 2637] : [1319, 1976];
      notes.forEach((f, i) => tone(t + i * (big ? 0.09 : 0.08), f, big ? 0.6 : 0.35, 0.18));
    } catch { /* 音が出せない環境は無視 */ }
  }

  // ---------- 公開関数 ----------
  /**
   * @param {object} o  { cups, total, todayCups, milestone, from: HTMLElement, sound }
   */
  function celebrate(o) {
    const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
    const r = o.from ? o.from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    if (!reduceMotion()) {
      burst(cx, cy, Math.min(40 + o.cups * 15, 160), 1);
      if (o.milestone) { rain(220); setTimeout(() => burst(innerWidth / 2, innerHeight * 0.6, 120, 1.6), 250); }
    }
    if (o.milestone) showPop(`🎉 今日 ${o.milestone}杯 突破！`, `ナイス！ この調子！`, true);
    else showPop(`+${o.cups}杯！`, `今日 ${o.todayCups}杯 ／ ${yen(o.total)}`, false);

    if (o.sound) chime(!!o.milestone);
    try { navigator.vibrate && navigator.vibrate(o.milestone ? [40, 60, 40, 60, 120] : [25, 40, 25]); } catch { }

    if (o.from) { o.from.classList.remove('boom'); void o.from.offsetWidth; o.from.classList.add('boom'); }
  }

  return { celebrate };
})();
