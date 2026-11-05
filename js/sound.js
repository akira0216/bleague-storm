// 試合の音（ほとんどはブラウザの中で作る。メニューのBGMとスウィッシュは音声ファイル）
// BGM（オフェンスとディフェンスで2曲のビート）、観客のざわめき・歓声・ため息、ドリブル、ネット、リング、笛、ブザー
window.Sound = (() => {
  let ctx = null;
  let master = null;
  let noise = null;
  let crowd = null;
  let on = true;
  let bgmBus = null;
  let bgmOn = true;
  let bgm = null;
  // 自分でえらんだ曲（mode → { buf: AudioBuffer, gain }）。ctx ができる前は raw（ArrayBuffer）で待つ
  const custom = {};
  const customRaw = {};

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
      Object.keys(customRaw).forEach(m => decodeCustom(m));
    }
    if (ctx.state === 'suspended') ctx.resume();
    loadSwish();
    updateMenu();
  }

  // ---------- 自分の曲 ----------
  // data：音声ファイルの ArrayBuffer（null で、もとのプログラムの曲にもどす）。読めなかったら reject
  function setCustom(mode, data) {
    delete custom[mode];
    delete customRaw[mode];
    if (!data) return Promise.resolve(null);
    customRaw[mode] = data;
    return ctx ? decodeCustom(mode) : Promise.resolve(null);
  }

  function decodeCustom(mode) {
    const raw = customRaw[mode];
    if (!raw || !ctx) return Promise.resolve(null);
    // decodeAudioData は元のデータを使えなくするので、コピーをわたす
    return new Promise((res, rej) => {
      const pr = ctx.decodeAudioData(raw.slice(0), res, rej);
      if (pr && pr.catch) pr.catch(() => {}); // 新しいブラウザは Promise でもエラーを返すので、二重に出ないようにする
    }).then(buf => {
      if (customRaw[mode] !== raw) return null; // とちゅうで別の曲にかえられた
      delete customRaw[mode];
      // 市販の曲は大きいので、プログラムの曲と同じくらいの大きさにそろえる（平均の音の強さで）
      const d = buf.getChannelData(0);
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 64) { sum += d[i] * d[i]; n++; }
      const rms = Math.sqrt(sum / (n || 1)) || 0.1;
      custom[mode] = { buf, gain: Math.max(0.1, Math.min(2, 0.2 / rms)) };
      return buf.duration;
    });
  }

  // ---------- 試合以外の画面の BGM（audio/menu-2.mp3 をくり返し再生） ----------
  // 曲は一度まるごと読み込んでから鳴らす（保存しておけばオフラインでも鳴る）
  const MENU_URL = 'audio/menu-2.mp3';
  const MENU_VOL = 0.67; // 曲の平均の大きさに合わせて調整
  let menuWant = false; // 今いる画面で流したいか（試合中は false）
  let menu = null;      // { el, gain }
  let menuLoading = null;

  function loadMenu() {
    if (menu || menuLoading || !ctx) return;
    menuLoading = fetch(MENU_URL).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(b => {
      const el = new Audio();
      el.src = URL.createObjectURL(b);
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(bgmBus);
      menu = { el, gain };
      updateMenu();
    }).catch(() => { /* 読み込めなかったときは鳴らさない */ }).finally(() => { menuLoading = null; });
  }

  // 流すかどうかを、画面・設定・アプリが表に出ているかで決める
  function updateMenu() {
    if (!ctx) return;
    if (!menu) { if (menuWant && bgmOn) loadMenu(); return; }
    const play = menuWant && bgmOn && !document.hidden;
    const g = menu.gain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    clearTimeout(menu.stopT);
    if (play) {
      if (menu.el.paused) { const pr = menu.el.play(); if (pr && pr.catch) pr.catch(() => {}); }
      g.linearRampToValueAtTime(MENU_VOL, now + 1.2);
    } else {
      g.linearRampToValueAtTime(0, now + 0.6);
      menu.stopT = setTimeout(() => menu.el.pause(), 700); // 止めたところから、次はつづきを鳴らす
    }
  }

  function setMenu(v) { menuWant = v; updateMenu(); }
  document.addEventListener('visibilitychange', () => updateMenu());

  function setBgmOn(v) {
    bgmOn = v;
    if (bgmBus) bgmBus.gain.setTargetAtTime(v ? 0.32 : 0, ctx.currentTime, 0.1);
    updateMenu();
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

  let recording = false;
  const ready = () => recording || (ctx && ctx.state === 'running');

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
    crowd = { out, timer };
  }

  function stopCrowd() {
    if (!crowd) return;
    clearInterval(crowd.timer);
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

  // シュートが決まったときの「シュパッ」：ボールがネットの糸をこする音。
  // 本物は、糸がこすれる小さな「チッ」がたくさん集まって「ザッ」と聞こえるので、短いノイズのつぶを何十個も重ねる
  // ゴールしたときのスウィッシュ（録音した音。読み込めていないときは、プログラムで作った音）
  const SWISH_URL = 'audio/swish-1.mp3';
  const SWISH_VOL = 0.5; // プログラムで作った音より少しはっきり聞こえるくらい
  let swishBuf = null, swishLoading = false;
  function loadSwish() {
    if (swishBuf || swishLoading || !ctx) return;
    swishLoading = true;
    fetch(SWISH_URL).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(raw => new Promise((res, rej) => { const pr = ctx.decodeAudioData(raw, res, rej); if (pr && pr.catch) pr.catch(() => {}); }))
      .then(buf => { swishBuf = buf; })
      .catch(() => {})
      .finally(() => { swishLoading = false; });
  }

  function swish() {
    if (!ready()) return;
    if (swishBuf) {
      const src = ctx.createBufferSource();
      src.buffer = swishBuf;
      src.playbackRate.value = 0.96 + Math.random() * 0.08; // 毎回少しだけ変える
      const g = ctx.createGain();
      g.gain.value = SWISH_VOL;
      src.connect(g).connect(master);
      src.start();
      return;
    }
    swishSynth();
  }

  function swishSynth() {
    const t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    const hp = filt('highpass', 900, 0.6);
    const pk = filt('peaking', 4200, 0.9);
    pk.gain.value = 5;
    bus.connect(hp).connect(pk).connect(master);
    // 糸がこすれるつぶ：はじめは多く、ボールがぬけるにつれて少なく
    const len = 0.2 + Math.random() * 0.05;
    const grains = 46;
    for (let i = 0; i < grains; i++) {
      const u = Math.pow(Math.random(), 1.6);      // 前のほうに多く
      const at = t + u * len;
      const s = noiseSrc();
      s.playbackRate.value = 0.7 + Math.random() * 0.9;
      const bp = filt('bandpass', 2200 + Math.random() * 5200, 1.4 + Math.random() * 2);
      const g = ctx.createGain();
      const v = (0.16 + Math.random() * 0.12) * (1 - u * 0.75);
      const d = 0.006 + Math.random() * 0.018;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(v, at + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + d);
      s.connect(bp).connect(g).connect(bus);
      s.start(at, Math.random() * 1.5);
      s.stop(at + d + 0.01);
    }
    // つぶの下にしく、ネット全体の「シャーッ」（高いほうから少しずつ下がる）
    const s = noiseSrc();
    const bp = filt('bandpass', 6000, 0.7);
    bp.frequency.setValueAtTime(6500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.07, t + len * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.08);
    s.connect(bp).connect(g).connect(bus);
    s.start(t); s.stop(t + len + 0.1);
    // ボールがネットを押し下げる、空気の「フッ」
    const f = noiseSrc();
    const lp = filt('lowpass', 520, 0.6);
    const fg = ctx.createGain();
    env(fg, t + 0.01, 0.12, 0.015, 0.1);
    f.connect(lp).connect(fg).connect(master);
    f.start(t + 0.01); f.stop(t + 0.2);
    // ネットがはね返ってゆれる、うすい「シャラッ」
    for (let i = 0; i < 10; i++) {
      const at = t + len + 0.02 + Math.random() * 0.18;
      const r = noiseSrc();
      const rb = filt('bandpass', 3000 + Math.random() * 3000, 3);
      const rg = ctx.createGain();
      env(rg, at, 0.035 * Math.random() + 0.015, 0.002, 0.02);
      r.connect(rb).connect(rg).connect(bus);
      r.start(at, Math.random()); r.stop(at + 0.05);
    }
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

  // バッシュのキュッ（v：大きさ 0〜1、n：何回鳴らすか。2なら「キュッキュッ」）
  // 本物は、ゴムの靴底が床にくっつく・すべるをとても速くくり返して鳴る（スティックスリップ）。
  // 高い音を、ガタガタと速くゆらして作る
  function squeak(v = 1, n = 1) {
    if (!ready()) return;
    for (let j = 0; j < n; j++) chirp(ctx.currentTime + j * (0.08 + Math.random() * 0.05), v * (j ? 0.75 : 1));
  }

  function chirp(t, v) {
    const len = 0.06 + Math.random() * 0.09;
    const f0 = 1900 + Math.random() * 900;
    const f1 = f0 * (1.2 + Math.random() * 0.35);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + len * 0.55);
    o.frequency.linearRampToValueAtTime(f1 * 0.9, t + len);
    // 音の高さについていく、せまい帯域（キーンとした芯）
    const bp = filt('bandpass', f0, 7);
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + len * 0.55);
    // くっつく・すべるのガタガタ（速い音量のゆれ）
    const am = ctx.createGain();
    am.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 70 + Math.random() * 70;
    const lg = ctx.createGain();
    lg.gain.value = 0.3;
    lfo.connect(lg).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24 * v, t + 0.008);
    g.gain.setValueAtTime(0.24 * v, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(bp).connect(am).connect(g).connect(master);
    o.start(t); o.stop(t + len + 0.02);
    lfo.start(t); lfo.stop(t + len + 0.02);
    // ゴムがこすれる、ざらっとした音を少し
    const s = noiseSrc();
    const nb = filt('bandpass', 3200, 1.5);
    const ng = ctx.createGain();
    env(ng, t, 0.012 * v, 0.004, len);
    s.connect(nb).connect(ng).connect(master);
    s.start(t, Math.random()); s.stop(t + len + 0.05);
  }

  // ---------- BGM（オフェンスとディフェンスで2曲。どちらも16小節のループ） ----------
  // オフェンス：128BPM・明るくノリのよいビート（4つ打ち＋裏のハイハット＋ブラス）
  // ディフェンス：120BPM・低音がきいた、きんちょう感のあるビート（はねたキック＋16分のシンセ）
  // 曲の流れ：0〜3小節 ビートとベース → 4〜7 全部入り → 8〜11 少し落として盛り上げ → 12〜15 全部入り＋メロディ
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const SONGS = {
    off: { vol: 1.4, bpm: 128, chords: [[57, 60, 64], [57, 60, 65], [55, 60, 64], [55, 59, 62]], root: [33, 29, 36, 31] }, // Am - F - C - G
    def: { vol: 0.5, bpm: 120, chords: [[62, 65, 69], [58, 62, 65], [55, 58, 62], [57, 61, 64]], root: [38, 34, 31, 33] }, // Dm - B♭ - Gm - A
  };
  const sxOf = mode => 60 / SONGS[mode].bpm / 4; // 16分音符ひとつ分（秒）

  // 音を作るしくみ（ふつうの再生と、録音用の OfflineAudioContext の両方で使えるよう、ctx を受け取る）
  function bgmEngine(c, out, mode) {
    const song = SONGS[mode];
    const SX = sxOf(mode);
    const CHORDS = song.chords, ROOT = song.root;
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = () => { const s = c.createBufferSource(); s.buffer = nb; return s; };
    const bq = (type, f, q = 1) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const amp = v => { const g = c.createGain(); g.gain.value = v; return g; };
    // 体育館のようなひびき（短いリバーブ）
    const rv = c.createConvolver();
    const ir = c.createBuffer(2, c.sampleRate * 1.4, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
    }
    rv.buffer = ir;
    const wet = amp(0.22);
    rv.connect(wet).connect(out);
    // 808 をひずませて太くする
    const shaper = c.createWaveShaper();
    const cv = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) cv[i] = Math.tanh((i / 512 - 1) * (mode === 'def' ? 3 : 2.2));
    shaper.curve = cv;
    const sub = amp(mode === 'def' ? 0.6 : 0.5);
    shaper.connect(bq('lowpass', mode === 'def' ? 750 : 1000, 0.5)).connect(sub).connect(out);
    // パッドはキックのたびに音量が下がって「うねる」（サイドチェイン）
    const padBus = amp(1);
    const padLp = bq('lowpass', mode === 'def' ? 950 : 1700, 0.7);
    padBus.connect(padLp);
    padLp.connect(out);
    padLp.connect(rv);
    const duck = t => {
      padBus.gain.cancelScheduledValues(t);
      padBus.gain.setValueAtTime(0.2, t);
      padBus.gain.linearRampToValueAtTime(1, t + SX * 3);
    };

    function kick(t, v = 1) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(mode === 'off' ? 190 : 165, t);
      o.frequency.exponentialRampToValueAtTime(mode === 'off' ? 52 : 46, t + 0.08);
      const g = amp(0);
      g.gain.setValueAtTime(0.95 * v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (mode === 'off' ? 0.22 : 0.3));
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.32);
      // アタックの「カッ」
      const n = noise();
      const ng = amp(0);
      ng.gain.setValueAtTime(0.25 * v, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(bq('highpass', 3000)).connect(ng).connect(out);
      n.start(t); n.stop(t + 0.02);
      duck(t);
    }

    // 808 ベース（長くのびる低音。glide があれば音程をすべらせる）
    function bass808(t, note, len, glide, v = 0.9) {
      const o = c.createOscillator();
      o.type = 'sine';
      const f = midi(note);
      o.frequency.setValueAtTime(f * 2.2, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      if (glide) {
        o.frequency.setValueAtTime(f, t + len * 0.55);
        o.frequency.exponentialRampToValueAtTime(midi(glide), t + len * 0.85);
      }
      const g = amp(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.008);
      g.gain.setValueAtTime(v, t + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(shaper);
      o.start(t); o.stop(t + len + 0.02);
    }

    // はずむベース（オフェンスの裏拍。ノコギリ波を少しこもらせる）
    function pump(t, note, len) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(note);
      const f = bq('lowpass', 300, 4);
      f.frequency.setValueAtTime(1600, t);
      f.frequency.exponentialRampToValueAtTime(300, t + len);
      const g = amp(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f).connect(g).connect(out);
      o.start(t); o.stop(t + len + 0.02);
    }

    // スネア（胴の音＋ノイズ）とクラップ（3回すばやくたたく）を重ねる
    function snare(t, v = 1) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(mode === 'off' ? 260 : 220, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
      const og = amp(0);
      og.gain.setValueAtTime(0.35 * v, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(og).connect(out);
      o.start(t); o.stop(t + 0.12);
      const n = noise();
      const ng = amp(0);
      ng.gain.setValueAtTime(0.5 * v, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      n.connect(bq('bandpass', 2200, 0.6)).connect(ng);
      ng.connect(out); ng.connect(rv);
      n.start(t); n.stop(t + 0.22);
      [0, 0.011, 0.023].forEach((d, i) => {
        const cn = noise();
        const cg = amp(0);
        cg.gain.setValueAtTime(0.0001, t + d);
        cg.gain.exponentialRampToValueAtTime(0.42 * v, t + d + 0.002);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + d + (i === 2 ? 0.16 : 0.012));
        cn.connect(bq('bandpass', 1250, 1.2)).connect(cg);
        cg.connect(out); cg.connect(rv);
        cn.start(t + d, Math.random() * 0.5); cn.stop(t + d + 0.2);
      });
    }

    function hat(t, open, v = 1) {
      const n = noise();
      const g = amp(0);
      const len = open ? 0.2 : 0.03;
      g.gain.setValueAtTime((open ? 0.12 : 0.14) * v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      n.connect(bq('highpass', 7800, 0.8)).connect(g).connect(out);
      n.start(t, Math.random() * 0.5); n.stop(t + len + 0.01);
    }

    // シンセのパッド（少しずらした2つのノコギリ波）
    function pad(t, notes, len, v = 1) {
      notes.forEach(nn => [-7, 7].forEach(cents => {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(nn);
        o.detune.value = cents;
        const g = amp(0);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028 * v, t + 0.08);
        g.gain.setValueAtTime(0.028 * v, t + len - 0.1);
        g.gain.linearRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(padBus);
        o.start(t); o.stop(t + len + 0.02);
      }));
    }

    // ブラス風の短いフレーズ
    function stab(t, note, len, v = 1) {
      [0, 12].forEach((oct, i) => {
        const o = c.createOscillator();
        o.type = i ? 'square' : 'sawtooth';
        o.frequency.value = midi(note + oct);
        const f = bq('lowpass', 600, 2);
        f.frequency.setValueAtTime(600, t);
        f.frequency.exponentialRampToValueAtTime(4200, t + 0.025);
        f.frequency.exponentialRampToValueAtTime(900, t + len);
        const g = amp(0);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09 * v / (i + 1), t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(f).connect(g);
        g.connect(out); g.connect(rv);
        o.start(t); o.stop(t + len + 0.02);
      });
    }

    // 16分でくり返す短いシンセ（ディフェンスのきんちょう感）
    function pluck(t, note, v = 1) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = midi(note);
      const f = bq('lowpass', 500, 6);
      f.frequency.setValueAtTime(2600, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.09);
      const g = amp(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(f).connect(g);
      g.connect(out); g.connect(rv);
      o.start(t); o.stop(t + 0.14);
    }

    // 盛り上げの「シューッ」（だんだん高く・大きく）
    function riser(t, len) {
      const n = noise();
      n.loop = true;
      const f = bq('bandpass', 400, 2);
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(9000, t + len);
      const g = amp(0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + len);
      n.connect(f).connect(g);
      g.connect(out); g.connect(rv);
      n.start(t); n.stop(t + len);
    }

    // オフェンス：4つ打ちのキック、裏拍のオープンハイハットとベース、ブラスのかけ声フレーズ
    function stepOff(t, bar, k, ch, sec, full, brk) {
      const r = ROOT[ch], c3 = CHORDS[ch];
      if (!brk) {
        if (sec === 2 ? k === 0 : k % 4 === 0 || (sec === 0 && k === 14 && ch === 3)) kick(t, sec === 2 ? 0.7 : 1);
        if (k === 4 || k === 12) snare(t, sec === 2 ? 0.7 : 1);
        if (bar >= 1) {
          if (k % 4 === 2) hat(t, true, sec === 0 ? 0.7 : 1);
          else if (full) hat(t, false, 0.55);
        }
        // 裏拍ではずむベース（1オクターブ上）と、1拍目の太い 808
        if (k % 4 === 2) pump(t, r + 12, SX * 1.6);
        if (k === 0 && sec !== 2) bass808(t, r, SX * 3, 0, 0.7);
      }
      if (bar === 15 && k >= 8 && k % 2 === 0) snare(t, 0.35 + (k - 8) * 0.08);
      if (bar === 11 && k === 8) riser(t, SX * 8);
      if (sec >= 1 && k === 0) pad(t, c3, SX * 16, sec === 2 ? 1.3 : 1);
      // ブラス：「タッ・タッ・タ・タッ」のかけ声フレーズ（全部入りのとき）
      if (full) {
        const riff = bar % 2 === 0 ? { 0: c3[2], 3: c3[2], 6: c3[1], 8: c3[2] } : { 0: c3[0] + 12, 2: c3[2], 4: c3[1], 7: c3[2], 10: c3[0] + 12 };
        if (k in riff && (sec === 3 || bar % 2 === 1 || k < 8)) stab(t, riff[k], k === 8 || k === 10 ? SX * 3 : SX * 1.4);
      }
    }

    // ディフェンス：はねたキックと 808、16分のハイハット（ロールあり）、16分のシンセ
    function stepDef(t, bar, k, ch, sec, full, brk) {
      const r = ROOT[ch], c3 = CHORDS[ch];
      const kpat = ch % 2 ? [0, 6, 10, 13] : [0, 3, 8, 11];
      if (!brk && kpat.includes(k) && !(sec === 2 && k !== 0)) kick(t, sec === 2 ? 0.7 : 1);
      if (!brk && (k === 4 || k === 12)) snare(t, sec === 2 ? 0.7 : 1);
      if (bar === 15 && k >= 12) snare(t, 0.4 + (k - 12) * 0.15);
      if (bar === 11 && k === 8) riser(t, SX * 8);
      if (!brk && bar >= 1) {
        const roll = (ch === 1 && k >= 12) || (ch === 3 && k >= 6 && k < 8);
        if (roll) { hat(t, false, 0.8); hat(t + SX / 3, false, 0.6); hat(t + SX * 2 / 3, false, 0.7); }
        else hat(t, false, k % 4 === 0 ? 1 : k % 2 ? 0.5 : 0.75);
      }
      if (!brk) {
        if (k === 0) bass808(t, r, SX * 6, ch === 3 && bar % 4 === 3 ? r + 12 : 0);
        if (k === 8) bass808(t, r, SX * 4, 0);
        if (k === 14 && ch % 2) bass808(t, r + 3, SX * 2, 0);
      }
      if (sec >= 1 && k === 0) pad(t, c3, SX * 16, sec === 2 ? 1.4 : 0.9);
      // 16分のシンセ（和音の音をくり返す。落としたところと最後は大きめ）
      if (sec >= 1 && !brk) {
        const seq = [0, 2, 1, 2, 0, 2, 1, 0];
        pluck(t, c3[seq[k % 8]] + (k >= 8 && sec === 3 ? 12 : 0), sec === 2 ? 1.1 : 0.8);
      }
      // 低いブラスの警告音（2小節に1回）
      if (full && bar % 2 === 1 && (k === 0 || k === 3)) stab(t, c3[0] - 12, SX * 2.5, 0.8);
    }

    // 16分音符ひとつ分を鳴らす（i：曲のはじめから何番目か）
    function step(t, i) {
      const bar = Math.floor(i / 16) % 16, k = i % 16, ch = bar % 4;
      const sec = bar < 4 ? 0 : bar < 8 ? 1 : bar < 12 ? 2 : 3;
      const full = sec === 1 || sec === 3;
      const brk = bar === 11 && k >= 8; // 盛り上げの前は少し止める
      (mode === 'off' ? stepOff : stepDef)(t, bar, k, ch, sec, full, brk);
    }
    return { step, sx: SX };
  }

  // 2曲をそれぞれの音量つまみにつないでおき、いま鳴らす曲だけ先読みで鳴らす
  function track(mode) {
    let t = bgm.tracks[mode];
    if (!t) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bgmBus);
      t = bgm.tracks[mode] = { gain: g, eng: bgmEngine(ctx, g, mode), i: 0 };
    }
    return t;
  }

  function startBgm(mode = 'off') {
    if (!ctx || bgm) return;
    bgm = { tracks: {}, mode: null, next: 0 };
    setBgmMode(mode, true);
    bgm.timer = setInterval(() => {
      if (!bgm) return;
      const t = bgm.tracks[bgm.mode];
      if (t.src) { bgm.next = ctx.currentTime + 0.06; return; }
      while (bgm.next < ctx.currentTime + 0.2) {
        t.eng.step(bgm.next, t.i++);
        bgm.next += t.eng.sx;
      }
    }, 30);
  }

  // オフェンス（'off'）とディフェンス（'def'）の曲を切りかえる（前の曲は小さくしながら止める）
  function setBgmMode(mode, first) {
    if (!bgm || !SONGS[mode] || bgm.mode === mode) return;
    const now = ctx.currentTime;
    const old = bgm.mode && bgm.tracks[bgm.mode];
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 0.6);
      stopSrc(old, now + 0.7);
    }
    const t = track(mode);
    const cu = custom[mode];
    let vol = SONGS[mode].vol; // 2曲の音量をそろえる
    if (cu) {
      // 自分の曲：くり返し再生。前に止めたところのつづきから
      const src = ctx.createBufferSource();
      src.buffer = cu.buf;
      src.loop = true;
      src.connect(t.gain);
      t.pos0 = (t.pos || 0) % cu.buf.duration;
      t.at = now;
      src.start(now, t.pos0);
      t.src = src;
      vol = cu.gain;
    } else {
      // 前に止めたところの次の小節から（曲の頭にもどってばかりにならないように）
      t.i = Math.ceil(t.i / 16) * 16;
    }
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(first ? vol : 0, now);
    if (!first) t.gain.gain.linearRampToValueAtTime(vol, now + 0.35);
    bgm.mode = mode;
    bgm.next = now + 0.06;
  }

  // 自分の曲の再生を止める（どこまで鳴らしたかをおぼえておく）
  function stopSrc(t, when) {
    if (!t.src) return;
    t.pos = t.pos0 + (ctx.currentTime - t.at);
    try { t.src.stop(when); } catch (e) { /* もう止まっている */ }
    t.src = null;
  }

  function stopBgm() {
    if (!bgm) return;
    clearInterval(bgm.timer);
    const now = ctx.currentTime;
    Object.values(bgm.tracks).forEach(t => {
      stopSrc(t, now + 0.35);
      t.gain.gain.cancelScheduledValues(now);
      t.gain.gain.setValueAtTime(t.gain.gain.value, now);
      t.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      setTimeout(() => t.gain.disconnect(), 3000);
    });
    bgm = null;
  }

  // 効果音を録音する（確認用）：fn の中で鳴らした音を、sec 秒分の AudioBuffer にして返す。先に unlock() しておくこと
  function renderSfx(fn, sec = 1.5) {
    const keep = { ctx, master };
    const c = new OfflineAudioContext(1, Math.ceil(keep.ctx.sampleRate * sec), keep.ctx.sampleRate);
    ctx = c;
    master = c.createGain();
    master.connect(c.destination);
    recording = true;
    try { fn(); } finally { ctx = keep.ctx; master = keep.master; recording = false; }
    return c.startRendering();
  }

  // BGM を録音する（確認用）：sec 秒分を OfflineAudioContext で作って AudioBuffer を返す。mode は 'off' か 'def'
  function renderBgm(sec = 40, mode = 'off') {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const c = new AC(2, Math.ceil(44100 * sec), 44100);
    const out = c.createGain();
    out.gain.value = 0.55 * SONGS[mode].vol;
    const comp = c.createDynamicsCompressor();
    out.connect(comp).connect(c.destination);
    const eng = bgmEngine(c, out, mode);
    for (let i = 0, t = 0.05; t < sec - 0.3; i++, t += eng.sx) eng.step(t, i);
    return c.startRendering();
  }

  return {
    unlock, setOn, setBgmOn, setMenu, startBgm, stopBgm, setBgmMode, setCustom, renderBgm, renderSfx, startCrowd, stopCrowd, cheer, groan, dribble, swish, rim, whistle, buzzer, squeak,
    get on() { return on; },
    get state() { return ctx ? ctx.state : "none"; },
    // 確認用：メニューの BGM のようす
    get menu() { return menu ? { paused: menu.el.paused, time: menu.el.currentTime, vol: menu.gain.gain.value } : null; },
  };
})();
