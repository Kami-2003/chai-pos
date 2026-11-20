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

  function burst(x, y, n, spread = 1, palette = COLORS, cups = true) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * spread;
      const v = 7 + Math.random() * 9;
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        c: palette[(Math.random() * palette.length) | 0],
        life: 0, max: 70 + Math.random() * 50,
        cup: cups && Math.random() < 0.08,  // たまに ☕ が飛ぶ
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

  // ---------- 激レア演出 ----------
  const GOLD = ['#ffd54a', '#ffb300', '#fff3b0', '#ffffff', '#f6a623'];

  function banner(text, cls) {
    const b = document.createElement('div');
    b.className = 'rare-banner ' + cls;
    b.textContent = text;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 3200);
  }

  // パカラッパカラッ（ノイズを短く鳴らす）
  function gallopSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const len = audio.sampleRate * 0.04;
      const buf = audio.createBuffer(1, len, audio.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const t = audio.currentTime;
      for (let k = 0; k < 8; k++) {
        [0, 0.09, 0.15].forEach((off, j) => {
          const s = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
          s.buffer = buf; f.type = 'bandpass'; f.frequency.value = j === 1 ? 900 : 650; f.Q.value = 1.5;
          g.gain.value = 0.5;
          s.connect(f).connect(g).connect(audio.destination);
          s.start(t + k * 0.27 + off);
        });
      }
    } catch { }
  }

  // ゴーン…＋きらきら
  function blessSound() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t = audio.currentTime;
      [196, 392, 588, 784].forEach((f, i) => tone(t, f, 2.2 - i * 0.3, 0.12 / (i + 1)));
      [1568, 2093, 2637, 3136, 2637, 3136].forEach((f, i) => tone(t + 0.4 + i * 0.07, f, 0.4, 0.06));
    } catch { }
  }

  function horse(sound) {
    const h = document.createElement('div');
    h.className = 'rare-horse';
    // 🐎 は主要な端末で左向きなので、右から左へ走らせる
    h.innerHTML = '<span class="rh-body">🐎</span>';
    document.body.appendChild(h);
    banner('🐎 激レア！ 馬が駆け抜けた！', 'horse');
    if (sound) gallopSound();
    // 砂ぼこり
    const dust = setInterval(() => {
      const r = h.getBoundingClientRect();
      const p = document.createElement('span');
      p.className = 'rh-dust'; p.textContent = '💨';
      p.style.left = (r.right - 30) + 'px'; p.style.top = (r.bottom - 50) + 'px';
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }, 90);
    setTimeout(() => { clearInterval(dust); h.remove(); }, 2300);
  }

  // ピンク色・4本腕・蓮の上に座るガネーシャ
  const GANESHA_SVG = `
<svg viewBox="0 0 240 270" width="230" height="259" xmlns="http://www.w3.org/2000/svg" aria-label="ガネーシャ">
  <g stroke="#c9578a" stroke-width="2" stroke-linejoin="round">
    <!-- 蓮の台座 -->
    <g fill="#ff9cc4">
      <ellipse cx="70" cy="238" rx="30" ry="13" transform="rotate(-18 70 238)"/>
      <ellipse cx="170" cy="238" rx="30" ry="13" transform="rotate(18 170 238)"/>
      <ellipse cx="95" cy="246" rx="28" ry="13"/>
      <ellipse cx="145" cy="246" rx="28" ry="13"/>
    </g>
    <g fill="#ffd1e4">
      <ellipse cx="120" cy="250" rx="30" ry="13"/>
      <ellipse cx="82" cy="230" rx="22" ry="10" transform="rotate(-10 82 230)"/>
      <ellipse cx="158" cy="230" rx="22" ry="10" transform="rotate(10 158 230)"/>
    </g>

    <!-- 上の2本の腕（体の後ろ） -->
    <g fill="none" stroke-linecap="round">
      <path d="M94 142 Q50 156 28 124" stroke="#c9578a" stroke-width="17"/>
      <path d="M94 142 Q50 156 28 124" stroke="#f7a8c8" stroke-width="13"/>
      <path d="M146 142 Q190 156 212 124" stroke="#c9578a" stroke-width="17"/>
      <path d="M146 142 Q190 156 212 124" stroke="#f7a8c8" stroke-width="13"/>
    </g>
    <!-- 左上の手：蓮の花 -->
    <circle cx="26" cy="118" r="9" fill="#f7a8c8"/>
    <rect x="20" y="126" width="12" height="4" rx="2" fill="#f5c518" stroke="#c98a00"/>
    <g fill="#ff7fb0" stroke="#d9487f">
      <ellipse cx="26" cy="98" rx="5" ry="11"/>
      <ellipse cx="17" cy="102" rx="5" ry="10" transform="rotate(-35 17 102)"/>
      <ellipse cx="35" cy="102" rx="5" ry="10" transform="rotate(35 35 102)"/>
    </g>
    <!-- 右上の手：モーダカ（甘いお菓子） -->
    <circle cx="214" cy="118" r="9" fill="#f7a8c8"/>
    <rect x="208" y="126" width="12" height="4" rx="2" fill="#f5c518" stroke="#c98a00"/>
    <path d="M214 90 C206 100 204 108 214 110 C224 108 222 100 214 90 Z" fill="#ffe08a" stroke="#c98a00"/>

    <!-- 胴体とおなか -->
    <ellipse cx="120" cy="168" rx="42" ry="38" fill="#f7a8c8"/>
    <ellipse cx="120" cy="176" rx="26" ry="22" fill="#ffc4dc" stroke="none"/>
    <circle cx="120" cy="180" r="2.5" fill="#c9578a" stroke="none"/>

    <!-- 腰布（ドーティー）と脚 -->
    <path d="M62 206 Q120 186 178 206 Q186 222 160 226 Q120 232 80 226 Q54 222 62 206 Z" fill="#ffb300" stroke="#d27a00"/>
    <path d="M70 212 Q120 200 170 212" fill="none" stroke="#d9480f" stroke-width="3"/>
    <ellipse cx="88" cy="224" rx="14" ry="7" fill="#f7a8c8"/>
    <ellipse cx="152" cy="224" rx="14" ry="7" fill="#f7a8c8"/>

    <!-- 首飾り -->
    <path d="M90 140 Q120 166 150 140" fill="none" stroke="#c98a00" stroke-width="6"/>
    <path d="M90 140 Q120 166 150 140" fill="none" stroke="#f5c518" stroke-width="3"/>
    <circle cx="120" cy="155" r="5" fill="#e63946" stroke="#c98a00"/>

    <!-- 下の2本の腕（体の前） -->
    <g fill="none" stroke-linecap="round">
      <path d="M88 160 Q72 172 62 162" stroke="#c9578a" stroke-width="17"/>
      <path d="M88 160 Q72 172 62 162" stroke="#f7a8c8" stroke-width="13"/>
      <path d="M152 160 Q170 178 180 184" stroke="#c9578a" stroke-width="17"/>
      <path d="M152 160 Q170 178 180 184" stroke="#f7a8c8" stroke-width="13"/>
    </g>
    <!-- 左下の手：祝福のてのひら -->
    <rect x="50" y="136" width="18" height="26" rx="9" fill="#f7a8c8"/>
    <circle cx="59" cy="150" r="3" fill="#e63946" stroke="none"/>
    <rect x="52" y="160" width="14" height="4" rx="2" fill="#f5c518" stroke="#c98a00"/>
    <!-- 右下の手：ラドゥー（お菓子）の器 -->
    <circle cx="186" cy="186" r="9" fill="#f7a8c8"/>
    <path d="M168 192 Q186 212 204 192 Z" fill="#f5c518" stroke="#c98a00"/>
    <g fill="#ff9f1c" stroke="#d27a00">
      <circle cx="178" cy="188" r="6"/><circle cx="190" cy="187" r="6"/><circle cx="184" cy="180" r="6"/>
    </g>

    <!-- 耳 -->
    <path d="M94 76 C60 56 40 92 56 116 C66 130 86 124 96 110 Z" fill="#f28db5"/>
    <path d="M90 82 C66 70 54 96 64 112 C72 120 84 116 90 106 Z" fill="#ffc4dc" stroke="none"/>
    <path d="M146 76 C180 56 200 92 184 116 C174 130 154 124 144 110 Z" fill="#f28db5"/>
    <path d="M150 82 C174 70 186 96 176 112 C168 120 156 116 150 106 Z" fill="#ffc4dc" stroke="none"/>

    <!-- 頭 -->
    <ellipse cx="120" cy="92" rx="30" ry="30" fill="#f7a8c8"/>
    <!-- 牙（片方は折れている） -->
    <path d="M106 110 Q98 120 102 128 Q106 120 112 114 Z" fill="#fffaf0" stroke="#c9b48a"/>
    <path d="M134 110 Q138 114 137 118 L132 116 Z" fill="#fffaf0" stroke="#c9b48a"/>
    <!-- 鼻（向かって右へ巻く） -->
    <path d="M120 100 C116 124 118 142 134 148 C146 152 152 140 144 132" fill="none" stroke="#c9578a" stroke-width="17" stroke-linecap="round"/>
    <path d="M120 100 C116 124 118 142 134 148 C146 152 152 140 144 132" fill="none" stroke="#f7a8c8" stroke-width="13" stroke-linecap="round"/>
    <path d="M118 112 h6 M118 122 h6 M120 132 h6" stroke="#e58ab0" stroke-width="2" fill="none"/>
    <!-- 目 -->
    <ellipse cx="106" cy="90" rx="4" ry="5" fill="#3a1d2b" stroke="none"/>
    <ellipse cx="134" cy="90" rx="4" ry="5" fill="#3a1d2b" stroke="none"/>
    <circle cx="107.5" cy="88" r="1.5" fill="#fff" stroke="none"/>
    <circle cx="135.5" cy="88" r="1.5" fill="#fff" stroke="none"/>
    <path d="M100 82 q6 -4 12 0 M128 82 q6 -4 12 0" stroke="#3a1d2b" stroke-width="2" fill="none"/>
    <!-- 額の印（ティラカ） -->
    <path d="M110 70 q10 6 20 0" stroke="#ffffff" stroke-width="3" fill="none"/>
    <ellipse cx="120" cy="74" rx="3" ry="6" fill="#e63946" stroke="none"/>

    <!-- 冠 -->
    <path d="M94 66 L98 34 L108 46 L120 10 L132 46 L142 34 L146 66 Q120 58 94 66 Z" fill="#f5c518" stroke="#c98a00"/>
    <path d="M94 66 Q120 58 146 66 L146 72 Q120 64 94 72 Z" fill="#e0a800" stroke="#c98a00"/>
    <circle cx="120" cy="46" r="6" fill="#e63946" stroke="#c98a00"/>
    <circle cx="104" cy="56" r="3" fill="#2a9d8f" stroke="none"/>
    <circle cx="136" cy="56" r="3" fill="#2a9d8f" stroke="none"/>
    <circle cx="120" cy="10" r="4" fill="#fff3b0" stroke="#c98a00"/>
  </g>
</svg>`;

  function ganesha(sound) {
    const g = document.createElement('div');
    g.className = 'rare-ganesha';
    g.innerHTML = `<div class="rg-halo"></div><div class="rg-body">${GANESHA_SVG}</div>`;
    document.body.appendChild(g);
    if (sound) blessSound();
    setTimeout(() => {
      banner('🙏 ガネーシャ降臨！ 商売繁盛！', 'ganesha');
      if (!reduceMotion()) burst(innerWidth / 2, innerHeight * 0.3, 140, 2, GOLD, false);
    }, 700);
    setTimeout(() => g.remove(), 3300);
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

    // 5% で馬、別の 5% でガネーシャ（同時には出ない）
    const roll = Math.random();
    if (roll < 0.05) setTimeout(() => horse(o.sound), 250);
    else if (roll < 0.10) setTimeout(() => ganesha(o.sound), 250);
  }

  // horse / ganesha はコンソールから FX.horse() のように試せる
  return { celebrate, horse: () => horse(true), ganesha: () => ganesha(true) };
})();
