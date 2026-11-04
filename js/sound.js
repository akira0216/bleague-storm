// 試合の音（音声ファイルは使わず、ブラウザの中で音を作る）
// BGM（ゲーム風のループ）、観客のざわめき・歓声・ため息、ドリブル、ネット、リング、笛、ブザー、ディフェンスコールの太鼓
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let crowd = null;
  let on = true;
  let bgmBus = null;
  let bgmOn = true;
  let bgm = null;

  // さいしょにボタンを押したときに呼ぶ（スマホは操作のあとでないと音が出ない）
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = on ? 0.9 : 0;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      bgmBus = ctx.createGain();
      bgmBus.gain.value = bgmOn ? 0.32 : 0;
      bgmBus.connect(comp);
      // 2秒分のホワイトノイズ（いろいろな音のもと）
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setBgmOn(v) {
    bgmOn = v;
    if (bgmBus) bgmBus.gain.setTargetAtTime(v ? 0.32 : 0, ctx.currentTime, 0.1);
  }

  function setOn(v) {
    on = v;
    if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05);
  }

  function noiseSrc(loop = false) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = loop;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  function filt(type, freq, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  // 音量の山（アタック→ディケイ）
  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  const ready = () => ctx && ctx.state === 'running';

  // ---------- 観客 ----------
  function startCrowd() {
    if (!ctx || crowd) return;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);
    // ざわめき：いくつかの帯域のノイズの音量をゆらす
    const bands = [[350, 0.8, 0.05], [800, 1.0, 0.04], [1700, 1.2, 0.022]].map(([f, q, v]) => {
      const s = noiseSrc(true);
      const bp = filt('bandpass', f, q);
      const g = ctx.createGain();
      g.gain.value = v;
      s.connect(bp).connect(g).connect(out);
      s.start();
      return { g, v };
    });
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    const timer = setInterval(() => {
      const t = ctx.currentTime;
      bands.forEach(b => b.g.gain.setTargetAtTime(b.v * (0.6 + Math.random() * 0.8), t, 0.25));
    }, 350);
    crowd = { out, timer, drum: null };
  }

  function stopCrowd() {
    if (!crowd) return;
    clearInterval(crowd.timer);
    clearInterval(crowd.drum);
    const out = crowd.out;
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => out.disconnect(), 1500);
    crowd = null;
  }

  // 歓声「わぁーっ」（強さ 0〜1）。「う」→「あ」と口が開くように、ひびきを動かす
  function cheer(power = 0.6) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const len = 1.6 + power * 1.8;
    const out = ctx.createGain();
    env(out, t, 1, 0.22, len);
    out.connect(master);
    // 母音のひびき（F1 は「う」300Hz →「あ」800Hz に上がる）
    const f1 = filt('bandpass', 300, 4);
    f1.frequency.setValueAtTime(320, t);
    f1.frequency.linearRampToValueAtTime(820, t + 0.22);
    f1.frequency.linearRampToValueAtTime(720, t + len);
    const f2 = filt('bandpass', 900, 5);
    f2.frequency.setValueAtTime(800, t);
    f2.frequency.linearRampToValueAtTime(1250, t + 0.22);
    const f3 = filt('bandpass', 2600, 6);
    const g1 = ctx.createGain(); g1.gain.value = 1;
    const g2 = ctx.createGain(); g2.gain.value = 0.7;
    const g3 = ctx.createGain(); g3.gain.value = 0.35;
    const voice = ctx.createGain();
    voice.gain.value = 1;
    voice.connect(f1).connect(g1).connect(out);
    voice.connect(f2).connect(g2).connect(out);
    voice.connect(f3).connect(g3).connect(out);
    // たくさんの人の声（ゆれる音程）
    const n = Math.round(10 + power * 18);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = (Math.random() < 0.5 ? 130 : 240) * (0.8 + Math.random() * 0.6);
      const dt = Math.random() * 0.18;
      o.frequency.setValueAtTime(f0 * 0.9, t + dt);
      o.frequency.linearRampToValueAtTime(f0 * (1.1 + Math.random() * 0.15), t + dt + 0.3);
      o.frequency.linearRampToValueAtTime(f0 * (0.95 + Math.random() * 0.1), t + dt + len);
      const vib = ctx.createOscillator();
      vib.frequency.value = 4 + Math.random() * 3;
      const vg = ctx.createGain();
      vg.gain.value = f0 * 0.03;
      vib.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = 0.05 * power / Math.sqrt(n / 10);
      o.connect(g).connect(voice);
      o.start(t + dt); vib.start(t + dt);
      o.stop(t + len + 0.5); vib.stop(t + len + 0.5);
    }
    // ざわざわした息の音
    const s = noiseSrc();
    const sg = ctx.createGain();
    sg.gain.value = 0.9 * power;
    s.connect(sg).connect(voice);
    s.start(t);
    s.stop(t + len + 0.5);
    // 手拍子のパラパラ
    for (let i = 0; i < 8 + power * 14; i++) setTimeout(() => clap(0.05 + Math.random() * 0.06 * power), 150 + Math.random() * len * 700);
  }

  // ため息「あ〜」
  function groan(power = 0.5) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const s = noiseSrc();
    const lp = filt('lowpass', 700, 0.7);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.linearRampToValueAtTime(350, t + 1.2);
    const g = ctx.createGain();
    env(g, t, 0.4 * power, 0.1, 1.2);
    s.connect(lp).connect(g).connect(master);
    s.start(t);
    s.stop(t + 1.6);
  }

  // ディフェンスコールの太鼓（相手がせめているあいだ鳴らす）
  function drum(active) {
    if (!crowd) return;
    if (active && !crowd.drum) {
      let beat = 0;
      crowd.drum = setInterval(() => {
        // 「ドン・ドン・（休み）」＋手拍子
        const k = beat++ % 4;
        if (k < 2) thump(0.35);
        if (k === 1 || k === 3) clap(0.12);
      }, 300);
    } else if (!active && crowd.drum) {
      clearInterval(crowd.drum);
      crowd.drum = null;
    }
  }

  function thump(v = 0.4) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = ctx.createGain();
    env(g, t, v, 0.005, 0.22);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.3);
  }

  function clap(v = 0.15) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const s = noiseSrc();
    const bp = filt('bandpass', 1400, 1.2);
    const g = ctx.createGain();
    env(g, t, v, 0.003, 0.12);
    s.connect(bp).connect(g).connect(master);
    s.start(t);
    s.stop(t + 0.2);
  }

  // ---------- コートの音 ----------
  // ドリブル（遠いほど小さく）
  function dribble(v = 1) {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.07);
    const g = ctx.createGain();
    env(g, t, 0.5 * v, 0.002, 0.09);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.12);
    const s = noiseSrc();
    const bp = filt('bandpass', 2500, 1.5);
    const g2 = ctx.createGain();
    env(g2, t, 0.08 * v, 0.001, 0.03);
    s.connect(bp).connect(g2).connect(master);
    s.start(t);
    s.stop(t + 0.06);
  }

  // シュートが決まったときの「シュパッ」：ボールがネットをこする音。音程が出ないように、はばの広いノイズだけで作る
  function swish() {
    if (!ready()) return;
    const t = ctx.currentTime;
    // ネットに当たった瞬間の「チッ」
    const c = noiseSrc();
    const cg = ctx.createGain();
    env(cg, t, 0.25, 0.001, 0.012);
    const chp = filt('highpass', 1500, 0.5);
    c.connect(chp).connect(cg).connect(master);
    c.start(t); c.stop(t + 0.05);
    // ネットをこする「シュッ」：中〜高い音がさっと出て、すぐ消える
    const s = noiseSrc();
    const hp = filt('highpass', 650, 0.5);
    const lp = filt('lowpass', 7000, 0.5);
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    s.connect(hp).connect(lp).connect(g).connect(master);
    s.start(t); s.stop(t + 0.3);
    // ボールがネットを押し下げる、こもった「ファッ」
    const f = noiseSrc();
    const flp = filt('lowpass', 700, 0.5);
    const fg = ctx.createGain();
    env(fg, t + 0.015, 0.22, 0.01, 0.12);
    f.connect(flp).connect(fg).connect(master);
    f.start(t + 0.015); f.stop(t + 0.2);
    // ネットがゆれてもどる、うすい「シャッ」
    const r = noiseSrc();
    const rbp = filt('bandpass', 2400, 0.5);
    const rg = ctx.createGain();
    env(rg, t + 0.12, 0.06, 0.03, 0.28);
    r.connect(rbp).connect(rg).connect(master);
    r.start(t + 0.12); r.stop(t + 0.5);
  }

  // リングの「ガン」（ダンクは強く）
  function rim(v = 0.5) {
    if (!ready()) return;
    const t = ctx.currentTime;
    [523, 787, 1210].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'square';
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain();
      env(g, t, 0.12 * v / (i + 1), 0.002, 0.35 + v * 0.4);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1);
    });
    thump(0.25 * v);
  }

  // 笛
  function whistle() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 2900;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const lg = ctx.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
    g.gain.setValueAtTime(0.13, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(master);
    o.start(t); lfo.start(t);
    o.stop(t + 0.55); lfo.stop(t + 0.55);
  }

  // ブザー（クォーター終了・24秒）
  function buzzer(len = 1.0) {
    if (!ready()) return;
    const t = ctx.currentTime;
    [220, 223, 330].forEach(f => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = filt('lowpass', 1600, 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
      g.gain.setValueAtTime(0.07, t + len - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(lp).connect(g).connect(master);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  }

  // バッシュのキュッ
  function squeak() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(1900 + Math.random() * 600, t);
    o.frequency.linearRampToValueAtTime(2600 + Math.random() * 600, t + 0.07);
    const g = ctx.createGain();
    env(g, t, 0.035, 0.005, 0.07);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }

  // ---------- BGM（アリーナ風のループ。128BPM・4小節） ----------
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am - F - C - G
  const BASS = [45, 41, 48, 43];

  function tone(type, freq, t, len, vol, cutoff, out = bgmBus) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = filt('lowpass', cutoff, 1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  function hit(t, kind) {
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g).connect(bgmBus);
      o.start(t); o.stop(t + 0.35);
      return;
    }
    const s = noiseSrc();
    const f = kind === 'snare' ? filt('bandpass', 1900, 0.8) : filt('highpass', 7500, 0.7);
    const g = ctx.createGain();
    const v = kind === 'snare' ? 0.55 : kind === 'open' ? 0.16 : 0.12;
    const len = kind === 'snare' ? 0.16 : kind === 'open' ? 0.18 : 0.035;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(bgmBus);
    s.start(t); s.stop(t + len + 0.02);
    if (kind === 'snare') tone('triangle', 190, t, 0.08, 0.25, 2000);
  }

  // 16分音符ひとつ分を鳴らす
  function step(t, i) {
    const bar = Math.floor(i / 16) % 4, k = i % 16;
    const sx = 60 / 128 / 4;
    // ドラム
    if (k === 0 || k === 8 || (k === 10 && bar % 2 === 1) || (k === 14 && bar === 3)) hit(t, 'kick');
    if (k === 4 || k === 12) hit(t, 'snare');
    if (bar === 3 && k >= 13) hit(t, 'snare');
    if (k % 2 === 0) hit(t, k % 4 === 2 ? 'open' : 'hat');
    // ベース
    const root = BASS[bar];
    const bassPat = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 0, 14: 7 };
    if (k in bassPat) tone('sawtooth', midi(root - 12 + bassPat[k]), t, sx * 2.2, 0.28, 520);
    // コードのきざみ
    if (k === 0 || k === 6 || k === 10) CHORDS[bar].forEach(n => tone('square', midi(n), t, sx * 1.6, 0.045, 1800));
    // メロディ（アルペジオ）は2小節目と4小節目
    if (bar % 2 === 1 && k % 2 === 0) {
      const c = CHORDS[bar];
      tone('square', midi(c[(k / 2) % 3] + 12), t, sx * 1.2, 0.04, 3200);
    }
  }

  function startBgm() {
    if (!ctx || bgm) return;
    const sx = 60 / 128 / 4;
    bgm = { next: ctx.currentTime + 0.1, i: 0 };
    bgm.timer = setInterval(() => {
      while (bgm && bgm.next < ctx.currentTime + 0.15) {
        step(bgm.next, bgm.i++);
        bgm.next += sx;
      }
    }, 30);
  }

  function stopBgm() {
    if (!bgm) return;
    clearInterval(bgm.timer);
    bgm = null;
  }

  return {
    unlock, setOn, setBgmOn, startBgm, stopBgm, startCrowd, stopCrowd, cheer, groan, drum, dribble, swish, rim, whistle, buzzer, squeak,
    get on() { return on; },
    get state() { return ctx ? ctx.state : "none"; },
  };
})();
