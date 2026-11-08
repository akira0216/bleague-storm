// 3Dの試合（Three.js）。十字キーで選手を動かし、パス・シュート・ドライブ（レイアップ・ダンク）をえらぶ
// 座標：x がコートの長さ方向（-14〜14m）、z が幅（-7.5〜7.5m）、y が高さ。side 0（自分）は +x のリングをせめる
import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/jsm/BufferGeometryUtils.js';

// js/sound.js。通信対戦のホストは、鳴らした音をゲストにも送る（sfxTap）
let sfxTap = null;
const SFX_RELAY = new Set(['buzzer', 'cheer', 'dribble', 'groan', 'rim', 'squeak', 'swish', 'whistle']);
const SFX = window.Sound && new Proxy(window.Sound, {
  get(t, k) {
    const v = t[k];
    if (typeof v !== 'function') return v;
    return (...a) => { if (sfxTap && SFX_RELAY.has(k)) sfxTap(k, a); return v.apply(t, a); };
  },
});

const HX = 12.425;          // リングの中心（センターからの距離）
const RIM_Y = 3.05;
const BALL_R = 0.13;        // ボールが床についたときの中心の高さ
const LEN = 14, WID = 7.5;  // コートの半分の長さ・幅
const CPU_NERF = 0.2;       // CPUをどのレベルでも全体に弱くする（能力 −14%、シュート −8% など）
const VIS = 1.2;            // 見やすいように選手を大きく描く（判定は本当の身長のまま）
const POS_H = { PG: 1.84, SG: 1.92, SF: 1.98, PF: 2.04, C: 2.1 };
const DEF_BOOST = 1.3;
const SLOTS5 = ['PG', 'SG', 'SF', 'PF', 'C'];
const escH = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 疲れ：コートにいると減り、ベンチで休むと回復する（100 が元気）。1クォーターでふつうに動いて −30 くらい
const TIRE_DRAIN = 0.8, TIRE_REST = 1.0;
const BOX0 = () => ({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0 });      // 自分のチームが守るときの スティール・パスカット・シュートの守り・ブロック の強さ
const CPU_INSIDE = { dunk: 0.10, layup: 0.06 }; // CPUのダンク・レイアップを入りにくくする分（強さ5でちょうどこの分）
const PERFECT = 1.0;       // シュートゲージのいちばん上（ここで離すとパーフェクト）
const FILL_TIME = 0.68;     // ゲージがいちばん上まで溜まる時間（秒）
const rand = Math.random;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)); // a − b を −π〜π で
const gauss = () => (rand() + rand() + rand() - 1.5) / 0.5;
const dirOf = side => (side === 0 ? 1 : -1);
const hoopOf = side => ({ x: dirOf(side) * HX, z: 0 });

// 画面に出す短い名前：外国の選手は「・」のあと（ファミリーネーム）、日本の選手は姓
function shortName(name) {
  if (name.includes('・')) return name.split('・').pop();
  return name.split(/[ 　]/)[0];
}

function hue(code) { let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

// ---------- 見た目のパーツ ----------
const FLOOR_W = 36, FLOOR_D = 23; // 床の大きさ（コートの外のエプロンもふくむ）

function courtTexture(paint, logo, homeName, opt = {}) {
  const S = 64; // 1m あたりのピクセル
  const W = FLOOR_W * S, H = FLOOR_D * S;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = x => W / 2 + x * S, Z = z => H / 2 + z * S;
  // コートの外（エプロン）：ホームのチームカラー
  g.fillStyle = paint; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, W, H);
  // フローリング：明るいメープルの板（少しずつ色と木目がちがう）
  const plank = 15 * S / 70;
  g.save();
  g.beginPath(); g.rect(X(-LEN), Z(-WID), 28 * S, 15 * S); g.clip();
  for (let i = 0; i < 70; i++) {
    const off = (i * 0.83) % 2.4;
    for (let x = -LEN - off; x < LEN; x += 2.4) {
      g.fillStyle = opt.wood ? `hsl(${30 + rand() * 4} ${52 + rand() * 8}% ${60 + rand() * 6}%)` : `hsl(${34 + rand() * 4} ${40 + rand() * 8}% ${70 + rand() * 6}%)`;
      g.fillRect(X(x), Z(-WID) + i * plank, 2.4 * S - 1, plank + 1);
    }
  }
  g.restore();
  g.globalAlpha = 0.06;
  for (let i = 0; i < 70; i++) { g.fillStyle = '#5a3a1a'; g.fillRect(X(-LEN), Z(-WID) + i * plank, 28 * S, 1.5); }
  g.globalAlpha = 1;
  // ペイントエリア：チームカラーをうすく
  [-1, 1].forEach(d => {
    const bx = d * LEN;
    g.fillStyle = paint;
    g.globalAlpha = opt.solid ? 1 : 0.28;
    g.fillRect(Math.min(X(bx), X(bx - d * 5.8)), Z(-2.45), 5.8 * S, 4.9 * S);
    g.globalAlpha = 1;
  });
  g.lineWidth = 0.05 * S;
  g.strokeStyle = 'rgba(255,255,255,.95)';
  g.strokeRect(X(-LEN), Z(-WID), 28 * S, 15 * S);
  g.beginPath(); g.moveTo(X(0), Z(-WID)); g.lineTo(X(0), Z(WID)); g.stroke();
  // センターサークル：濃い円にホームのロゴ（ふちはチームカラー）
  if (!opt.solid) {
    g.fillStyle = '#1b2130';
    g.beginPath(); g.arc(X(0), Z(0), 1.8 * S, 0, Math.PI * 2); g.fill();
  }
  g.lineWidth = 0.12 * S; g.strokeStyle = paint;
  g.beginPath(); g.arc(X(0), Z(0), 1.74 * S, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 0.05 * S; g.strokeStyle = 'rgba(255,255,255,.95)';
  g.beginPath(); g.arc(X(0), Z(0), 1.8 * S, 0, Math.PI * 2); g.stroke();
  if (logo) {
    const size = 2.7 * S;
    g.drawImage(logo, X(0) - size / 2, Z(0) - size / 2, size, size);
  } else {
    g.fillStyle = '#ffffff';
    g.font = `900 ${0.6 * S}px "Zen Kaku Gothic New", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(homeName, X(0), Z(0));
  }
  [-1, 1].forEach(d => {
    const bx = d * LEN, hx = d * HX;
    g.strokeRect(Math.min(X(bx), X(bx - d * 5.8)), Z(-2.45), 5.8 * S, 4.9 * S);
    g.beginPath(); g.arc(X(bx - d * 5.8), Z(0), 1.8 * S, 0, Math.PI * 2); g.stroke();
    // 3ポイントライン（コーナーはまっすぐ）
    const k = Math.PI / 2 - Math.asin(6.6 / 6.75);
    const cx = hx - d * Math.cos(Math.asin(6.6 / 6.75)) * 6.75;
    g.beginPath();
    if (d > 0) g.arc(X(hx), Z(0), 6.75 * S, Math.PI / 2 + k, Math.PI * 1.5 - k);
    else g.arc(X(hx), Z(0), 6.75 * S, -Math.PI / 2 + k, Math.PI / 2 - k);
    g.stroke();
    [-6.6, 6.6].forEach(z => { g.beginPath(); g.moveTo(X(bx), Z(z)); g.lineTo(X(cx), Z(z)); g.stroke(); });
    g.beginPath(); g.arc(X(hx), Z(0), 1.25 * S, -Math.PI / 2, Math.PI / 2, d > 0); g.stroke();
  });
  // エプロンの文字（HOME / VISITOR と、ホームのチーム名）
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${0.55 * S}px "Teko", "Arial Black", sans-serif`;
  g.fillText('VISITOR', X(-7), Z(-WID - 0.75));
  g.fillText('HOME', X(7), Z(-WID - 0.75));
  g.font = `900 ${0.7 * S}px "Zen Kaku Gothic New", sans-serif`;
  g.fillText(homeName, X(0), Z(WID + 0.85));
  if (opt.apron) {
    // エンドラインの外に、たて書きのチーム名
    g.font = `600 ${0.85 * S}px "Teko", "Arial Black", sans-serif`;
    [-1, 1].forEach(d => {
      g.save();
      g.translate(X(d * (LEN + 1.2)), Z(0));
      g.rotate(d * Math.PI / 2);
      g.fillText(opt.apron, 0, 0);
      g.restore();
    });
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// LEDの広告ボード（ながれる文字）
function ledTexture(items) {
  const cv = document.createElement('canvas');
  cv.width = 2048; cv.height = 64;
  const g = cv.getContext('2d');
  const w = cv.width / items.length;
  items.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg; g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = '900 40px "Zen Kaku Gothic New", "Arial Black", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, i * w + w / 2, 34);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(i * w + w - 3, 0, 3, 64);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function numberTexture(no, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  const light = new THREE.Color(fg).getHSL({}).l > 0.5;
  g.font = `700 ${String(no).length > 1 ? 200 : 220}px "Teko", Impact, "Arial Black", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 22; g.strokeStyle = light ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.85)';
  g.strokeText(no, 128, 146);
  g.fillStyle = fg; g.fillText(no, 128, 146);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 頭の上の背番号バッジ（丸い吹き出しの下に、小さなしっぽで頭を指す）
function badgeTexture(no, color) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 160;
  const g = cv.getContext('2d');
  const cx = 64, cy = 62, r = 52, tip = 142;
  const pin = () => {
    // 丸はそのまま一周させ、真下に小さな吹き出しのしっぽを付ける
    const d = 0.3, a0 = Math.PI / 2 + d, a1 = Math.PI / 2 - d;
    g.beginPath();
    g.arc(cx, cy, r, a0, a1, false);
    const rx = cx + r * Math.cos(a1), ry = cy + r * Math.sin(a1);
    g.quadraticCurveTo(cx + 5, ry + 12, cx, tip);
    const lx = cx + r * Math.cos(a0);
    g.quadraticCurveTo(cx - 5, ry + 12, lx, ry);
    g.closePath();
  };
  // 薄い影
  g.save();
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
  g.fillStyle = color; pin(); g.fill();
  g.restore();
  // 上を少し明るくして立体感
  const grd = g.createLinearGradient(0, cy - r, 0, tip);
  grd.addColorStop(0, 'rgba(255,255,255,.28)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(0,0,0,.18)');
  g.fillStyle = grd; pin(); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineJoin = 'round';
  pin(); g.stroke();
  // 数字（3桁などで幅が広いときは縮める）
  let fs = 66;
  g.font = `700 ${fs}px "Teko", Impact, "Arial Black", sans-serif`;
  const w = g.measureText(no).width;
  if (w > 80) { fs = Math.floor(fs * 80 / w); g.font = `700 ${fs}px "Teko", Impact, "Arial Black", sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.6)';
  g.strokeText(no, cx, cy + 4);
  g.fillStyle = '#ffffff'; g.fillText(no, cx, cy + 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 顔写真（バストアップ）から顔だけを切りぬき（ふちはぼかす）、肌と髪の色も取る
function loadFace(url, hiUrl) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      const avg = (g, x, y, cw, ch) => {
        try {
          const px = g.getImageData(x, y, cw, ch).data;
          let r = 0, gg = 0, b = 0, n = 0;
          for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
          return n > cw * ch * 0.3 ? new THREE.Color(`rgb(${r / n | 0},${gg / n | 0},${b / n | 0})`) : null;
        } catch (e) { return null; }
      };
      // 元の写真から色を取る
      const src = document.createElement('canvas');
      src.width = w; src.height = h;
      const sg = src.getContext('2d');
      sg.drawImage(img, 0, 0);
      const skin = avg(sg, w * 0.44 | 0, h * 0.27 | 0, w * 0.12 | 0, h * 0.04 | 0) || new THREE.Color('#a87652');
      const hairC = avg(sg, w * 0.45 | 0, h * 0.06 | 0, w * 0.1 | 0, h * 0.03 | 0);
      // 髪の色：肌より暗ければ髪、近ければ坊主（肌色）
      const hsS = skin.getHSL({}), hsH = hairC ? hairC.getHSL({}) : null;
      const hair = hairC && hsH.l < hsS.l - 0.08 ? hairC : skin.clone().multiplyScalar(0.92);
      // ユニフォームの色：胸〜おなかでいちばん多い色（肌の色・白い文字はのぞく）
      let jersey = null;
      try {
        const px = sg.getImageData(w * 0.32 | 0, h * 0.72 | 0, w * 0.36 | 0, h * 0.24 | 0).data;
        const bins = {};
        for (let i = 0; i < px.length; i += 16) {
          if (px[i + 3] < 220) continue;
          const c = new THREE.Color().setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
          const hc = c.getHSL({});
          if (hc.l > 0.85) continue;
          // 肌（腕）らしい色はのぞく：だいだい系で、肌の色に近いもの
          if (hc.h > 0.01 && hc.h < 0.13 && hc.s > 0.18 && Math.abs(c.r - skin.r) + Math.abs(c.g - skin.g) + Math.abs(c.b - skin.b) < 0.3) continue;
          const key = (px[i] >> 5) + ',' + (px[i + 1] >> 5) + ',' + (px[i + 2] >> 5);
          (bins[key] = bins[key] || []).push(c);
        }
        const best = Object.values(bins).sort((x, y) => y.length - x.length)[0];
        if (best && best.length > 20) {
          jersey = new THREE.Color(0, 0, 0);
          best.forEach(c => { jersey.r += c.r / best.length; jersey.g += c.g / best.length; jersey.b += c.b / best.length; });
        }
      } catch (e) { /* なし */ }
      // 髪のボリューム：頭のいちばん上がどれだけ高いか
      let top = h;
      try {
        const col = sg.getImageData(w * 0.4 | 0, 0, w * 0.2 | 0, h * 0.2 | 0).data;
        const cw = w * 0.2 | 0;
        for (let i = 0; i < col.length; i += 4) if (col[i + 3] > 128) { top = Math.floor(i / 4 / cw); break; }
      } catch (e) { /* なし */ }
      const vol = clamp((h * 0.07 - top) / (h * 0.06), 0, 1);
      // 長い髪（ドレッドなど）：首の横に髪の色がある
      let long = false;
      if (hairC) {
        const sideL = avg(sg, w * 0.3 | 0, h * 0.36 | 0, 6, 10), sideR = avg(sg, w * 0.67 | 0, h * 0.36 | 0, 6, 10);
        const near = c2 => c2 && Math.abs(c2.getHSL({}).l - hsH.l) < 0.12 && c2.getHSL({}).l < hsS.l - 0.05;
        long = near(sideL) || near(sideR);
      }
      // 顔の画像：高画質な顔の切りぬき（faces/）があればそれを、なければ写真から切りぬく
      const finish = (src, sx, sy, ss) => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 512;
        const g = cv.getContext('2d');
        g.fillStyle = '#' + skin.getHexString();
        g.fillRect(0, 0, 512, 512);
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, sx, sy, ss, ss, 0, 0, 512, 512);
        // ふちを肌の色にとかす（顔のまん中ははっきり）
        const grad = g.createRadialGradient(256, 236, 140, 256, 236, 250);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 512);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve({ tex, skin: '#' + skin.getHexString(), hair: '#' + hair.getHexString(), jersey, vol, long, bald: hair !== hairC });
      };
      const size = w * 0.44;
      if (hiUrl) {
        const hi = new Image();
        hi.onload = () => finish(hi, 0, 0, hi.width);
        hi.onerror = () => finish(img, w * 0.5 - size / 2, h * 0.045, size);
        hi.src = hiUrl;
      } else finish(img, w * 0.5 - size / 2, h * 0.045, size);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// 顔の形：写真をまっすぐ前から貼る（ゆがまない）。鼻・まゆ・ほお・あご・くちびるを少し出す
function faceGeometry(r) {
  // 画像の上のはし（v=1）をこえない高さまで（それより上は頭の皮ふ・髪）
  const g = new THREE.SphereGeometry(r, 40, 32, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.24, Math.PI * 0.6);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const bump = (x, y, cx, cy, sx, sy, a) => a * Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const X = x / r, Y = y / r;
    // 写真の位置（顔の切りぬき画像で調べた位置を頭の上に置いたところ）：まゆ Y≈+0.17、目 Y≈+0.05、鼻 Y≈-0.17、口 Y≈-0.35、あご Y≈-0.74
    let d = 0;
    d += bump(X, Y, 0, -0.1, 0.08, 0.16, 0.11);      // 鼻すじ〜鼻先
    d += bump(X, Y, 0, -0.22, 0.13, 0.05, 0.03);     // 小鼻
    d += bump(X, Y, 0, 0.19, 0.45, 0.07, 0.035);     // まゆのほね
    d += bump(X, Y, 0.42, -0.07, 0.15, 0.13, 0.025); // ほお骨
    d += bump(X, Y, -0.42, -0.07, 0.15, 0.13, 0.025);
    d += bump(X, Y, 0, -0.36, 0.2, 0.06, 0.02);      // くちびる
    d += bump(X, Y, 0, -0.72, 0.22, 0.1, 0.03);      // あご
    const k = 1 + d * Math.max(0, z / r);            // 前のほうだけふくらませる
    pos.setXYZ(i, x * k, y * k, z * k);
    // 前からまっすぐ写真を当てる（目が頭のまん中より少し上、ほおが頭のはしにくるように）
    uv.setXY(i, 0.5 + X * 0.43, 0.6 + Y * 0.54);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- 選手ごとの見た目の特ちょう（試合の写真・公式写真から） ----------
// tattoo: 'rArm'（ドリブルする腕ぜんぶ）/ 'calves'（両ふくらはぎ）
const STYLES = {
  // 横浜エクセレンスのマスコット（data/mascots.js）
  m45: { mascot: 'pick' },
  m80: { mascot: 'roll' },
  // 例（いまは使っていない）：選手IDごとに、外部AIのモデルや見た目の特ちょうを書ける
  // '43445': { model: 'models/43445_v3.glb', headband: '#121316', braids: '#17110c', beard: '#1a120c', tattoo: ['rArm', 'calves'], shoes: '#72e3c6', armLen: 1.05 },
  // トレイ・ボイド：3Dモデル（Meshopt・KTX2 で圧縮）と、動き（ドリブル・フロントチェンジ・ジャンプシュート・ステップバック3。ドリブルとフロントチェンジはボールの位置も入っている）
  // （作り方は別フォルダの 3Dモデル/retarget.py。中身を変えたらファイル名の _v を上げる＝端末に保存した古いものを使わせない）
  '43445': { model: 'models3d/43445_v2.glb', anims: 'models3d/43445_anims_v2.glb' },
  // 大橋大空：3Dモデルと動き（作り方はボイド選手と同じ。動きはこのモデルの骨に合わせて作り直したもの）
  '51000274': { model: 'models3d/51000274_v2.glb', anims: 'models3d/51000274_anims_v2.glb' },
  // クーリバリ セリンムルタラ：3Dモデルと動き（作り方は同じ）
  '55000957': { model: 'models3d/55000957_v1.glb', anims: 'models3d/55000957_anims_v1.glb' },
  // ザック・モーア：3Dモデルと動き（作り方は同じ）
  '5100000063': { model: 'models3d/5100000063_v1.glb', anims: 'models3d/5100000063_anims_v1.glb' },
};

// タトゥーの絵（手足にまきつける）。y0〜y1 は上からの範囲（0〜1）
function tattooTexture(skinHex, seed, y0 = 0, y1 = 1) {
  const W = 512, H = 256, AY = 0.6; // 横（まわり）にくらべて縦がのびて貼られるので、縦をちぢめて描く
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = skinHex;
  g.fillRect(0, 0, W, H);
  let s = seed % 2147483646 + 1;
  const r = () => (s = s * 16807 % 2147483647) / 2147483647;
  const top = y0 * H, h = (y1 - y0) * H;
  // まわりを1周する絵なので、左右のはしで切れないように3回ずらして描く
  const wrap = fn => [-W, 0, W].forEach(dx => { g.save(); g.translate(dx, 0); fn(); g.restore(); });
  g.save();
  g.beginPath(); g.rect(0, top, W, h); g.clip();
  // グレーのぼかし（陰影）
  for (let i = 0; i < 30; i++) {
    const x = r() * W, y = top + r() * h, rad = 20 + r() * 46, a = 0.16 + r() * 0.26;
    wrap(() => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(18,14,20,${a})`);
      gr.addColorStop(1, 'rgba(18,14,20,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  }
  g.strokeStyle = 'rgba(12,9,14,.85)';
  g.fillStyle = 'rgba(12,9,14,.75)';
  // バラ（うずまきと花びら）
  for (let i = 0; i < 8; i++) {
    const x = r() * W, y = top + 14 + r() * Math.max(1, h - 28), rad = 14 + r() * 20;
    const petals = Array.from({ length: 6 }, (_, k) => k * 1.05 + r() * 0.4);
    wrap(() => {
      g.lineWidth = 2.2;
      g.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.2) {
        const rr = rad * 0.55 * a / (Math.PI * 6);
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * AY);
      }
      g.stroke();
      petals.forEach(a => {
        g.beginPath();
        g.ellipse(x + Math.cos(a) * rad * 0.8, y + Math.sin(a) * rad * 0.8 * AY, rad * 0.42, rad * 0.24 * AY, a, 0, Math.PI * 2);
        g.stroke();
      });
    });
  }
  // つる・線
  for (let i = 0; i < 12; i++) {
    let x = r() * W, y = top + r() * h;
    const path = [];
    for (let k = 0; k < 6; k++) { path.push([x, y]); x += (r() - 0.5) * 80; y += (r() - 0.5) * 50; }
    const lw = 1.4 + r() * 2.2;
    wrap(() => {
      g.lineWidth = lw;
      g.beginPath();
      path.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.stroke();
    });
  }
  // 小さな星・点
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = top + r() * h, rad = 1.5 + r() * 3;
    wrap(() => { g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); });
  }
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ひげのかたまり（あごの下〜ほおの横）。上のふちはうすくして、写真の顔となじませる
function beardTexture(hex) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = hex;
  g.fillRect(0, 0, 128, 128);
  // 毛のすじ
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    g.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.35)' : 'rgba(255,240,220,.08)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 4 + Math.random() * 4); g.stroke();
  }
  // 上と下のふちを透明に
  const a = g.getImageData(0, 0, 128, 128);
  for (let y = 0; y < 128; y++) {
    const al = clamp(Math.min(y / 40, (128 - y) / 30), 0, 1);
    for (let x = 0; x < 128; x++) a.data[(y * 128 + x) * 4 + 3] = 255 * al;
  }
  g.putImageData(a, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- チームのユニフォーム（公式のデザイン） ----------
// base: 本体の色、panel: わきのパネル、line: パネルの六角形の模様、trim: えり・そでぐり、num: 背番号
const KITS = {
  // 横浜エクセレンス 2025-26 ホーム：緑の本体、わきに黒いパネル（緑の六角形）、黒いえり・そでぐり、白い番号
  '714': { base: '#138a43', panel: '#0a0e0c', line: '#25c868', trim: '#0a0e0c', num: '#ffffff' },
};

// まわりにまく布の絵。centers は黒いパネルの位置（0〜1：0 が正面、0.25 が +x の横、0.5 がせなか）
function kitTexture(kit, centers, w = 0.075) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = kit.base;
  g.fillRect(0, 0, W, H);
  // 布の明暗（少しだけ）
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    g.fillRect(0, Math.random() * H, W, 2 + Math.random() * 6);
  }
  const hex = (x0, x1) => {
    // 六角形のもよう（はちの巣）。ところどころ光る点
    g.save();
    g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip();
    g.fillStyle = kit.panel;
    g.fillRect(x0, 0, x1 - x0, H);
    const s = 13;
    g.strokeStyle = kit.line;
    g.globalAlpha = 0.55;
    g.lineWidth = 1.4;
    for (let row = 0; row * s * 1.5 < H + s; row++) {
      for (let col = 0; col * s * 1.73 < W + s; col++) {
        const cx = col * s * 1.73 + (row % 2) * s * 0.866, cy = row * s * 1.5;
        if (cx < x0 - s || cx > x1 + s) continue;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + k * Math.PI / 3;
          g.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        }
        g.closePath();
        g.stroke();
        if (Math.random() < 0.12) {
          const gr = g.createRadialGradient(cx, cy - s, 0, cx, cy - s, 9);
          gr.addColorStop(0, 'rgba(120,255,170,.9)');
          gr.addColorStop(1, 'rgba(120,255,170,0)');
          g.fillStyle = gr;
          g.fillRect(cx - 9, cy - s - 9, 18, 18);
        }
      }
    }
    g.restore();
  };
  centers.forEach(c => [-1, 0, 1].forEach(o => hex((c + o - w) * W, (c + o + w) * W)));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------- 外部AIで作った3Dモデル（GLB）を、いつもの動きで動かす ----------
// 骨の名前（Mixamo・Meshy など）から、もも・ひざ・肩・ひじを見つける
const BONE_NAMES = {
  hip: ['upleg', 'thigh', 'upperleg'],
  knee: ['leg', 'calf', 'shin', 'lowerleg', 'knee'],
  sh: ['arm', 'upperarm'],
  el: ['forearm', 'lowerarm', 'elbow'],
};

// 骨のないモデル（TRELLIS などで作ったもの）に、体の割合と形から骨を入れる
// 正面向き・まっすぐ立って、腕を体から少しはなした形（A ポーズ）を想定。左右は +x / -x で見る
function autoRig(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) return scene;
  const box = new THREE.Box3().setFromObject(scene);
  const Hb = box.max.y - box.min.y, y0 = box.min.y;
  // 圧縮（量子化）されたモデルは、位置と向きをふつうの小数にもどしてから測る
  const toFloat = g => {
    ['position', 'normal'].forEach(name => {
      const a = g.getAttribute(name);
      if (!a || (a.array instanceof Float32Array && !a.normalized)) return;
      const f = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
      g.setAttribute(name, new THREE.BufferAttribute(f, 3));
    });
    return g;
  };
  const geos = meshes.map(m => toFloat(m.geometry.clone()).applyMatrix4(m.matrixWorld));
  const raw = fn => geos.forEach(g => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) fn(p.getX(i), p.getY(i), p.getZ(i), g, i);
  });
  // 測るときは、頂点ではなく、表面に同じ間かくでまいた点を使う（三角形の数がちがっても、同じ結果になる）
  const samp = [];
  {
    let seed = 12345;
    const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const cell = (Hb * 0.004) ** 2;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
    geos.forEach(g => {
      const p = g.attributes.position, ix = g.index;
      const n = ix ? ix.count : p.count;
      for (let t = 0; t < n; t += 3) {
        const a = ix ? ix.getX(t) : t, b = ix ? ix.getX(t + 1) : t + 1, c = ix ? ix.getX(t + 2) : t + 2;
        A.fromBufferAttribute(p, a); B.fromBufferAttribute(p, b); C.fromBufferAttribute(p, c);
        const area = N.subVectors(B, A).cross(C.clone().sub(A)).length() / 2;
        let k = area / cell;
        k = Math.floor(k) + (rnd() < k % 1 ? 1 : 0);
        for (let j = 0; j < k; j++) {
          let u = rnd(), v = rnd();
          if (u + v > 1) { u = 1 - u; v = 1 - v; }
          samp.push(A.x + (B.x - A.x) * u + (C.x - A.x) * v, A.y + (B.y - A.y) * u + (C.y - A.y) * v, A.z + (B.z - A.z) * u + (C.z - A.z) * v);
        }
      }
    });
  }
  const surf = fn => { for (let i = 0; i < samp.length; i += 3) fn(samp[i], samp[i + 1], samp[i + 2]); };
  // 体のまん中：こしの高さの頂点のまんなかの値（手や上げた腕にひっぱられない）
  // 点の数ではなく「体がある場所」で測る（三角形を減らしたモデルでも同じになるように、1cm ほどのマスで1つと数える）
  const cellSet = sz => { const seen = new Set(); return (x, y, z) => { const k = Math.round(x / sz) + ',' + Math.round(y / sz) + ',' + Math.round(z / sz); if (seen.has(k)) return false; seen.add(k); return true; }; };
  const xs = [], zs = [];
  const c0 = cellSet(Hb * 0.006);
  surf((x, y, z) => { const Y = (y - y0) / Hb; if (Y > 0.48 && Y < 0.58 && c0(x, y, z)) { xs.push(x); zs.push(z); } });
  const med = a => (a.length ? a.sort((u, v) => u - v)[a.length >> 1] : 0);
  let cx = xs.length ? med(xs) : (box.min.x + box.max.x) / 2, cz = zs.length ? med(zs) : (box.min.z + box.max.z) / 2;
  // 身長：上げた手ではなく、頭のてっぺんまで
  let top = -Infinity;
  surf((x, y, z) => { if (Math.abs(x - cx) < Hb * 0.06 && Math.abs(z - cz) < Hb * 0.12 && y > top) top = y; });
  const H = Number.isFinite(top) && top - y0 > Hb * 0.6 ? top - y0 : Hb;
  // むねの高さで、体のまん中を測りなおす（腕はのぞく）。頭のまん中も測る
  const cxs = [], czs = [], hxs = [], hzs = [];
  const c1 = cellSet(H * 0.006), c2 = cellSet(H * 0.006);
  surf((x, y, z) => {
    const Y = (y - y0) / H;
    if (Y > 0.6 && Y < 0.75 && Math.abs(x - cx) < H * 0.11 && c1(x, y, z)) { cxs.push(x); czs.push(z); }
  });
  if (cxs.length > 50) { cx = med(cxs); cz = med(czs); }
  surf((x, y, z) => {
    const Y = (y - y0) / H;
    if (Y > 0.88 && Y < 0.97 && Math.abs(x - cx) < H * 0.12 && c2(x, y, z)) { hxs.push((x - cx) / H); hzs.push((z - cz) / H); }
  });
  const headX = hxs.length > 30 ? med(hxs) : 0, headZ = hzs.length > 30 ? med(hzs) : 0;
  // 頂点をすべて、体の座標で見る（X・Y・Z は身長で割った値。Y=0 が足もと、Y=1 が頭のてっぺん）
  const each = fn => raw((x, y, z, g, i) => fn((x - cx) / H, (y - y0) / H, (z - cz) / H, g, i));
  const eachS = fn => surf((x, y, z) => fn((x - cx) / H, (y - y0) / H, (z - cz) / H));
  // 脚：もも・ひざ・足首の高さで、頂点を2つのかたまりにわけて、それぞれの中心をさがす（脚を前後にひらいていてもよい）
  const two = (lo, hi, maxX, init) => {
    const pts = [];
    const cs = cellSet(0.006);
    eachS((X, Y, Z) => { if (Y >= lo && Y < hi && Math.abs(X) < maxX && cs(X, Y, Z)) pts.push([X, Z]); });
    const c = init.map(v => v.slice());
    for (let it = 0; it < 10 && pts.length > 10; it++) {
      const sum = [[0, 0, 0], [0, 0, 0]];
      pts.forEach(([x, z]) => {
        const k = Math.hypot(x - c[0][0], z - c[0][1]) < Math.hypot(x - c[1][0], z - c[1][1]) ? 0 : 1;
        sum[k][0] += x; sum[k][1] += z; sum[k][2]++;
      });
      sum.forEach((sm, k) => { if (sm[2]) c[k] = [sm[0] / sm[2], sm[1] / sm[2]]; });
    }
    return c;
  };
  const thigh = two(0.38, 0.45, 0.13, [[0.06, 0], [-0.06, 0]]);
  const kneeC = two(0.26, 0.31, 0.16, thigh);
  const ankC = two(0.03, 0.08, 0.2, kneeC);
  // 腕：肩から、いちばん遠い指先までの向き（上げた腕もさがす。腕が体についていたら、まっすぐ下とみなす）
  const SH_Y = 0.8, SH_X = 0.115; // 肩の関節（左右とも同じ高さ・同じはば）
  const tip = { 1: null, [-1]: null };
  const up = { 1: null, [-1]: null }, upN = { 1: 0, [-1]: 0 }; // 頭より上にある手（上げた腕）
  // その高さの脚の中心（ももとひざのあいだを直線でつなぐ）。脚の近くは腕とまちがえない
  const legAt = (Y, k) => {
    const t = clamp((Y - 0.285) / (0.415 - 0.285), 0, 1);
    return [kneeC[k][0] + (thigh[k][0] - kneeC[k][0]) * t, kneeC[k][1] + (thigh[k][1] - kneeC[k][1]) * t];
  };
  eachS((X, Y, Z) => {
    if (Math.abs(X) < 0.12 || Y < 0.3 || Y > 1.35) return;
    if (Y < 0.52 && [0, 1].some(k => { const c = legAt(Y, k); return Math.hypot(X - c[0], Z - c[1]) < 0.09; })) return;
    const s = X > 0 ? 1 : -1;
    const d = Math.hypot(X - s * SH_X, Y - SH_Y, Z);
    if (!tip[s] || d > tip[s][3]) tip[s] = [X, Y, Z, d];
    if (Y > 0.92) { upN[s]++; if (!up[s] || d > up[s][3]) up[s] = [X, Y, Z, d]; }
  });
  const V = (x, y, z) => new THREE.Vector3(x * H + cx, y * H + y0, z * H + cz);
  const J = {};
  [1, -1].forEach(s => {
    // 脚のかたまりは、x の大きいほうを +x の脚にする
    const k = (thigh[0][0] > thigh[1][0]) === (s > 0) ? 0 : 1;
    J[s] = { hip: [thigh[k][0], 0.51, thigh[k][1] * 0.5], knee: [kneeC[k][0], 0.285, kneeC[k][1]], ankle: [ankC[k][0], 0.045, ankC[k][1]] };
    const sh = [s * SH_X, SH_Y, 0];
    // 上げた腕があればそれを先に使う（脚のはしを手とまちがえないように）
    const t = upN[s] > 30 ? up[s] : tip[s] && tip[s][3] > 0.3 ? tip[s] : [s * (SH_X + 0.03), SH_Y - 0.44, 0];
    J[s].sh = sh;
    J[s].el = sh.map((v, i) => v + (t[i] - v) * 0.42);
    J[s].tip = t.slice(0, 3);
  });
  // 骨をつくる（名前は Mixamo とおなじにしておく）
  const bone = (name, at, parent, pAt) => {
    const b = new THREE.Bone();
    b.name = name;
    const w = V(...at), pw = pAt ? V(...pAt) : new THREE.Vector3();
    b.position.copy(w.sub(pw));
    if (parent) parent.add(b);
    return b;
  };
  const hips = bone('Hips', [0, 0.53, 0]);
  const bones = [hips];
  const segs = [{ a: [0, 0.5, 0], b: [0, 1.0, 0], i: 0, s: 0 }]; // 胴体と頭（動かさない）
  [1, -1].forEach(s => {
    const n = s > 0 ? 'Left' : 'Right', j = J[s];
    const up = bone(n + 'UpLeg', j.hip, hips, [0, 0.53, 0]);
    const lo = bone(n + 'Leg', j.knee, up, j.hip);
    const ft = bone(n + 'Foot', j.ankle, lo, j.knee);
    const ar = bone(n + 'Arm', j.sh, hips, [0, 0.53, 0]);
    const fa = bone(n + 'ForeArm', j.el, ar, j.sh);
    const hd = bone(n + 'Hand', j.tip, fa, j.el);
    const k = bones.length;
    bones.push(up, lo, ft, ar, fa, hd);
    segs.push({ a: j.hip, b: j.knee, i: k, s, leg: 1 }, { a: j.knee, b: j.ankle, i: k + 1, s, leg: 1 },
      { a: j.sh, b: j.el, i: k + 3, s, upper: 1 }, { a: j.el, b: j.tip, i: k + 4, s });
  });
  // 頂点ごとに、近い骨2本へ重みをわける（関節のまわりはなめらかに）
  const P = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const segDist = (sg, X, Y, Z) => {
    A.set(...sg.a); B.set(...sg.b); P.set(X, Y, Z);
    const ab = C.copy(B).sub(A);
    const tr = P.clone().sub(A).dot(ab) / ab.lengthSq();
    const t = clamp(tr, 0, 1);
    const d = P.distanceTo(A.addScaledVector(ab, t));
    // 上腕：肩の関節より体がわ（ひじと反対）にある点は、胴体につきやすくする（肩の上の皮ふが腕といっしょに回らないように）
    return sg.upper ? d + Math.max(0, 0.25 - tr) * 0.12 : d;
  };
  const skinIdx = geos.map(g => new Uint16Array(g.attributes.position.count * 4));
  const skinW = geos.map(g => new Float32Array(g.attributes.position.count * 4));
  each((X, Y, Z, g, vi) => {
    const gi = geos.indexOf(g);
    const s = X > 0 ? 1 : -1;
    const head = Y > 0.84 && Math.hypot(X - headX, (Z - headZ) * 0.8) < 0.085; // 頭は腕にひっぱられないように
    const core = Y > 0.55 && Y < 0.9 && Math.abs(X) < 0.095;                   // 首・むね・せなかの内がわも胴体だけ
    const ds = segs.map(sg => {
      if ((head || core) && sg.i && !sg.leg) return Infinity;
      if (sg.s && !sg.leg && sg.s !== s) return Infinity; // 反対がわの腕にはつけない
      if (sg.leg && Y > 0.56) return Infinity;           // おなかより上は脚にしない
      return segDist(sg, X, Y, Z);
    });
    const order = ds.map((d, k) => k).sort((a, b) => ds[a] - ds[b]);
    const [k0, k1] = order;
    const w1 = Number.isFinite(ds[k1]) ? Math.exp(-(ds[k1] - ds[k0]) / 0.012) : 0;
    skinIdx[gi][vi * 4] = segs[k0].i; skinW[gi][vi * 4] = 1 / (1 + w1);
    skinIdx[gi][vi * 4 + 1] = segs[k1].i; skinW[gi][vi * 4 + 1] = w1 / (1 + w1);
    // 肩のまわり：胴体→上腕へ、ひじのほうへ進むほどなめらかに重みをうつす（腕を大きく回しても肩がはねない）
    const ua = segs.find(sg => sg.upper && sg.s === s);
    if (!head && !core && ua && (segs[k0] === ua || segs[k0].i === 0)) {
      A.set(...ua.a); B.set(...ua.b); P.set(X, Y, Z);
      if (P.distanceTo(A) < 0.13) {
        const ab = C.copy(B).sub(A);
        const tr = P.clone().sub(A).dot(ab) / ab.lengthSq();
        const u = clamp((tr + 0.1) / 0.55, 0, 1);
        const w = u * u * (3 - 2 * u);
        skinIdx[gi][vi * 4] = 0; skinW[gi][vi * 4] = 1 - w;
        skinIdx[gi][vi * 4 + 1] = ua.i; skinW[gi][vi * 4 + 1] = w;
      }
    }
  });
  const out = new THREE.Group();
  out.userData.rig = { bodyH: H, cx, cz, y0 }; // 大きさと位置は、体（上げた手はふくめない）で合わせる
  out.add(hips);
  out.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  meshes.forEach((m, gi) => {
    const g = geos[gi];
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx[gi], 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW[gi], 4));
    const sm = new THREE.SkinnedMesh(g, m.material);
    sm.bind(skeleton, new THREE.Matrix4());
    out.add(sm);
  });
  return out;
}

let gltfLoader = null, ktx2Set = false;
let ktx2Renderer = null; // KTX2（圧縮した画像）を読むには、端末がどの圧縮に対応しているかを描画の準備から調べる
const modelClips = new WeakMap(); // 読みこんだモデル → 動き（名前 → AnimationClip）
const animCache = new Map();
async function getLoader() {
  if (!gltfLoader) {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import('../vendor/jsm/GLTFLoader.js'), import('../vendor/jsm/libs/meshopt_decoder.module.js')]);
    gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  }
  if (!ktx2Set && ktx2Renderer) {
    const { KTX2Loader } = await import('../vendor/jsm/KTX2Loader.js');
    gltfLoader.setKTX2Loader(new KTX2Loader().setTranscoderPath(new URL('../vendor/jsm/libs/basis/', import.meta.url).href).detectSupport(ktx2Renderer));
    ktx2Set = true;
  }
  return gltfLoader;
}

// 動きのファイル（骨の名前でモデルにつながる）を読み、ゲーム用に整える
const SHOT_CLIPS = new Set(['jump_shot', 'stepback3']);
const MOVE_CLIPS = new Set(['crossover', 'crossover_l']);           // crossover：右手→左手、crossover_l：左手→右手
const BALL_CLIPS = new Set(['dribble', 'dribble_l', 'crossover', 'crossover_l']); // ボールの位置（Ball）が入っている動き
function loadAnims(url) {
  if (!animCache.has(url)) animCache.set(url, getLoader().then(l => l.loadAsync(url)).then(gl => {
    const hips = gl.scene.getObjectByName('Hips');
    const standY = hips ? hips.position.y : 0;
    const clips = {};
    gl.animations.forEach(c => {
      c.tracks.forEach(t => {
        if (!/^Hips\.position$/.test(t.name)) return;
        const v = t.values;
        for (let i = 0; i < v.length; i += 3) {
          // 前後左右の移動はゲームが決めるので消す（その場で動く）
          v[i] = v[0]; v[i + 2] = v[2];
          // シュートのジャンプもゲームが跳ばせるので、腰が立った高さより上がらないようにする
          if (SHOT_CLIPS.has(c.name)) v[i + 1] = Math.min(v[i + 1], standY);
        }
      });
      clips[c.name] = c;
    });
    return clips;
  }).catch(() => null));
  return animCache.get(url);
}

async function loadModel(url, animsUrl) {
  try {
    const loader = await getLoader();
    const [gl, clips] = await Promise.all([loader.loadAsync(url), animsUrl ? loadAnims(animsUrl) : null]);
    let skinned = false;
    gl.scene.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
    const scene = skinned ? gl.scene : autoRig(gl.scene); // 骨がなければ、こちらで入れる
    if (clips && skinned) modelClips.set(scene, clips);
    return scene;
  } catch (e) {
    return null; // ファイルがない・読めないときは、いつものモデル
  }
}

// lk（buildPlayer で作った体）の上に、GLB のモデルをかぶせる。いつもの体は見えなくして、骨だけ動かす
function attachModel(lk, src, sty) {
  const model = src.clone(true);
  // SkinnedMesh の clone は骨のつながりが切れるので、名前でつなぎなおす
  const byName = {};
  model.traverse(o => { if (o.isBone) byName[o.name] = o; });
  model.traverse(o => {
    if (o.isSkinnedMesh) {
      const bones = o.skeleton.bones.map(b => byName[b.name] || b);
      o.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
      o.frustumCulled = false;
    }
    if (o.isMesh) o.castShadow = false;
  });
  // 大きさは、骨で動かしたあとの形で測る
  model.updateMatrixWorld(true);
  model.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const holder = new THREE.Group();
  holder.rotation.y = sty.modelYaw || 0;
  const rig = model.userData.rig;
  const k = lk.height / (rig ? rig.bodyH : size.y);
  model.scale.setScalar(k);
  if (rig) model.position.set(-rig.cx * k, -rig.y0 * k, -rig.cz * k);
  else model.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
  holder.add(model);
  lk.root.add(holder);
  lk.root.updateMatrixWorld(true);
  // 骨をさがす（名前を小文字・英字だけにして、左右と部位で見る）
  const norm = n => n.toLowerCase().replace(/mixamorig[0-9]*/g, '').replace(/[^a-z]/g, '');
  const find = (part, sdName) => {
    let best = null;
    model.traverse(o => {
      if (best || !o.isBone || !o.children.length) return;
      const n = norm(o.name);
      const hasSide = sdName === 'l' ? /^(left|l)|(left|l)$/.test(n) : /^(right|r)|(right|r)$/.test(n);
      if (!hasSide) return;
      const core = n.replace(/^(left|right|l|r)|(left|right|l|r)$/g, '');
      if (BONE_NAMES[part].includes(core)) best = o;
    });
    return best;
  };
  const inv = new THREE.Quaternion();
  lk.root.getWorldQuaternion(inv).invert();
  const rootInv = new THREE.Matrix4().copy(lk.root.matrixWorld).invert();
  const links = [];
  ['l', 'r'].forEach(sdName => {
    ['hip', 'knee', 'sh', 'el'].forEach(part => {
      const bone = find(part, sdName);
      if (!bone) return;
      const child = bone.children.find(c => c.isBone) || bone.children[0];
      const p0 = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
      const p1 = child.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
      // 左右は名前ではなく、実際の位置（+x か -x か）でいつもの体とあわせる
      const sd = p0.x > 0 ? 1 : 0;
      const joint = part === 'hip' ? lk.legs[sd].hip : part === 'knee' ? lk.legs[sd].knee : part === 'sh' ? lk.arms[sd].sh : lk.arms[sd].el;
      links.push({
        bone, joint, order: { hip: 0, knee: 1, sh: 0, el: 1 }[part],
        restDir: p1.sub(p0).normalize(),
        restQ: inv.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
      });
    });
  });
  links.sort((a, b) => a.order - b.order);
  // いつもの体はかくす（動きの計算には使う）
  lk.body.traverse(o => { if (o.isMesh) o.visible = false; });
  lk.model = { holder, links, ok: links.length >= 6 };
  // 動きのデータがあれば、ドリブルやシュートのときに再生する（ほかのときは、いつもの体の関節に合わせて動かす）
  const clips = modelClips.get(src);
  if (lk.model.ok && clips) {
    const mixer = new THREE.AnimationMixer(model);
    const acts = {};
    Object.values(clips).forEach(c => {
      const a = mixer.clipAction(c);
      if (!c.name.startsWith('dribble')) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
      acts[c.name] = a;
    });
    // ボールの位置を受ける入れ物（動きのデータの「Ball」が、手の動きに合わせて動かす）
    const ballNode = new THREE.Object3D();
    ballNode.name = 'Ball';
    (model.getObjectByName('Armature') || model).add(ballNode);
    // hand：今ボールを持っている手（'L' 左・'R' 右）。いつものドリブルは左手（+x）側
    lk.model.anim = { mixer, acts, cur: null, slowHead: null, cd: 0, face0: 0, ballNode, hand: 'L', ballW: 0, sign: 1, by: 0, down: false };
  }
  if (!lk.model.ok) {
    // 骨が見つからなければ、うごかさずに立たせておくよりも、いつもの体にもどす
    holder.removeFromParent();
    lk.body.traverse(o => { if (o.isMesh) o.visible = true; });
    lk.model = null;
  }
}

// 毎フレーム：いつもの体の関節の向き → モデルの骨の向き
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _ballV = new THREE.Vector3();
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _down = new THREE.Vector3();
function poseModel(lk) {
  const m = lk.model;
  m.holder.position.y = lk.body.position.y;
  lk.root.updateMatrixWorld(true);
  lk.root.getWorldQuaternion(_rq);
  m.links.forEach(L => {
    // いつもの体の関節が向いている方向（ワールド）
    L.joint.getWorldPosition(_v0);
    _v1.set(0, -1, 0);
    L.joint.localToWorld(_v1).sub(_v0).normalize();
    // 休めの姿勢の骨の方向 → 今の方向へまわす
    _down.copy(L.restDir).applyQuaternion(_rq);
    _q.setFromUnitVectors(_down, _v1).multiply(_q2.copy(_rq).multiply(L.restQ));
    L.bone.parent.getWorldQuaternion(_q2);
    L.bone.quaternion.copy(_q2.invert().multiply(_q));
    L.bone.updateMatrixWorld(true);
  });
}

// ---------- 横浜エクセレンスのマスコット「ピック＆ロール」 ----------
// 黄緑の大きな頭に丸い耳、うす黄緑の口もと、黒い目と鼻、白いほっぺ。緑の手足、こげ茶の手、赤いリストバンドと赤いバッシュ
const MASCOT = { fur: '#2fae4a', face: '#b9e044', muzzle: '#d4ec6a', cheek: '#f3eef0', ear: '#f2b8c6', hand: '#5b3a26', band: '#d8282a', shoe: '#d62b2b' };

function buildMascotHead(head, kind) {
  const m = (color, rough = 0.95) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const ball = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1, seg = 24) => {
    const o = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.7 | 0)), mat);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    head.add(o);
    return o;
  };
  const roll = kind === 'roll';
  const fur = m(MASCOT.fur), face = m(MASCOT.face), muzzle = m(MASCOT.muzzle);
  const black = m('#111111', 0.3), white = m('#ffffff', 0.4);
  // ロールは少したて長、ピックはまるい
  const sy = roll ? 1.06 : 0.95;
  ball(0.3, fur, 0, 0.04, -0.02, 1.0, sy, 0.92, 32);                 // 頭（上とうしろは緑）
  ball(0.275, face, 0, -0.03, 0.05, 1.0, sy * 0.92, 0.9, 32);        // 顔（前は黄緑）
  ball(0.13, muzzle, 0, -0.09, 0.25, 1.25, 0.82, 0.85);              // 口もと
  ball(0.045, black, 0, -0.03, 0.355, 1.25, 0.85, 0.8, 16);          // 鼻
  ball(0.012, white, -0.015, -0.015, 0.39, 1, 1, 0.6, 8);            // 鼻のつや
  [-1, 1].forEach(sd => {
    ball(0.042, black, sd * 0.105, 0.075, 0.27, 0.85, 1.05, 0.7, 16); // 目
    ball(0.012, white, sd * 0.105 - 0.012, 0.09, 0.3, 1, 1, 0.6, 8);  // 目の光
    ball(0.045, m(MASCOT.cheek), sd * 0.2, -0.06, 0.21, 1, 0.8, 0.45, 12); // ほっぺ
    const ear = ball(0.095, fur, sd * 0.23, 0.25, -0.04, 1, 1, 0.55, 18); // 耳
    ear.rotation.z = -sd * 0.3;
    ball(0.055, m(MASCOT.ear), sd * 0.23, 0.25, 0.005, 1, 1, 0.35, 14).rotation.z = -sd * 0.3; // 耳の中
  });
  if (roll) {
    // ロール：白い前歯2本
    [-1, 1].forEach(sd => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.045, 0.014), white);
      t.position.set(sd * 0.018, -0.155, 0.335);
      head.add(t);
    });
  } else {
    // ピック：ペロッと出したピンクの舌
    ball(0.035, m('#e8708a', 0.6), 0.03, -0.165, 0.31, 1.1, 0.7, 0.6, 12);
  }
  // 口のすじ
  ball(0.05, m('#3a2a18', 0.8), 0, -0.135, 0.33, 1.1, 0.25, 0.4, 12);
}

function buildPlayer(info, jersey, numFg, face, badgeColor, kit) {
  // 身長は公式の値（なければポジションの標準）。体重で横はばを少し変える
  const h = info.ht ? info.ht / 100 : (POS_H[info.pos.split('/')[0]] || 1.98);
  const bmi = info.ht && info.wt ? info.wt / (h * h) : 24;
  const wide = clamp(Math.sqrt(bmi / 24), 0.9, 1.15);
  const root = new THREE.Group();
  const body = new THREE.Group();
  const k = h / 1.95 * VIS;
  body.scale.set(k * wide, k, k * wide);
  root.add(body);
  const std = (color, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const sty = STYLES[info.pid] || {};
  // マスコットは緑の毛（写真の顔は使わない）
  if (sty.mascot) face = null;
  const skinC = sty.mascot ? MASCOT.fur : face ? face.skin : '#a87652';
  const skin = std(skinC, sty.mascot ? 0.95 : 0.55);
  // チームのユニフォームのデザインがあれば、わきの黒いパネルなどを絵で入れる
  const cloth = kit ? new THREE.MeshStandardMaterial({ map: kitTexture(kit, [0.25, 0.75]), roughness: 0.85 }) : std(jersey, 0.85);
  const plain = std(jersey, 0.85);
  const trim = kit ? std(kit.trim, 0.8) : std(new THREE.Color(jersey).offsetHSL(0, 0, -0.18), 0.85);
  const white = std('#f2f2f2', 0.7);
  // バッシュの色は選手ごとにちがう
  const SHOES = ['#1b1d22', '#f4f4f4', '#d32f2f', '#1e88e5', '#ffca28', '#43a047', jersey, '#8e24aa'];
  const seed = [...String(info.pid)].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
  const ink = (sty.tattoo || []);
  const dark = std(sty.mascot ? MASCOT.shoe : sty.shoes || SHOES[seed % SHOES.length], 0.55);
  // タトゥーのある肌
  const tat = (n, y0, y1) => new THREE.MeshStandardMaterial({ map: tattooTexture(skinC, seed + n * 7919, y0, y1), roughness: 0.55, metalness: 0 });
  // 筋肉の形の手足：prof は [上からの位置0〜1, 太さ] のならび。上のはしがピボット
  const limb = (prof, len, mat, sz = 1) => {
    const pts = [[0.001, 0], ...prof.map(([t, r]) => [r, t]), [0.001, 1]].reverse()
      .map(([r, t]) => new THREE.Vector2(r, -t * len));
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), mat);
    m.scale.z = sz;
    return m;
  };
  const lathe = (pts, mat, sz = 1) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20), mat);
    m.scale.z = sz;
    return m;
  };

  // ---- 脚（短パン→もも→ひざ→ふくらはぎ→ソックス→バッシュ） ----
  const legs = [-1, 1].map(sd => {
    const hip = new THREE.Group();
    hip.position.set(sd * 0.1, 0.96, 0);
    // もも：太く、ひざに向かって細くなる
    hip.add(limb([[0, 0.09], [0.15, 0.097], [0.45, 0.09], [0.78, 0.07], [1, 0.058]], 0.47, skin, 1.05));
    // 短パンのパネルは外がわだけ（+x の脚は 0.25、-x の脚は 0.75 の位置）
    const shortsMat = kit ? new THREE.MeshStandardMaterial({ map: kitTexture(kit, [sd > 0 ? 0.25 : 0.75], 0.1), roughness: 0.85 }) : cloth;
    const shortsLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.136, 0.4, 18, 1, true), shortsMat);
    shortsLeg.material.side = THREE.DoubleSide;
    shortsLeg.position.y = -0.19;
    hip.add(shortsLeg);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.01, 6, 20), trim);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = -0.39;
    hip.add(hem);
    // 短パンの横のライン
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.36, 0.05), trim);
    stripe.position.set(sd * 0.13, -0.2, 0);
    hip.add(stripe);
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skin);
    cap.position.set(0, 0.0, 0.018);
    knee.add(cap);
    // ふくらはぎ：うしろがふくらむ
    const calf = limb([[0, 0.055], [0.12, 0.062], [0.3, 0.068], [0.55, 0.052], [0.85, 0.036], [1, 0.034]], 0.42,
      ink.includes('calves') ? tat(sd + 3, 0.12, 0.62) : skin);
    calf.position.z = -0.008;
    knee.add(calf);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.043, 0.18, 12), sty.mascot ? skin : white);
    sock.position.y = -0.37;
    knee.add(sock);
    const shoe = new THREE.Group();
    shoe.position.set(0, -0.46, 0.04);
    const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), dark);
    upper.scale.set(0.058, 0.055, 0.14);
    upper.position.y = 0.025;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.07, 12), dark);
    collar.position.set(0, 0.06, -0.04);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.032, 0.29), white);
    sole.position.y = -0.022;
    shoe.add(upper, collar, sole);
    knee.add(shoe);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  });
  // 腰まわり（短パン）
  const pelvis = lathe([[0.001, 0.8], [0.19, 0.8], [0.205, 0.9], [0.2, 1.02], [0.18, 1.04], [0.001, 1.04]], cloth, 0.68);
  body.add(pelvis);
  const waist = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.016, 6, 24), trim);
  waist.rotation.x = Math.PI / 2;
  waist.scale.y = 0.68;
  waist.position.y = 1.03;
  body.add(waist);
  // ---- 胴体：ウエストが細く、肩はばが広いV字。ノースリーブのユニフォーム ----
  const torso = lathe([[0.001, 0.98], [0.165, 0.98], [0.158, 1.1], [0.172, 1.22], [0.205, 1.34], [0.228, 1.44], [0.205, 1.52], [0.12, 1.585], [0.001, 1.595]], cloth, 0.6);
  body.add(torso);
  // むねのふくらみ・せなか（広背筋）
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), plain);
  chest.scale.set(0.19, 0.11, 0.075);
  chest.position.set(0, 1.37, 0.065);
  const lats = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), plain);
  lats.scale.set(0.2, 0.15, 0.07);
  lats.position.set(0, 1.33, -0.06);
  body.add(chest, lats);
  // 首のまわりの僧帽筋（ユニフォームから出ている）とえりぐり・そでぐりの線
  const traps = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), skin);
  traps.scale.set(0.15, 0.05, 0.075);
  traps.position.set(0, 1.565, -0.01);
  body.add(traps);
  const neckLine = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.011, 6, 20), trim);
  neckLine.rotation.x = Math.PI / 2 - 0.25;
  neckLine.scale.set(1, 0.75, 1);
  neckLine.position.set(0, 1.565, 0.02);
  body.add(neckLine);
  [-1, 1].forEach(sd => {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.011, 6, 18), trim);
    arm.rotation.y = Math.PI / 2;
    arm.scale.set(1, 1.2, 1);
    arm.position.set(sd * 0.2, 1.43, 0);
    body.add(arm);
  });
  // むね・せなかの背番号
  const numMat = new THREE.MeshStandardMaterial({ map: numberTexture(info.no, jersey, numFg), roughness: 0.85, transparent: false });
  // むねのふくらみ・広背筋より前に出す
  [[1, 0.28, 0.143], [-1, 0.36, 0.134]].forEach(([sd, size, z]) => {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(size, size), numMat);
    plate.position.set(0, sd > 0 ? 1.3 : 1.31, sd * z);
    if (sd < 0) plate.rotation.y = Math.PI;
    body.add(plate);
  });
  if (kit && kit.logo) {
    // むねのエンブレム（えりの下）
    const em = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075),
      new THREE.MeshStandardMaterial({ map: kit.logo, transparent: true, alphaTest: 0.3, roughness: 0.7 }));
    em.position.set(0, 1.475, 0.146);
    body.add(em);
  }
  // かた（三角筋）
  [-1, 1].forEach(sd => {
    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), ink.includes('rArm') && sd === 1 ? tat(9, 0, 0.75) : skin);
    delt.scale.set(1, 0.95, 1);
    delt.position.set(sd * 0.222, 1.475, 0);
    body.add(delt);
  });
  // ---- 腕（力こぶのある上腕→ひじ→前腕→手） ----
  const arms = [-1, 1].map(sd => {
    const sh = new THREE.Group();
    sh.position.set(sd * 0.24, 1.48, 0);
    const sleeve = ink.includes('rArm') && sd === 1; // ドリブルする腕
    const upperArm = limb([[0, 0.06], [0.2, 0.058], [0.45, 0.064], [0.75, 0.052], [1, 0.042]], 0.31, sleeve ? tat(1) : skin);
    upperArm.scale.z = 1.08;
    sh.add(upperArm);
    const el = new THREE.Group();
    el.position.y = -0.31;
    el.add(limb([[0, 0.044], [0.25, 0.05], [0.6, 0.04], [1, 0.03]], 0.27, sleeve ? tat(2, 0, 0.92) : skin));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), sty.mascot ? std(MASCOT.hand, 0.9) : skin);
    hand.scale.set(0.028, 0.07, 0.048);
    hand.position.y = -0.33;
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 2, 6), skin);
    thumb.position.set(0, -0.31, 0.04);
    thumb.rotation.x = 0.6;
    el.add(hand, thumb);
    if (sty.mascot) {
      // マスコット：大きめの手と、赤いリストバンド
      hand.scale.multiplyScalar(1.35);
      thumb.material = hand.material;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 14), std(MASCOT.band, 0.8));
      band.position.y = -0.255;
      el.add(band);
    }
    sh.add(el);
    if (sty.armLen) sh.scale.y = sty.armLen;
    body.add(sh);
    return { sh, el };
  });
  // ---- 首と頭 ----
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.066, 0.14, 14), skin);
  neck.position.y = 1.61;
  body.add(neck);
  const head = new THREE.Group();
  head.position.y = 1.75;
  const R = 0.108;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 18), skin);
  skull.scale.set(0.9, 1.1, 1);
  head.add(skull);
  // 髪（写真から：ボリューム・長い髪・坊主）
  const hairMat = std(face ? face.hair : '#1d1712', 0.95);
  // ヘッドバンドの選手は、頭にぴったりの黒いキャップ（ふくらませない）
  const vol = sty.headband ? 0 : face ? face.vol : 0.2;
  const capR = R * (sty.headband ? 1.015 : face && face.bald ? 1.005 : 1.04 + vol * 0.12);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capR * 1.004, 48, 16, 0, Math.PI * 2, 0, Math.PI * (0.34 + vol * 0.06)), hairMat);
  const back = new THREE.Mesh(new THREE.SphereGeometry(capR * 0.99, 24, 14, Math.PI, Math.PI, 0, Math.PI * 0.62), hairMat);
  [cap, back].forEach(m => { m.scale.copy(skull.scale); m.scale.y *= 1 + vol * 0.25; head.add(m); });
  if (sty.headband) {
    // ヘッドバンド：おでこの上をぐるっと1周
    const hb = new THREE.Mesh(new THREE.SphereGeometry(capR * 1.03, 40, 4, 0, Math.PI * 2, Math.PI * 0.27, Math.PI * 0.12),
      new THREE.MeshStandardMaterial({ color: sty.headband, roughness: 0.45, metalness: 0.05 }));
    hb.scale.copy(skull.scale);
    head.add(hb);
  }
  if (sty.braids) {
    // 長いブレイド：ヘッドバンドの下から、頭のうしろと横を通って肩までたれる
    const bm = std(sty.braids, 0.8);
    for (let i = 0; i < 26; i++) {
      const a = -1.6 + i * (3.2 / 25) + (rand() - 0.5) * 0.06; // 0 がまうしろ（顔の前にはかけない）
      const side = Math.sin(a), backz = -Math.cos(a);
      const len = 0.26 + rand() * 0.1 - Math.abs(side) * 0.06;
      const out = R * (1.0 + 0.1 * (1 - Math.abs(side)));
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * R * 0.92, 0.035, backz * R * 0.9),
        new THREE.Vector3(side * out * 1.06, -0.04, backz * out * 1.08),
        new THREE.Vector3(side * out * 1.12, -0.13, backz * out * 1.2),
        new THREE.Vector3(side * out * (1.2 + rand() * 0.1), -len, backz * out * (1.45 + rand() * 0.15)),
      ]);
      head.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.0085 + rand() * 0.002, 5), bm));
    }
  } else if (face && face.long) {
    // 肩までの長い髪（ドレッドなど）
    for (let i = 0; i < 11; i++) {
      // 頭のうしろ〜横（顔の前にはかからない）
      const a = -1.45 + i * 0.29;
      const lock = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.2, 6), hairMat);
      lock.position.set(Math.sin(a) * R * 0.95, -0.1, -Math.cos(a) * R * 0.92);
      lock.rotation.z = Math.sin(a) * 0.25;
      head.add(lock);
    }
  }
  // 耳
  [-1, 1].forEach(sd => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), skin);
    ear.scale.set(0.014, 0.03, 0.02);
    ear.position.set(sd * R * 0.9, -0.005, -0.005);
    head.add(ear);
  });
  if (sty.beard) {
    // ひげのボリューム：あごの下からほおの横まで
    const bd = new THREE.Mesh(new THREE.SphereGeometry(capR * 1.03, 32, 10, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.72, Math.PI * 0.22),
      new THREE.MeshStandardMaterial({ map: beardTexture(sty.beard), transparent: true, roughness: 0.9 }));
    bd.scale.copy(skull.scale);
    bd.scale.z *= 1.04;
    head.add(bd);
  }
  // 顔：顔写真を前だけに貼る（まゆ〜あご）
  if (face) {
    const fm = new THREE.Mesh(
      faceGeometry(capR + 0.003),
      new THREE.MeshStandardMaterial({ map: face.tex, transparent: true, roughness: 0.55 }),
    );
    fm.scale.copy(skull.scale);
    head.add(fm);
  }
  if (sty.mascot) {
    // 人の頭をはずして、マスコットの大きな頭にする
    head.clear();
    buildMascotHead(head, sty.mascot);
    head.position.y = 1.82;
  }
  body.add(head);
  // 足もとの影
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * VIS, 20),
    new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(info.no, badgeColor), depthWrite: false }));
  // スマホ（指で操作する画面）は背番号を 32% 大きく。ピンの先が頭の少し上に来る位置に置く
  const bk = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 1.32 : 1;
  badge.scale.set(0.42 * bk, 0.525 * bk, 1);
  badge.position.y = h * VIS + 0.24 + 0.525 * bk * (62 / 160);
  badge.renderOrder = 5;
  root.add(badge);
  return { root, body, legs, arms, head, shadow, badge, height: h * VIS, realH: h, sty };
}

// ボールの絵：オレンジの革に細かいつぶつぶ、黒いみぞ（横・たての線と、2本のカーブ）
function ballTextures() {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas'), bv = document.createElement('canvas');
  cv.width = bv.width = W; cv.height = bv.height = H;
  const g = cv.getContext('2d'), gb = bv.getContext('2d');
  const img = g.createImageData(W, H), bump = gb.createImageData(W, H);
  const C = Math.cos(Math.PI / 3); // カーブのみぞ：x 軸から 60度の円
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = x / W * Math.PI * 2;
      // 球の上の向き（three.js の SphereGeometry と同じとり方）
      const dx = -Math.cos(lon) * Math.cos(lat), dy = Math.sin(lat), dz = Math.sin(lon) * Math.cos(lat);
      const seam = Math.min(Math.abs(dy), Math.abs(dz), Math.abs(Math.abs(dx) - C));
      const groove = seam < 0.018;
      const n = (Math.random() - 0.5) * 18;
      const pebble = Math.random() < 0.18 ? -22 : 0; // つぶつぶ
      const i = (y * W + x) * 4;
      if (groove) {
        img.data[i] = 22; img.data[i + 1] = 14; img.data[i + 2] = 10;
        bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = 40;
      } else {
        img.data[i] = clamp(212 + n + pebble, 0, 255); img.data[i + 1] = clamp(96 + n * 0.6 + pebble * 0.6, 0, 255); img.data[i + 2] = clamp(34 + n * 0.3, 0, 255);
        const v = pebble ? 150 : 200 + n;
        bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = v;
      }
      img.data[i + 3] = bump.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gb.putImageData(bump, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, bump: new THREE.CanvasTexture(bv) };
}

// ゴール：ガラスのボード（白いふち・白い四角）、下のパッド、上のショットクロック、
// 太いリングと取りつけ金具、ひし形にあんだネット、パッドつきの台と支柱
function buildHoop(scene, d) {
  const g = new THREE.Group();
  const std = (color, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const white = std('#f4f6f8', 0.5), dark = std('#1c1f26', 0.7), pad = std('#23262e', 0.85), steel = std('#8a919c', 0.35, 0.7);
  const box = (w, h, dp, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mat); m.position.set(x, y, z); g.add(m); return m; };
  const BX = d * (LEN - 1.2);                  // ボードの面
  const BY = 2.9 + 1.05 / 2;                   // ボードのまん中の高さ（下のふちが 2.9m）
  // ---- 台と支柱 ----
  const baseX = d * (LEN + 1.9);
  box(1.3, 0.9, 1.4, pad, baseX, 0.45, 0);                     // 台（パッド）
  // 台の白いライン。台の上の面と同じ高さにするとちらつくので、少し下げて少し大きくする
  box(1.34, 0.12, 1.44, std('#ffffff', 0.6), baseX, 0.8, 0);
  box(0.32, 3.2, 0.32, pad, baseX - d * 0.35, 2.3, 0);         // 支柱
  // 支柱からボードのうしろへのびるアーム（ななめ）
  const armL = Math.abs(baseX - d * 0.35 - (BX + d * 0.15));
  const arm = box(armL, 0.16, 0.16, steel, (baseX - d * 0.35 + BX + d * 0.15) / 2, 3.75, 0);
  arm.rotation.z = d * 0.06;
  box(0.04, 0.12, 0.3, steel, BX + d * 0.1, BY + 0.45, 0);     // ボードのうしろの金具（上のほうだけ）
  // ---- ボード ----
  const glass = new THREE.MeshStandardMaterial({ color: '#dff0ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
  box(0.03, 1.05, 1.8, glass, BX, BY, 0);
  const fx = BX - d * 0.02;                                    // ガラスの前に白い線
  box(0.01, 0.05, 1.8, white, fx, BY + 0.5, 0);
  box(0.01, 0.05, 1.8, white, fx, BY - 0.5, 0);
  box(0.01, 1.05, 0.05, white, fx, BY, 0.875);
  box(0.01, 1.05, 0.05, white, fx, BY, -0.875);
  // 白い四角（はば 59cm・高さ 45cm、下の線はリングの少し上）
  const sqB = RIM_Y + 0.15, sqT = sqB + 0.45;
  box(0.01, 0.05, 0.59, white, fx, sqT - 0.025, 0);
  box(0.01, 0.05, 0.59, white, fx, sqB + 0.025, 0);
  box(0.01, 0.45, 0.05, white, fx, (sqB + sqT) / 2, 0.27);
  box(0.01, 0.45, 0.05, white, fx, (sqB + sqT) / 2, -0.27);
  box(0.1, 0.08, 1.84, pad, BX, 2.86, 0);                      // 下のパッド
  // ---- ショットクロック（ボードの上） ----
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const cg = cv.getContext('2d');
  const clockTex = new THREE.CanvasTexture(cv);
  clockTex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false });
  const clock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, 0.5), [dark, face, dark, dark, dark, dark]);
  if (d < 0) clock.material = [face, dark, dark, dark, dark, dark];
  clock.position.set(BX + d * 0.03, BY + 0.68, 0);
  g.add(clock);
  let shown = null;
  const setClock = n => {
    if (n === shown) return;
    shown = n;
    cg.fillStyle = '#050505'; cg.fillRect(0, 0, 128, 64);
    cg.fillStyle = n <= 5 ? '#ff2a1a' : '#ff5a1f';
    cg.font = '600 58px "Teko", "Arial Black", sans-serif';
    cg.textAlign = 'center'; cg.textBaseline = 'middle';
    cg.fillText(String(n), 64, 36);
    clockTex.needsUpdate = true;
  };
  setClock(24);
  // ---- リング（取りつけ金具ごとゆれる） ----
  const rim = new THREE.Group();
  rim.position.set(d * HX, RIM_Y, 0);
  const orange = std('#ff4b12', 0.4, 0.35);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.011, 10, 40), orange);
  ring.rotation.x = Math.PI / 2;
  rim.add(ring);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.12), orange);
  bracket.position.set(d * 0.3, -0.01, 0);
  rim.add(bracket);
  // ネットをかけるフック
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), orange);
    h.position.set(Math.cos(a) * 0.228, -0.018, Math.sin(a) * 0.228);
    rim.add(h);
  }
  g.add(rim);
  // ---- ネット（ひし形のあみ目）。上のはしがリングで、下へのびる ----
  const N = 12, ROWS = 5, TOP = 0.226, BOT = 0.15, LEN_N = 0.42;
  const knot = (r, i) => {
    const t = r / ROWS;
    const rad = TOP + (BOT - TOP) * Math.sqrt(t);
    const a = (i + (r % 2) * 0.5) / N * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * rad, -t * LEN_N, Math.sin(a) * rad);
  };
  const parts = [];
  const string = (a, b) => {
    const len = a.distanceTo(b);
    const c = new THREE.CylinderGeometry(0.0045, 0.0045, len, 4, 1, true);
    c.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    c.applyQuaternion(q);
    c.translate(a.x, a.y, a.z);
    parts.push(c);
  };
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < N; i++) {
      const a = knot(r, i);
      // 1つ下の段の、となり2つの結び目へ
      const j0 = r % 2 ? i : i - 1, j1 = r % 2 ? i + 1 : i;
      string(a, knot(r + 1, (j0 + N) % N));
      string(a, knot(r + 1, j1 % N));
    }
  }
  // 下のはしの輪
  for (let i = 0; i < N; i++) string(knot(ROWS, i), knot(ROWS, (i + 1) % N));
  const net = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }));
  net.position.set(d * HX, RIM_Y - 0.02, 0);
  g.add(net);
  scene.add(g);
  return { net, rim, setClock };
}

function buildArena(scene, homeColor, ribbonItems, venue) {
  // 客席：下の段（7列）と上の段（7列）。あいだにリボンボード（LED）。通路・階段・手すりもある
  const bud = venue === 'budokan';
  const seatMat = new THREE.MeshStandardMaterial({ color: bud ? '#202328' : '#2346a0', roughness: 0.6 });
  const riser = new THREE.MeshLambertMaterial({ color: bud ? '#14161a' : '#151c30' });
  const stepMat = new THREE.MeshLambertMaterial({ color: '#59606e' });
  const metal = bud ? new THREE.MeshStandardMaterial({ color: homeColor, roughness: 0.4, metalness: 0.3 })
    : new THREE.MeshStandardMaterial({ color: '#c9ced8', roughness: 0.35, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#cfe3ff', transparent: true, opacity: 0.18, roughness: 0.1 });
  const chairs = [];
  const people = [];
  const ribbons = [];
  // 手前（カメラのうしろ）の客席：オープニングでアリーナ全体を見せるときだけ使う
  const nearGroup = new THREE.Group();
  const nearChairs = [], nearPeople = [];
  const AISLE = 7.5; // 通路の間かく（m）
  const sections = [
    // [中心x, 中心z, 長さ, 横向きか, 観客の向き, 前からはなれる向き(x, z)]
    [0, -WID, 38, 0, 0, [0, -1]],
    [LEN + 0.6, 0, 26, 1, -Math.PI / 2, [1, 0]],
    [-(LEN + 0.6), 0, 26, 1, Math.PI / 2, [-1, 0]],
  ];
  if (bud) sections.push([0, WID, 38, 0, Math.PI, [0, 1], true]);
  sections.forEach(([cx, cz, len0, side, rot, [ox, oz], near]) => {
    const [scn, chs, pps] = near ? [nearGroup, nearChairs, nearPeople] : [scene, chairs, people];
    for (let row = 0; row < 14; row++) {
      const scene = scn, chairs = chs, people = pps; // 手前の客席は別のグループへ
      const upper = row >= 7;
      const y = 0.9 + row * 0.5 + (upper ? 1.3 : 0) + (near ? 0.6 : 0);
      const off = 3.4 + row * 0.85 + (upper ? 0.9 : 0) + (near ? 1.7 : 0);
      const len = len0 + row * 2;
      const x = cx + ox * off, z = cz + oz * off;
      // 段（床）と立ち上がりの壁
      const step = new THREE.Mesh(new THREE.BoxGeometry(side ? 0.85 : len, 0.1, side ? len : 0.85), riser);
      step.position.set(x, y - 0.05, z);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(side ? 0.85 : len, Math.max(y - 0.1, 0.05), side ? len : 0.85), riser);
      wall.position.set(x, (y - 0.1) / 2, z);
      scene.add(step, wall);
      for (let t = -len / 2 + 0.25; t < len / 2; t += 0.5) {
        // 通路（階段）
        const a = ((t + 200) % AISLE);
        if (a < 1.1) {
          if (a < 0.5) {
            const st = new THREE.Mesh(new THREE.BoxGeometry(side ? 0.85 : 1.0, 0.25, side ? 1.0 : 0.85), stepMat);
            st.position.set(side ? x : t + 0.3, y - 0.12, side ? t + 0.3 : z);
            scene.add(st);
          }
          continue;
        }
        const pos = { x: side ? x : t, y, z: side ? t : z, rot };
        chairs.push(pos);
        // 1割くらいは空席。武道館は写真のように、下の段は6割・上の段は3〜4割くらいの入り
        if (rand() < (bud ? (near ? 0.5 : upper ? 0.36 : 0.62) : 0.9)) people.push(pos);
      }
      // 各段の一番前に手すりとガラス
      if (row === 0 || row === 7) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(side ? 0.05 : len, 0.05, side ? len : 0.05), metal);
        const fx = x - ox * 0.5, fz = z - oz * 0.5;
        rail.position.set(fx, y + 0.95, fz);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(side ? 0.02 : len, 0.85, side ? len : 0.02), glass);
        pane.position.set(fx, y + 0.5, fz);
        scene.add(rail, pane);
      }
      // 下の段と上の段のあいだのリボンボード
      if (row === 7) {
        const tex = ledTexture(ribbonItems);
        tex.repeat.set(side ? 1.5 : 2.5, 1);
        const rib = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.9), new THREE.MeshBasicMaterial({ map: tex }));
        rib.position.set(x - ox * 0.48, y - 0.75, z - oz * 0.48);
        rib.rotation.y = rot;
        scene.add(rib);
        ribbons.push(tex);
      }
    }
  });
  // 手前のコートサイド席（低い2列）
  for (let row = 0; row < 2; row++) {
    const y = 0.35 + row * 0.4, z = WID + 3.4 + row * 0.9;
    const step = new THREE.Mesh(new THREE.BoxGeometry(30, Math.max(y, 0.05), 0.9), riser);
    step.position.set(0, y / 2, z);
    scene.add(step);
    for (let t = -14.75; t < 15; t += 0.5) {
      const pos = { x: t, y, z, rot: Math.PI };
      chairs.push(pos);
      if (rand() < (bud ? 0.7 : 0.85)) people.push(pos);
    }
  }
  // 武道館の観客の服：半分くらいはチームの緑、あとは黒・白・灰色・紺・茶などの落ちついた色
  const pal = bud ? ['#1b1c1f', '#26282d', '#3a3d44', '#f1f1ef', '#dcdcd8', '#9a9ea6', '#1f2f4f', '#3b2d24', '#5a6a7a', '#7d1f2a'] : null;
  const crowd = new Crowd(scene, people, chairs, homeColor, seatMat, bud ? 0.5 : 0.42, pal);
  if (bud) {
    scene.add(nearGroup);
    crowd.near = { group: nearGroup, crowd: new Crowd(nearGroup, nearPeople, nearChairs, homeColor, seatMat, 0.5, pal) };
  }
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshLambertMaterial({ color: bud ? '#0c0d10' : '#10141f' }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  scene.add(apron);
  crowd.ribbons = ribbons;
  return crowd;
}

// ---------- 横浜武道館（横浜エクセレンスのホーム） ----------
// 黒い天井にLEDライトが4つずつならび、鉄のトラス、まん中につり下げの大型ビジョン、
// 木のルーバー（たて板）の壁、エンドの壁に大きなチームフラッグ
const VENUES = { '714': 'budokan' };

function woodWallTexture(woodOn = true) {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  // いちばん下：暗いコンコース（通路）と小さなあかり
  const band = H * 0.16;
  g.fillStyle = '#0b0c0f';
  g.fillRect(0, H - band, W, band);
  for (let x = 20; x < W; x += 64) {
    g.fillStyle = 'rgba(255,214,160,.5)';
    g.fillRect(x, H - band * 0.62, 26, band * 0.22);
  }
  // まん中：木のたて板（写真のエンドの壁）。長いほうのかべは灰色だけ
  const woodTop = woodOn ? H * 0.42 : H - band;
  g.fillStyle = '#26170d';
  g.fillRect(0, woodTop, W, H - band - woodTop);
  for (let x = 0; x < W; x += 12) {
    const l = 38 + Math.random() * 10;
    const gr = g.createLinearGradient(0, woodTop, 0, H - band);
    gr.addColorStop(0, `hsl(28 40% ${l - 6}%)`);
    gr.addColorStop(1, `hsl(28 44% ${l - 12}%)`);
    g.fillStyle = gr;
    g.fillRect(x, woodTop, 8, H - band - woodTop);
  }
  // 上：灰色のコンクリートのかべ。つなぎ目の線と、横に長い明かりの帯
  const gr = g.createLinearGradient(0, 0, 0, woodTop);
  gr.addColorStop(0, '#2a2c30');
  gr.addColorStop(1, '#55585e');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, woodTop);
  g.fillStyle = 'rgba(0,0,0,.25)';
  for (let x = 0; x < W; x += 128) g.fillRect(x, 0, 3, woodTop);
  g.fillRect(0, woodTop * 0.5, W, 3);
  g.fillStyle = 'rgba(255,244,220,.55)';
  g.fillRect(0, woodTop * 0.18, W, 6);
  g.fillStyle = '#1a1b1e';
  g.fillRect(0, woodTop - 8, W, 8);
  // 天井ぎわの影
  const sh = g.createLinearGradient(0, 0, 0, H * 0.12);
  sh.addColorStop(0, 'rgba(0,0,0,.8)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, W, H * 0.12);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,250,235,.55)');
  gr.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// チームフラッグ（エンドの壁につるす）
function bannerTexture(color, logo) {
  const W = 400, H = 620;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, new THREE.Color(color).offsetHSL(0, 0, 0.06).getStyle());
  gr.addColorStop(1, new THREE.Color(color).offsetHSL(0, 0, -0.06).getStyle());
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineWidth = 6;
  g.strokeRect(18, 18, W - 36, H - 36);
  if (logo) {
    // ロゴを白く（フラッグの絵のように）
    const lc = document.createElement('canvas');
    lc.width = lc.height = 300;
    const lg = lc.getContext('2d');
    lg.drawImage(logo, 0, 0, 300, 300);
    lg.globalCompositeOperation = 'source-in';
    lg.fillStyle = '#ffffff';
    lg.fillRect(0, 0, 300, 300);
    g.drawImage(lc, 50, 130, 300, 300);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 鉄のトラス（四角い骨組み）。a, b は [x, z]
function addTruss(group, a, b, y, mat, lineMat) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = new THREE.Group();
  t.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
  t.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  const S = 0.22;
  [[-S, -S], [-S, S], [S, -S], [S, S]].forEach(([yy, zz]) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, 0.05), mat);
    c.position.set(0, yy, zz);
    t.add(c);
  });
  const pts = [];
  const n = Math.max(2, Math.round(L / 0.45));
  for (let i = 0; i < n; i++) {
    const x0 = -L / 2 + i * L / n, x1 = x0 + L / n, f = i % 2 ? 1 : -1;
    pts.push(x0, -S * f, -S, x1, S * f, -S, x0, -S * f, S, x1, S * f, S, x0, -S, -S * f, x1, -S, S * f, x0, S, -S * f, x1, S, S * f);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  t.add(new THREE.LineSegments(geo, lineMat));
  group.add(t);
}

function clockText(st) {
  return `${Math.floor(st.clock / 60)}:${String(Math.ceil(st.clock % 60) === 60 ? 59 : Math.floor(st.clock % 60)).padStart(2, '0')}`;
}

function buildBudokan(scene, home, away, homeC, awayC, logo) {
  const g = new THREE.Group();
  scene.add(g);
  const CEIL = 18.5;
  // 天井（黒）
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(66, 54), new THREE.MeshBasicMaterial({ color: '#07080a' }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = CEIL;
  g.add(ceil);
  // 木のたて板の壁（4面）
  const wood = woodWallTexture(), gray = woodWallTexture(false);
  [[0, -25.4, 64, 0], [0, 25.4, 64, Math.PI], [-31, 0, 52, Math.PI / 2], [31, 0, 52, -Math.PI / 2]].forEach(([x, z, len, rot]) => {
    const t = (Math.abs(rot) < 0.01 || Math.abs(rot - Math.PI) < 0.01 ? gray : wood).clone();
    t.needsUpdate = true;
    t.repeat.set(len / 9, 1);
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, CEIL - 7.6), new THREE.MeshBasicMaterial({ map: t }));
    w.position.set(x, 7.6 + (CEIL - 7.6) / 2, z);
    w.rotation.y = rot;
    g.add(w);
  });
  // 天井のLEDライト：4つずつのかたまりが、ごばんの目のようにならぶ
  const discs = [], glows = [];
  for (let x = -27; x <= 27.1; x += 4.5) {
    for (let z = -22.5; z <= 18.1; z += 4.5) {
      if (Math.abs(x) < 5 && Math.abs(z) < 4) continue; // 大型ビジョンのところはなし
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => discs.push([x + a * 0.3, CEIL - 0.05, z + b * 0.3]));
      glows.push([x, CEIL - 0.1, z, 1.9]);
    }
  }
  // トラスに下がるライト
  [-9, 9].forEach(z => { for (let x = -22; x <= 22; x += 2.75) { discs.push([x, 15.7, z]); glows.push([x, 15.65, z, 0.9]); } });
  const discGeo = new THREE.CircleGeometry(0.15, 10);
  discGeo.rotateX(Math.PI / 2);
  const discM = new THREE.InstancedMesh(discGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), discs.length);
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  glowGeo.rotateX(Math.PI / 2);
  const glowM = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), glows.length);
  const d = new THREE.Object3D();
  discs.forEach(([x, y, z], i) => { d.position.set(x, y, z); d.scale.setScalar(1); d.updateMatrix(); discM.setMatrixAt(i, d.matrix); });
  glows.forEach(([x, y, z, s], i) => { d.position.set(x, y, z); d.scale.setScalar(s); d.updateMatrix(); glowM.setMatrixAt(i, d.matrix); });
  g.add(discM, glowM);
  // トラス：大型ビジョンのまわりの四角と、長い2本
  const steel = new THREE.MeshStandardMaterial({ color: '#b9bec8', roughness: 0.4, metalness: 0.7 });
  const steelLine = new THREE.LineBasicMaterial({ color: '#8d939e' });
  addTruss(g, [-6.5, -4], [6.5, -4], 15.9, steel, steelLine);
  addTruss(g, [-6.5, 4], [6.5, 4], 15.9, steel, steelLine);
  addTruss(g, [-6.5, -4], [-6.5, 4], 15.9, steel, steelLine);
  addTruss(g, [6.5, -4], [6.5, 4], 15.9, steel, steelLine);
  addTruss(g, [-23, -9], [23, -9], 16, steel, steelLine);
  addTruss(g, [-23, 9], [23, 9], 16, steel, steelLine);
  // 天井をよこぎる大きなトラス（写真のように何本もわたっている）
  [-17, -8.5, 8.5, 17].forEach(x => addTruss(g, [x, -21], [x, 19], 17.2, steel, steelLine));
  addTruss(g, [-26, -16], [26, -16], 17.6, steel, steelLine);
  addTruss(g, [-26, 15], [26, 15], 17.6, steel, steelLine);
  addTruss(g, [-24, -18], [-6, 4], 16.8, steel, steelLine);
  addTruss(g, [24, -18], [6, 4], 16.8, steel, steelLine);
  // トラスを天井からつるワイヤー
  const wires = [];
  [[-6.5, -4], [6.5, -4], [-6.5, 4], [6.5, 4], [-23, -9], [0, -9], [23, -9], [-23, 9], [0, 9], [23, 9]]
    .forEach(([x, z]) => wires.push(x, 16.1, z, x, CEIL, z));
  // ---- まん中につり下げた大型ビジョン ----
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 512;
  const cg = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const scr = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const frame = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.5, metalness: 0.4 });
  const JY = 12.4;
  // 中の黒い箱と、長いほう（±z）に向いた2面ずつの画面
  const core = new THREE.Mesh(new THREE.BoxGeometry(6.8, 2.6, 2.4), frame);
  core.position.set(0, JY, 0);
  g.add(core);
  [-1, 1].forEach(sz => [-1, 1].forEach(sx => {
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.1), scr);
    sc.position.set(sx * 1.68, JY, sz * 1.28);
    sc.rotation.y = sz > 0 ? sx * 0.1 : Math.PI - sx * 0.1; // 少しだけ外向きに
    g.add(sc);
    const bez = new THREE.Mesh(new THREE.BoxGeometry(3.36, 2.26, 0.08), frame);
    bez.position.set(sx * 1.68, JY, sz * 1.18);
    bez.rotation.y = sc.rotation.y;
    g.add(bez);
  }));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.14, 2.6), new THREE.MeshBasicMaterial({ color: homeC, toneMapped: false }));
  strip.position.set(0, JY - 1.25, 0);
  g.add(strip);
  // 画面をかこむ鉄のわく（上と下）
  const steelF = new THREE.MeshStandardMaterial({ color: '#9aa1ab', roughness: 0.4, metalness: 0.7 });
  const lineF = new THREE.LineBasicMaterial({ color: '#7d848f' });
  [JY + 1.45, JY - 1.45].forEach(y => {
    addTruss(g, [-3.7, -1.6], [3.7, -1.6], y, steelF, lineF);
    addTruss(g, [-3.7, 1.6], [3.7, 1.6], y, steelF, lineF);
    addTruss(g, [-3.7, -1.6], [-3.7, 1.6], y, steelF, lineF);
    addTruss(g, [3.7, -1.6], [3.7, 1.6], y, steelF, lineF);
  });
  [[-3.7, -1.6], [3.7, -1.6], [-3.7, 1.6], [3.7, 1.6]].forEach(([x, z]) => wires.push(x, JY + 1.7, z, x * 1.6, 15.7, z * 2.4));
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  g.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#2a2e36' })));
  let last = '';
  const draw = (st, shot) => {
    const key = st.score.join('-') + st.q + clockText(st) + shot;
    if (key === last) return;
    last = key;
    cg.fillStyle = '#04060a';
    cg.fillRect(0, 0, 1024, 512);
    cg.textAlign = 'center'; cg.textBaseline = 'middle';
    [[home, homeC, 16, 0], [away, awayC, 708, 1]].forEach(([t, c, x, sd]) => {
      const gr = cg.createLinearGradient(0, 16, 0, 496);
      gr.addColorStop(0, new THREE.Color(c).offsetHSL(0, 0, 0.08).getStyle());
      gr.addColorStop(1, new THREE.Color(c).offsetHSL(0, 0, -0.1).getStyle());
      cg.fillStyle = gr;
      cg.fillRect(x, 16, 300, 480);
      cg.fillStyle = '#ffffff';
      cg.font = '900 50px "Zen Kaku Gothic New", sans-serif';
      cg.fillText(t.short, x + 150, 80);
      cg.font = '600 250px "Teko", "Arial Black", sans-serif';
      cg.fillText(String(st.score[sd]), x + 150, 320);
    });
    cg.fillStyle = '#9fe7c0';
    cg.font = '600 46px "Teko", sans-serif';
    cg.fillText('YOKOHAMA BUDOKAN', 512, 64);
    cg.fillStyle = '#ffffff';
    cg.font = '600 110px "Teko", sans-serif';
    cg.fillText(st.q > 4 ? 'OT' : st.q + 'Q', 512, 180);
    cg.font = '600 150px "Teko", sans-serif';
    cg.fillText(clockText(st), 512, 320);
    cg.fillStyle = shot < 6 ? '#ff5a4a' : '#ffc94a';
    cg.font = '600 90px "Teko", sans-serif';
    cg.fillText(String(shot), 512, 440);
    tex.needsUpdate = true;
  };
  // ---- エンドの壁のチームフラッグ ----
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 7.1), new THREE.MeshBasicMaterial({ map: bannerTexture(homeC, logo) }));
  ban.position.set(-30.85, 12.4, -7);
  ban.rotation.y = Math.PI / 2;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 8), steel);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(-30.8, 16, -7);
  g.add(ban, bar);
  return { draw };
}

// LEDボード（奥と手前）と記録席
function buildBoards(scene, home, away, homeC, awayC) {
  const items = [
    [homeC, '#ffffff', home.short], ['#0d1220', '#ffd23f', 'Bリーグ STORM'], ['#c8102e', '#ffffff', 'DEFENSE!'],
    [awayC, '#ffffff', away.short], ['#0d1220', '#ffffff', '2026-27 SEASON'], [homeC, '#ffffff', 'GO ' + home.short + '!'],
  ];
  const tex = ledTexture(items);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const dark = new THREE.MeshLambertMaterial({ color: '#0b0e16' });
  const boards = [];
  [[-(WID + 2.5), 0.9, 0], [WID + 2.6, 0.75, Math.PI]].forEach(([z, h, rot]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(32, h, 0.25), [dark, dark, dark, dark, mat, dark]);
    b.position.set(0, h / 2, z);
    b.rotation.y = rot;
    scene.add(b);
    boards.push(b);
  });
  tex.repeat.set(3, 1);
  // 記録席（奥のセンター）
  const table = new THREE.Mesh(new THREE.BoxGeometry(7, 0.85, 0.7), [dark, dark, dark, dark,
    new THREE.MeshBasicMaterial({ map: ledTexture([[homeC, '#ffffff', home.short + '  vs  ' + away.short]]) }), dark]);
  table.position.set(0, 0.43, -(WID + 1.55));
  scene.add(table);
  return { tex };
}

// 観客：選手と同じように、まるい頭・髪・胴体・腕のある人。点が入ると立ち上がって手を上げる
// 観客の顔（白目・黒目・まゆ・鼻のかげ・口）。まわりは透明
function crowdFaceTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  [-1, 1].forEach(sd => {
    const cx = 32 + sd * 11;
    g.fillStyle = '#f3efe8';
    g.beginPath(); g.ellipse(cx, 30, 6, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2618';
    g.beginPath(); g.arc(cx, 30, 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0c0806';
    g.beginPath(); g.arc(cx, 30, 1.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,20,12,.85)'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(cx - 7, 23 - sd * 0); g.quadraticCurveTo(cx, 20, cx + 7, 23); g.stroke();
  });
  g.strokeStyle = 'rgba(60,35,25,.45)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 33); g.lineTo(30, 42); g.lineTo(34, 43); g.stroke();
  g.strokeStyle = 'rgba(120,40,40,.8)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(25, 50); g.quadraticCurveTo(32, 54, 39, 50); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Crowd {
  constructor(scene, seats, chairs, homeColor, seatMat, fanRate = 0.42, palette = null) {
    const n = seats.length;
    const std = () => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    const mk = (geo, count, mat = std()) => { const m = new THREE.InstancedMesh(geo, mat, count); scene.add(m); return m; };
    // 座席（座面と背もたれ）。空席も見える
    const seatGeo = new THREE.BoxGeometry(0.44, 0.08, 0.4);
    seatGeo.translate(0, -0.02, 0.02);
    const backGeo = new THREE.BoxGeometry(0.44, 0.42, 0.06);
    backGeo.translate(0, 0.2, -0.2);
    const seatM = new THREE.InstancedMesh(seatGeo, seatMat, chairs.length);
    const backM = new THREE.InstancedMesh(backGeo, seatMat, chairs.length);
    const dd = new THREE.Object3D();
    chairs.forEach((c, i) => {
      dd.position.set(c.x, c.y, c.z);
      dd.rotation.set(0, c.rot, 0);
      dd.updateMatrix();
      seatM.setMatrixAt(i, dd.matrix);
      backM.setMatrixAt(i, dd.matrix);
    });
    scene.add(seatM, backM);
    // 応援タオル（点が入るとかかげる）
    this.towel = mk(new THREE.BoxGeometry(0.55, 0.2, 0.01), n, new THREE.MeshStandardMaterial({ color: homeColor, roughness: 0.9 }));
    // 胴体（Tシャツ）：ウエストが細く、肩がまるい
    const torso = new THREE.LatheGeometry([[0.001, 0], [0.15, 0], [0.165, 0.2], [0.185, 0.4], [0.17, 0.5], [0.1, 0.56], [0.001, 0.57]]
      .map(([r, y]) => new THREE.Vector2(r, y)), 7);
    torso.scale(1, 1, 0.62);
    const head = new THREE.SphereGeometry(0.1, 8, 6);
    head.scale(0.9, 1.08, 0.98);
    const hair = new THREE.SphereGeometry(0.106, 8, 2, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hair.scale(0.92, 1.1, 1);
    const longHair = new THREE.CapsuleGeometry(0.075, 0.16, 1, 6);
    longHair.scale(1.15, 1, 0.55);
    const arm = new THREE.CapsuleGeometry(0.045, 0.3, 1, 6);
    arm.translate(0, -0.18, 0); // 肩が回る中心になるように
    const sleeve = new THREE.CylinderGeometry(0.058, 0.055, 0.12, 6, 1, true);
    sleeve.translate(0, -0.05, 0);
    const neck = new THREE.CylinderGeometry(0.04, 0.045, 0.08, 6, 1, true);
    this.body = mk(torso, n);
    this.neck = mk(neck, n);
    this.head = mk(head, n);
    this.hair = mk(hair, n);
    this.long = mk(longHair, n);
    this.arm = mk(arm, n * 2);
    this.sleeve = mk(sleeve, n * 2);
    const faceGeo = new THREE.PlaneGeometry(0.15, 0.15);
    this.eye = mk(faceGeo, n, new THREE.MeshBasicMaterial({ map: crowdFaceTexture(), transparent: true, alphaTest: 0.3 }));
    const SKIN = ['#f1c9a5', '#e8b892', '#d9a07a', '#c68e64', '#a26a42', '#7a4b2c', '#f6d7bd', '#e0ac82'];
    const HAIR = ['#111111', '#1d1510', '#2b1d12', '#3a2618', '#4a3020', '#7a5230', '#c9a25a', '#8c8c8c'];
    const home = new THREE.Color(homeColor);
    const c = new THREE.Color();
    this.people = seats.map((st, i) => {
      // 4割くらいはホームのチームカラーのTシャツ
      const shirt = rand() < fanRate ? home.clone().offsetHSL(0, (rand() - 0.5) * 0.1, (palette ? 0.06 : 0) + (rand() - 0.5) * 0.15)
        : palette ? new THREE.Color(palette[Math.floor(rand() * palette.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.06)
          : c.clone().setHSL(rand(), 0.25 + rand() * 0.5, 0.3 + rand() * 0.45);
      const skin = new THREE.Color(SKIN[Math.floor(rand() * SKIN.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.05);
      const hairC = rand() < 0.08 ? shirt : new THREE.Color(HAIR[Math.floor(rand() * HAIR.length)]);
      this.body.setColorAt(i, shirt);
      this.sleeve.setColorAt(i * 2, shirt);
      this.sleeve.setColorAt(i * 2 + 1, shirt);
      this.arm.setColorAt(i * 2, skin);
      this.arm.setColorAt(i * 2 + 1, skin);
      this.neck.setColorAt(i, skin);
      this.head.setColorAt(i, skin);
      this.hair.setColorAt(i, hairC);
      this.long.setColorAt(i, hairC);
      return {
        ...st, k: rand(), phase: rand() * 6, fan: rand() < 0.6,
        size: 0.92 + rand() * 0.16, longHair: rand() < 0.3, bald: rand() < 0.06, towel: rand() < 0.35, yaw: 0,
      };
    });
    this.excite = 0;
    this.home = true;
    this.time = 0;
    this.calm = false;
    this.dummy = new THREE.Object3D();
    this.dummy.rotation.order = 'YXZ';
    this.update(0, true);
    [this.body, this.neck, this.head, this.hair, this.long, this.arm, this.sleeve].forEach(m => { m.instanceColor.needsUpdate = true; });
  }

  // 観客はボールのほうを見る
  look(x, z) { this.ballX = x; this.ballZ = z; }

  // 歓声をあげる（power 0〜1。home=false なら相手の得点でアウェイのファンだけ）
  cheer(power, home = true) {
    this.excite = Math.max(this.excite, power);
    this.home = home;
  }

  update(dt, force) {
    this.time += dt;
    this.excite *= Math.exp(-dt / 1.6);
    // しずかなときも、ときどき首の向き（ボールを見る）を更新する
    this.lookT = (this.lookT || 0) + dt;
    if (this.excite < 0.02 && this.calm && !force && this.lookT < 0.35) return;
    this.lookT = 0;
    this.calm = this.excite < 0.02;
    const bx = this.ballX || 0, bz = this.ballZ || 0;
    const d = this.dummy;
    // 席の向きに合わせて置く（x:横 y:高さ z:前）。rx:前後のかたむき rz:横のかたむき sc:大きさ
    const set = (mesh, idx, p, x, y, z, rx = 0, rz = 0, sc = 1, yaw = 0) => {
      const k = p.size;
      const cs = Math.cos(p.rot), sn = Math.sin(p.rot);
      x *= k; y *= k; z *= k;
      d.position.set(p.x + x * cs + z * sn, p.y + y, p.z - x * sn + z * cs);
      d.rotation.set(rx, p.rot + yaw, rz);
      d.scale.setScalar(k * sc);
      d.updateMatrix();
      mesh.setMatrixAt(idx, d.matrix);
    };
    this.people.forEach((p, i) => {
      // ボールへの向き（席の正面からどれだけ首をまわすか）
      let want = Math.atan2(bx - p.x, bz - p.z) - p.rot;
      want = clamp(Math.atan2(Math.sin(want), Math.cos(want)), -0.9, 0.9);
      p.yaw += (want - p.yaw) * 0.5;
      const yc = Math.cos(p.yaw), ys = Math.sin(p.yaw);
      const active = this.excite > 0.02 && p.k < this.excite * (this.home ? 1 : 0.25) && (this.home ? p.fan : !p.fan);
      const j = active ? Math.abs(Math.sin(this.time * 9 + p.phase)) * 0.18 : 0;
      set(this.body, i, p, 0, 0 + j, 0);
      set(this.neck, i, p, 0, 0.6 + j, 0);
      set(this.head, i, p, 0, 0.72 + j, 0, 0, 0, 1, p.yaw);
      set(this.hair, i, p, 0, 0.735 + j, -0.004, 0, 0, p.bald ? 0 : 1, p.yaw);
      set(this.long, i, p, -0.07 * ys, 0.66 + j, -0.07 * yc, 0, 0, p.longHair && !p.bald ? 1 : 0, p.yaw);
      set(this.eye, i, p, 0.094 * ys, 0.715 + j, 0.094 * yc, 0, 0, 1, p.yaw);
      // 応援タオル：手を上げているときに頭の上でふる
      const tw = active && p.towel;
      set(this.towel, i, p, 0, 1.12 + j, 0.02, 0, Math.sin(this.time * 10 + p.phase) * 0.3, tw ? 1 : 0);
      [-1, 1].forEach((sd, a) => {
        let rx = 0.15, rz = sd * 0.12;
        if (active) {
          // 両手を上げてふる
          const wave = Math.sin(this.time * 10 + p.phase + a) * 0.25;
          rx = 0; rz = sd * (2.7 + wave);
        }
        set(this.arm, i * 2 + a, p, sd * 0.19, 0.5 + j, 0, rx, rz);
        set(this.sleeve, i * 2 + a, p, sd * 0.19, 0.5 + j, 0, rx, rz);
      });
    });
    [this.body, this.neck, this.head, this.hair, this.long, this.arm, this.sleeve, this.eye, this.towel].forEach(m => { m.instanceMatrix.needsUpdate = true; });
  }
}

const NO_FX = { speed: 0, gauge: 0, ft: 0, dunk: 0, steal: 0, block: 0, sp: [] };

// ---------- 試合 ----------
class Match {
  constructor(o) {
    this.o = o;
    this.st = o.st;
    this.el = o.el;
    this.time = 0;
    this.paused = false;
    // 通信対戦（o.net）：ホストは今まで通り計算し、ゲスト（チーム1）の入力を受けて動かす。ゲストは表示だけ
    this.net = o.net || null;
    this.vs = !!this.net;
    this.guest = !!(this.net && this.net.role === 'guest');
    this.me = this.guest ? 1 : 0; // この端末で操作するチーム
    this.inp = [0, 1].map(() => ({ joy: { x: 0, z: 0 }, btn: { a: false, b: false, c: false }, edges: [] }));
    this.ctrls = [null, null]; // 各チームの操作中の選手（人が操作するチームだけ）
    this.out = [];             // ホスト：次に送るできごと
    this.shotClock = 24;
    this.state = 'dead';
    this.deadT = 1.5;
    this.afterDead = null;
    this.clockZero = false;
    this.firstPoss = this.st.poss;
    this.f = ((o.cpuLv || 5) - 5) / 4;
    this.teamFouls = [0, 0];
    // ベンチの選手（交代用）と、ベンチの選手の疲れ（pid → 0〜100）
    this.bench = [(o.bench && o.bench[0]) || [], (o.bench && o.bench[1]) || []].map(a => a.slice());
    this.stam = { ...((o.resume && o.resume.stam) || {}) };
    this.subs = []; // 交代の予約 { side, i, info }
    if (o.resume) {
      // 中断した試合のつづき
      this.firstPoss = o.resume.firstPoss;
      this.teamFouls = o.resume.teamFouls || [0, 0];
    }
    this.scorersDirty = true;
    this.buildDom();
    this.buildScene();
  }

  // この端末の入力・操作中の選手
  get joy() { return this.inp[this.me].joy; }
  set joy(v) { this.inp[this.me].joy = v; }
  get btn() { return this.inp[this.me].btn; }
  get edges() { return this.inp[this.me].edges; }
  get ctrl() { return this.ctrls[this.me]; }
  set ctrl(v) { this.ctrls[this.me] = v; }
  human(side) { return side === 0 || this.vs; }   // 人が操作するチームか
  isCpu(side) { return side === 1 && !this.vs; } // CPU のチームか

  async init() {
    const [A, B] = this.st.sides;
    // チームカラー（ロゴから取った色。なければ名前から作った色）
    const faces = await Promise.all([A, B].flatMap(s => s.players.map(p => loadFace(this.o.faceOf(p.pid), this.o.faceHiOf && this.o.faceHiOf(p.pid)))));
    const photoJersey = side => {
      const cs = faces.slice(side * 5, side * 5 + 5).map(f => f && f.jersey).filter(Boolean);
      if (cs.length < 2) return null;
      const c = new THREE.Color(0, 0, 0);
      cs.forEach(x => { c.r += x.r / cs.length; c.g += x.g / cs.length; c.b += x.b / cs.length; });
      return c;
    };
    const col = (t, side) => photoJersey(side) || new THREE.Color(t.color || `hsl(${hue(t.code)}, 65%, 42%)`);
    // 公式ユニフォームのデザインがあるチームは、その色
    const kitOf = t => KITS[t.id] || null;
    const k0 = kitOf(A.team) ? new THREE.Color(kitOf(A.team).base) : col(A.team, 0);
    const k1 = kitOf(B.team) ? new THREE.Color(kitOf(B.team).base) : col(B.team, 1);
    const hsl0 = {}, hsl1 = {};
    k0.getHSL(hsl0); k1.getHSL(hsl1);
    const c0 = '#' + k0.getHexString();
    let c1 = '#' + k1.getHexString(), n1 = '#ffffff';
    const dh = Math.min(Math.abs(hsl0.h - hsl1.h), 1 - Math.abs(hsl0.h - hsl1.h));
    if (dh < 0.09 && Math.abs(hsl0.l - hsl1.l) < 0.25) { n1 = c1; c1 = '#eef0f4'; } // 色が近いときは相手を白ユニフォームに
    this.colors = [c0, c1];
    try { await document.fonts.load('700 100px Teko'); } catch (e) { /* 読めなければ別の字体 */ }
    const venue = VENUES[A.team.id];
    this.venue = venue;
    // ホームのロゴ（コートのセンター・フラッグに使う）
    const logoImg = await new Promise(res => {
      if (!A.team.logo || /^https?:/.test(A.team.logo)) return res(null); // 外のサーバーの画像はコートに描けない
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = A.team.logo;
    });
    if (venue === 'budokan') {
      // 天井は暗く、照明でコートだけが明るい
      this.scene.background = new THREE.Color('#040507');
      this.scene.fog = new THREE.Fog('#040507', 60, 140);
      this.jumbo = buildBudokan(this.scene, A.team, B.team, A.team.color || c0, B.team.color || c1, logoImg);
    }
    const ribbon = venue === 'budokan' ? [
      ['#ffffff', A.team.color || c0, 'YOKOHAMA EXCELLENCE'], ['#f3f4f6', '#1b1d22', 'Bリーグ STORM'], [A.team.color || c0, '#ffffff', '横浜武道館'],
      ['#ffffff', '#1e3a8a', '2026-27 SEASON'], ['#ffffff', '#c8102e', 'GO EX!'], ['#eef1f4', A.team.color || c0, 'HOME GAME'],
    ] : [
      [A.team.color || c0, '#ffffff', A.team.short], ['#0d1220', '#ffd23f', 'Bリーグ STORM'], ['#0d1220', '#ffffff', 'LET\'S GO ' + A.team.short + '!'],
      [A.team.color || c0, '#ffffff', 'DEFENSE!'], ['#0d1220', '#ffffff', '2026-27 SEASON'],
    ];
    this.crowd = buildArena(this.scene, c0, ribbon, venue);
    this.leds = buildBoards(this.scene, A.team, B.team, A.team.color || c0, B.team.color || c1);
    // ペイントエリアとセンターはホームのチームの色（ロゴの色）。センターにはホームのロゴ
    const paint = A.team.color || c0;
    const courtOpt = venue === 'budokan' ? { solid: true, apron: 'YOKOHAMA EXCELLENCE', wood: true } : {};
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
      new THREE.MeshStandardMaterial({ map: courtTexture(paint, logoImg, A.team.short, courtOpt), roughness: 0.32, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    // ユニフォームのエンブレム用のロゴ
    const logoTex = img => { if (!img) return null; const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
    const awayLogo = kitOf(B.team) ? await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = B.team.logo; }) : null;
    const kits = [
      kitOf(A.team) && { ...kitOf(A.team), logo: logoTex(logoImg) },
      kitOf(B.team) && c1 === '#' + k1.getHexString() && { ...kitOf(B.team), logo: logoTex(awayLogo) }, // 白ユニフォームにかえたときは使わない
    ];
    // 外部AIのモデル（ある選手だけ）
    const models = await Promise.all([A, B].flatMap(s => s.players.map(p => (STYLES[p.pid] && STYLES[p.pid].model ? loadModel(STYLES[p.pid].model, STYLES[p.pid].anims) : null))));
    this.players = [A, B].map((s, side) => s.players.map((info, i) => {
      const kit = kits[side];
      const jc = kit ? kit.base : side === 0 ? c0 : c1;
      const fg = kit ? kit.num : new THREE.Color(jc).getHSL({}).l > 0.62 ? (side === 0 ? '#1b1d22' : (n1 === '#ffffff' ? '#1b1d22' : n1)) : (side === 0 ? '#ffffff' : n1);
      const badgeC = side === 0 ? c0 : '#' + k1.getHexString();
      (this.kitInfo = this.kitInfo || [])[side] = { jc, fg, badge: badgeC, kit };
      const look = buildPlayer({ ...info, pid: info.pid }, jc, fg, faces[side * 5 + i], badgeC, kit);
      if (models[side * 5 + i]) attachModel(look, models[side * 5 + i], look.sty);
      this.scene.add(look.root);
      const r = this.rateOf(side, info);
      const stam = this.stamOf(info.pid);
      delete this.stam[info.pid];
      return {
        side, i, info, look, r, stam,
        pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, tgt: null, y: 0, vy: 0, face: 0, phase: rand() * 6,
        stun: 0, slow: 0, act: null, actT: 0, cd: 0, think: 0, goal: null, sprint: false, beatCd: 0,
      };
    }));
    this.bond = [0, 1].map(sd => this.players[sd].some(q => this.has(q, 'bond')) && this.players[sd].some(q => ['m45', 'm80'].includes(q.info.pid)));
    this.kickoff(this.st.poss);
    if (venue === 'budokan' && !this.vs) {
      // オープニング：アリーナ全体を見せてから、試合のカメラへ（タップでとばせる）
      this.intro = { t: 0, dur: 8 };
      const cap = document.createElement('div');
      cap.className = 'm3d-venue';
      cap.innerHTML = '<b>横浜武道館</b><small>YOKOHAMA BUDOKAN</small><em>タップでスキップ</em>';
      this.el.appendChild(cap);
      this.el.classList.add('intro');
      this.introCap = cap;
      this.all().forEach(p => this.animate(p, 0));
      this.updateBall(0);
    }
    this.bgmMode = this.st.poss === this.me ? 'off' : 'def';
    if (SFX) { SFX.startCrowd(); SFX.startBgm(this.bgmMode); }
    if (this.net) this.netInit();
    this.resize();
    this.loop = this.loop.bind(this);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- 画面（HUD） ----------
  buildDom() {
    const [A, B] = this.st.sides;
    this.el.innerHTML = `
      <canvas class="m3d-cv"></canvas>
      <div class="m3d-top">
        <button class="m3d-pause" aria-label="一時停止">Ⅱ</button>
        <div class="m3d-scard sc0"></div>
        <div class="m3d-scard sc1"></div>
      </div>
      <div class="m3d-sb" style="--c0:${A.team.color || '#c8102e'};--c1:${B.team.color || '#1e88e5'}">
        <span class="season">2026-27<br>SEASON</span>
        <span class="tm t0">${A.team.logo ? `<img src="${A.team.logo}" alt="">` : ''}<span>${A.team.short}</span></span>
        <b class="s0"><span class="n">0</span><span class="fl fl0" title="チームファウル">${'<i></i>'.repeat(5)}</span></b>
        <b class="s1"><span class="n">0</span><span class="fl fl1" title="チームファウル">${'<i></i>'.repeat(5)}</span></b>
        <span class="tm t1"><span>${B.team.short}</span>${B.team.logo ? `<img src="${B.team.logo}" alt="">` : ''}</span>
        <span class="mid"><span class="q">1Q</span><span class="clk"></span></span>
        <span class="sc">24</span>
      </div>
      <div class="m3d-last"></div>
      <div class="m3d-pop"></div>
      <div class="m3d-call"></div>
      <div class="m3d-meter"><i class="zone"></i><i class="perfect"></i><i class="fill"></i></div>
      <div class="m3d-card"><img alt=""><div><b></b><small></small></div></div>
      <div class="m3d-joy"><div class="base"><div class="knob"></div></div></div>
      <div class="m3d-btns">
        <button class="b b-c"><span>ドライブ</span><i></i></button>
        <button class="b b-a"><span>パス</span><i></i></button>
        <button class="b b-b big"><span>シュート</span><i></i></button>
      </div>
      <div class="m3d-hint">スマホは横向き推奨</div>
      <div class="m3d-menu"><div>
        <h2>一時停止</h2>
        <button class="btn primary" data-m="resume">再開</button>
        <button class="btn" data-m="subs">選手交代</button>
        <div class="m3d-subs"></div>
        <button class="btn" data-m="help">操作説明</button>
        <button class="btn" data-m="suspend">中断して、後で再開</button>
        <button class="btn" data-m="quit">試合を終了する</button>
        <div class="m3d-help">${this.o.helpHtml || ''}</div>
      </div></div>`;
    // 得点カードのふちのチームカラー
    this.el.style.setProperty('--home-c', A.team.color || '#c8102e');
    this.el.style.setProperty('--away-c', B.team.color || '#1e88e5');
    const q = s => this.el.querySelector(s);
    this.ui = {
      cv: q('.m3d-cv'), s0: q('.s0 .n'), s1: q('.s1 .n'), qtr: q('.q'), clk: q('.clk'), sc: q('.sc'),
      pop: q('.m3d-pop'), call: q('.m3d-call'), sc0: q('.m3d-scard.sc0'), sc1: q('.m3d-scard.sc1'), lastScore: q('.m3d-last'), meter: q('.m3d-meter'), fill: q('.m3d-meter .fill'), zone: q('.m3d-meter .zone'), perfect: q('.m3d-meter .perfect'),
      card: q('.m3d-card'), joy: q('.m3d-joy'), base: q('.m3d-joy .base'), knob: q('.m3d-joy .knob'),
      a: q('.b-a'), b: q('.b-b'), c: q('.b-c'), menu: q('.m3d-menu'),
    };
    this.bindInput();
  }

  bindInput() {
    const ui = this.ui;
    const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { /* 指がすでに離れている */ } };
    let joyId = null, ox = 0, oy = 0;
    const R = 56;
    ui.joy.addEventListener('pointerdown', e => {
      joyId = e.pointerId;
      capture(ui.joy, e);
      const rc = ui.joy.getBoundingClientRect();
      // 画面のはしを押しても、十字キーが全部見えるように中心を内がわへ寄せる
      const M = 72;
      ox = clamp(e.clientX, rc.left + M, rc.right - M);
      oy = clamp(e.clientY, rc.top + M, Math.min(rc.bottom, innerHeight) - M);
      ui.base.style.left = ox - rc.left + 'px';
      ui.base.style.top = oy - rc.top + 'px';
      ui.base.classList.add('on');
    });
    ui.joy.addEventListener('pointermove', e => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      ui.knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.joy = { x: dx / R, z: dy / R };
    });
    const up = e => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.joy = { x: 0, z: 0 };
      ui.knob.style.transform = '';
      ui.base.classList.remove('on');
    };
    ui.joy.addEventListener('pointerup', up);
    ui.joy.addEventListener('pointercancel', up);
    ['a', 'b', 'c'].forEach(k => {
      const b = ui[k];
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.press(k, true); capture(b, e); });
      const off = () => this.press(k, false);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
    });
    // パソコンのキーボード
    const keys = {};
    const KEYMAP = { j: 'a', k: 'b', l: 'c', ' ': 'b' };
    this.onKey = e => {
      const down = e.type === 'keydown';
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) { if (down !== !!keys[k]) this.press(KEYMAP[k], down); keys[k] = down; e.preventDefault(); return; }
      keys[k] = down;
      const x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
      const z = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
      const l = Math.hypot(x, z) || 1;
      this.joy = { x: x / l, z: z / l };
      if (k.startsWith('arrow')) e.preventDefault();
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.el.querySelector('.m3d-pause').onclick = () => this.pause(true);
    this.el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      if (b.dataset.m === 'resume') this.pause(false);
      else if (b.dataset.m === 'help') this.ui.menu.classList.toggle('help-open');
      else if (b.dataset.m === 'subs') { this.subSel = null; this.ui.menu.classList.toggle('subs-open'); this.renderSubs(); }
      else if (b.dataset.m === 'suspend') { this.save(); this.destroy(); this.o.onSuspend(); }
      else { if (this.net) this.send({ bye: 1 }); this.destroy(); this.o.onQuit(); }
    });
    // ボタンを連打しても画面が拡大されないようにする（スマホのダブルタップ拡大・ピンチ拡大を止める）
    const noZoom = e => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    [this.el.querySelector('.m3d-btns'), ui.joy].forEach(el => {
      el.addEventListener('touchend', e => e.preventDefault(), { passive: false });
      el.addEventListener('dblclick', e => e.preventDefault());
    });
    this.el.addEventListener('touchmove', noZoom, { passive: false });
    this.onGesture = e => e.preventDefault();
    document.addEventListener('gesturestart', this.onGesture);
    // こまめに保存しておく（アプリを閉じても、あとで再開できる）
    this.saveTimer = setInterval(() => this.save(), 4000);
    this.onHide = () => { if (document.visibilityState === 'hidden') this.save(); };
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onHide);
    // コートの選手をタップ：ボールを持っていればその選手へパス、守りならその選手に切りかえ
    ui.cv.addEventListener('pointerdown', e => this.tapPlayer(e));
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  // 今の試合の状態（スコア・時間・個人成績など）を保存してもらう
  save() {
    if (this.ended || this.stopped || !this.players || !this.o.onSave) return;
    const st = this.st;
    this.o.onSave({
      score: [...st.score], q: st.q, clock: st.clock, qLen: st.qLen, qScores: st.qScores.map(x => [...x]),
      box: JSON.parse(JSON.stringify(st.box)), poss: st.poss, firstPoss: this.firstPoss, teamFouls: [...this.teamFouls],
      stam: { ...this.stam, ...Object.fromEntries(this.all().map(q => [q.info.pid, Math.round(q.stam)])) },
    });
  }

  // 画面の選手をタップ
  tapPlayer(e) {
    if (this.intro) { this.endIntro(); return; }
    if (this.paused || !this.players) return;
    const c = this.ctrl;
    const rc = this.el.getBoundingClientRect();
    const tx = e.clientX - rc.left, ty = e.clientY - rc.top;
    let best = null, bd = 80;
    this.players[this.me].forEach(q => {
      const v = new THREE.Vector3(q.pos.x, q.y + q.look.height * 0.6, q.pos.z).project(this.camera);
      const d = Math.hypot((v.x + 1) / 2 * rc.width - tx, (1 - v.y) / 2 * rc.height - ty);
      if (d < bd) { bd = d; best = q; }
    });
    if (!best || best === c) return;
    if (this.guest) this.send({ tap: best.i });
    else this.tapAct(0, best);
  }

  // タップした選手へパス（ボールを持っているとき）、または操作する選手を切りかえ（守りのとき）
  tapAct(side, best) {
    const c = this.ctrls[side];
    if (!best || !c || best === c) return;
    const b = this.ball;
    if (b.holder === c) {
      if (this.state === 'throwin') this.throwInPass(c, best);
      else if (this.state === 'play' && c.act !== 'shoot') this.pass(c, best);
    } else if (!b.holder || b.holder.side !== side) {
      this.ctrls[side] = best; // 守りのときは、タップした選手を操作する
    }
  }

  press(k, down) {
    if (this.intro && down) this.endIntro();
    if (this.btn[k] === down) return;
    this.btn[k] = down;
    this.edges.push({ k, down });
    if (this.guest) this.send({ k, d: down });
    this.ui[k].classList.toggle('on', down);
  }

  pause(on, remote = false) {
    this.paused = on;
    if (this.net && !remote) this.send({ pause: on });
    if (!on) this.ui.menu.classList.remove('help-open', 'subs-open');
    this.ui.menu.classList.toggle('open', on);
    if (!on) this.last = performance.now();
  }

  buildScene() {
    const r = new THREE.WebGLRenderer({ canvas: this.ui.cv, antialias: true });
    // スマホは画面がこまかいので 1.5 倍までにして軽くする
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    ktx2Renderer = r;
    const s = new THREE.Scene();
    s.background = new THREE.Color('#0c1220');
    s.fog = new THREE.Fog('#0c1220', 40, 80);
    s.add(new THREE.HemisphereLight('#ffffff', '#4a3c28', 2.0));
    // 天井の照明（床がつやっと光る）
    const top = new THREE.DirectionalLight('#fff6e8', 1.2);
    top.position.set(3, 20, 6);
    s.add(top);
    const sun = new THREE.DirectionalLight('#ffffff', 1.3);
    sun.position.set(-4, 14, 8);
    s.add(sun);
    this.scene = s;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
    this.camX = 0;
    this.camZ = 0;
    this.hoops = [buildHoop(s, 1), buildHoop(s, -1)];
    const bt = ballTextures();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20),
      new THREE.MeshStandardMaterial({ map: bt.map, bumpMap: bt.bump, bumpScale: 1.5, roughness: 0.78, metalness: 0 }));
    s.add(ball);
    const bs = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    bs.rotation.x = -Math.PI / 2;
    s.add(bs);
    this.ball = { mesh: ball, shadow: bs, pos: new THREE.Vector3(), vel: new THREE.Vector3(), holder: null, mode: 'held', last: 0, reb: false };
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.58, 28), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    s.add(ring);
    this.ring = ring;
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = h > w;
    this.camera.fov = this.portrait ? 52 : 33.5;
    this.camera.updateProjectionMatrix();
    this.el.classList.toggle('portrait', this.portrait);
  }

  // 音と観客の反応をまとめて出す。決まった・スティール・ブロックは「わぁーっ」（ホームのほうが大きい）
  fx(kind, side) {
    const home = side === 0;
    const power = { dunk: 1, score3: 1, score: 0.8, stop: 0.75 }[kind];
    if (power) {
      this.cheer(home ? power : power * 0.5, home);
      if (SFX) SFX.cheer(home ? power : power * 0.55);
    } else if (kind === 'miss') { if (SFX && home) SFX.groan(0.45); }
  }

  destroy() {
    if (SFX) { SFX.stopCrowd(); SFX.stopBgm(); }
    if (this.net) { sfxTap = null; this.net.close(); }
    cancelAnimationFrame(this.raf);
    this.stopped = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('resize', this.onResize);
    clearInterval(this.saveTimer);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onHide);
    if (this.onNetVis) document.removeEventListener('visibilitychange', this.onNetVis);
    if (this.wake) { this.wake.release().catch(() => {}); this.wake = null; }
    document.removeEventListener('gesturestart', this.onGesture);
    this.renderer.dispose();
  }

  // ---------- 通信対戦 ----------
  // ホスト：試合を計算して、1秒に30回、選手とボールの状態とできごと（音・カードなど）を送る
  // ゲスト：入力（スティック・ボタン・タップ）を送り、届いた状態を少し遅らせてなめらかにつないで表示する
  netInit() {
    this.net.onMessage(m => this.onNet(m));
    this.net.onClose(() => this.netLost('接続が切れました'));
    if (this.net.onState) this.net.onState(s => this.netState(s));
    // 「再接続しています」の表示
    const nw = this.ui.netWait = document.createElement('div');
    nw.className = 'm3d-netwait';
    this.el.appendChild(nw);
    // アプリが裏に回ったら相手に知らせる。対戦中は画面が自動で消えないようにする
    this.wake = null;
    const lock = async () => {
      try { if (navigator.wakeLock && !document.hidden && !this.stopped && !this.wake) { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; }); } } catch (e) { /* 使えない端末 */ }
    };
    this.onNetVis = () => {
      if (this.net.away) this.net.away(document.hidden);
      if (!document.hidden) { this.last = performance.now(); lock(); }
    };
    document.addEventListener('visibilitychange', this.onNetVis);
    lock();
    if (this.guest) {
      this.snaps = [];
      this.rt = null;
      this.netJoy = { x: 0, z: 0 };
      this.netJoyT = 0;
      this.swapping = {};
    } else {
      sfxTap = (k, a) => this.out.push(['sfx', k, a]);
    }
    // 通信対戦では中断（あとで再開）はできない
    const sus = this.el.querySelector('[data-m="suspend"]');
    if (sus) sus.style.display = 'none';
    const quit = this.el.querySelector('[data-m="quit"]');
    if (quit) quit.textContent = '対戦をやめる';
  }

  send(m) { if (this.net && !this.stopped) this.net.send(m); }

  // ホスト：ゲストの画面にも出すできごとをためる（to が自分のチームなら送らない）
  relay(type, args, to = null) {
    if (!this.net || this.guest || this.relaying) return;
    if (to !== null && to === this.me) return;
    this.out.push([type, ...args]);
  }

  cheer(power, home) {
    this.relay('cheer', [power, home]);
    this.crowd.cheer(power, home);
  }

  // 通信の具合が変わった：'lost'（つなぎ直し中）・'away'（相手がアプリを離れた）・'ok'（もどった）
  netState(s) {
    if (this.stopped || this.ended) return; // 試合が終わったあと（相手がやめた など）は出さない
    const nw = this.ui.netWait;
    this.netWait = s !== 'ok';
    if (s === 'ok') {
      nw.classList.remove('show');
      this.last = performance.now();
      // ゲスト：切れているあいだに離したボタンなどを、もう一度送る
      if (this.guest) {
        Object.keys(this.btn).forEach(k => this.send({ k, d: !!this.btn[k] }));
        this.send({ j: [Math.round(this.joy.x * 100) / 100, Math.round(this.joy.z * 100) / 100] });
        this.netJoy = { x: this.joy.x, z: this.joy.z };
      }
      return;
    }
    // ホスト：止めているあいだ、ゲストの入力は離したことにする
    if (!this.guest && this.inp && this.inp[1]) {
      const I = this.inp[1];
      I.joy = { x: 0, z: 0 };
      Object.keys(I.btn).forEach(k => { I.btn[k] = false; });
    }
    nw.innerHTML = s === 'away'
      ? '<b>相手がアプリを離れています</b><small>もどるまで待っています</small>'
      : '<b>接続が不安定です</b><small>つなぎ直しています…</small>';
    nw.classList.add('show');
  }

  netLost(msg) {
    if (this.ended || this.stopped) return;
    this.ended = true;
    if (this.ui.netWait) this.ui.netWait.classList.remove('show');
    this.call(msg, '試合を終了します', 'END');
    setTimeout(() => { if (this.stopped) return; this.destroy(); this.o.onQuit(); }, 2200);
  }

  onNet(m) {
    if (this.stopped) return;
    if (m.bye) return this.netLost('相手が対戦をやめました');
    if (m.pause !== undefined) return this.pause(!!m.pause, true);
    if (this.guest) {
      if (m.snap) this.gotSnap(m.snap);
      if (m.end) {
        this.ended = true;
        Object.assign(this.st, { score: m.end.score, box: m.end.box, qScores: m.end.qScores });
        this.destroy();
        this.o.onEnd(this.st);
      }
      return;
    }
    // ホスト：ゲスト（チーム1）の入力
    const I = this.inp[1];
    if (m.j) I.joy = { x: clamp(+m.j[0] || 0, -1, 1), z: clamp(+m.j[1] || 0, -1, 1) };
    if (m.k && I.btn[m.k] !== undefined && I.btn[m.k] !== !!m.d) { I.btn[m.k] = !!m.d; I.edges.push({ k: m.k, down: !!m.d }); }
    if (m.tap !== undefined && this.players) this.tapAct(1, this.players[1][m.tap]);
    if (m.sub) {
      const info = this.bench[1].find(q => q.pid === m.sub[1]);
      if (info && !this.subs.some(s => s.side === 1 && s.i === m.sub[0])) { this.subs.push({ side: 1, i: m.sub[0], info }); this.trySubs(); }
    }
    if (m.unsub !== undefined) { const k = this.subs.findIndex(s => s.side === 1 && s.i === m.unsub); if (k >= 0) this.subs.splice(k, 1); }
  }

  // ホスト：状態を送る（1秒に30回）
  netTick(dt) {
    this.netT = (this.netT || 0) + dt;
    this.boxT = (this.boxT || 0) + dt;
    if (this.netT < 1 / 30) return;
    // 送りきれていないデータがたまっているときは、今回は送らない（古い状態をためこまず、送れるようになったら最新を送る）
    if (this.net.busy && this.net.busy()) return;
    this.netT = 0;
    const R = v => Math.round(v * 1000) / 1000;
    const st = this.st, b = this.ball, all = this.all();
    const idx = q => (q ? all.indexOf(q) : -1);
    const s = {
      t: R(this.time), s: this.state, sc: R(this.shotClock),
      g: [st.score[0], st.score[1], st.q, R(st.clock), st.poss], tf: [...this.teamFouls],
      c: [idx(this.ctrls[0]), idx(this.ctrls[1])],
      p: all.map(q => [R(q.pos.x), R(q.pos.z), R(q.y), R(q.vel.x), R(q.vel.z), R(q.face), q.act || 0, R(q.actT), q.shotKind || 0,
        q.passType || 0, Math.round(q.stam), q.released ? 1 : 0, q.lastGrade || 0, R(q.vy), q.info.pid, q.layup ? 1 : 0]),
      b: [b.mode, idx(b.holder), R(b.pos.x), R(b.pos.y), R(b.pos.z)],
      h: this.hoops.map(h => [R(h.net.userData.swish || 0), R(h.rim.userData.shake || 0)]),
      e: this.out.splice(0),
    };
    // 個人成績は、点が入ったときと1秒ごと
    if (this.boxT > 1 || s.e.some(e => e[0] === 'ann')) {
      this.boxT = 0;
      s.box = st.box; s.qs = st.qScores; s.stam = this.stam;
    }
    this.send({ snap: s });
  }

  // ゲスト：状態が届いた
  gotSnap(s) {
    s.recv = performance.now() / 1000;
    const st = this.st;
    if (s.box) { st.box = s.box; st.qScores = s.qs; this.stam = s.stam || {}; }
    this.snaps.push(s);
    if (this.snaps.length > 12) this.snaps.shift();
    // 音・カードなどは届いたときに出す
    (s.e || []).forEach(e => this.replay(e));
  }

  replay(e) {
    const [type, ...a] = e;
    // ゲストから見ると「マイボール」と「相手ボール」は逆
    const flip = x => (typeof x === 'string' ? x.replace(/マイボール|相手ボール/g, w => (w === 'マイボール' ? '相手ボール' : 'マイボール')) : x);
    if (type === 'sfx') { const S = window.Sound; if (S && typeof S[a[0]] === 'function') S[a[0]](...a[1]); }
    else if (type === 'call') this.call(a[0], flip(a[1]), a[2], a[3]);
    else if (type === 'callAdd') this.callAdd(flip(a[0]), a[1], a[2]);
    else if (type === 'pop') this.pop(a[0], a[1]);
    else if (type === 'ann') { const q = this.players[a[0]] && this.players[a[0]][a[1]]; if (q) this.announce(q, a[2]); }
    else if (type === 'cheer') this.crowd.cheer(a[0], a[1]);
  }

  // ゲスト：毎フレーム。少し前（0.1秒）の状態を、前後2つの間でなめらかにつないで表示
  updateGuest(dt) {
    const S = this.snaps;
    const now = performance.now() / 1000;
    this.crowd.update(dt);
    if (this.leds) this.leds.tex.offset.x = (this.leds.tex.offset.x + dt * 0.03) % 1;
    this.crowd.ribbons.forEach(t => { t.offset.x = (t.offset.x + dt * 0.02) % 1; });
    // スティックの向きを送る（変わったときだけ、1秒に20回まで）
    this.netJoyT += dt;
    const j = this.joy;
    if (this.netJoyT > 0.05 && (Math.abs(j.x - this.netJoy.x) > 0.02 || Math.abs(j.z - this.netJoy.z) > 0.02)) {
      this.netJoyT = 0;
      this.netJoy = { x: j.x, z: j.z };
      this.send({ j: [Math.round(j.x * 100) / 100, Math.round(j.z * 100) / 100] });
    }
    this.edges.length = 0; // ゲストはボタンの記録を使わない（ホストへ送ってある）
    if (!S.length) { this.all().forEach(q => this.animate(q, dt)); return; }
    const L = S[S.length - 1];
    const DELAY = 0.1;
    const target = L.t + (now - L.recv) - DELAY;
    if (this.rt === null || Math.abs(target - this.rt) > 0.5) this.rt = target;
    else this.rt += dt + (target - this.rt) * 0.1;
    if (this.rt > L.t) this.rt = L.t;
    let a = S[0], b = S[0];
    for (let i = 0; i < S.length; i++) { if (S[i].t <= this.rt) a = S[i]; if (S[i].t >= this.rt) { b = S[i]; break; } b = S[i]; }
    const u = b.t > a.t ? clamp((this.rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const lerp = (x, y) => x + (y - x) * u;
    const lerpA = (x, y) => { let d = y - x; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return x + d * u; };
    this.time = this.rt;
    // 点数・時間・状態
    const st = this.st;
    st.score[0] = L.g[0]; st.score[1] = L.g[1]; st.q = L.g[2]; st.clock = lerp(a.g[3], b.g[3]); st.poss = L.g[4];
    this.state = b.s; this.shotClock = lerp(a.sc, b.sc); this.teamFouls = L.tf;
    if (this.jumbo) this.jumbo.draw(st, Math.max(0, Math.ceil(this.shotClock)));
    const all = this.all();
    // 選手交代：コートの選手が変わったら、こちらでも入れかえる
    L.p.forEach((row, k) => {
      const q = all[k];
      if (!q || q.info.pid === row[14] || this.swapping[k]) return;
      const side = k < 5 ? 0 : 1, i = k % 5;
      const info = this.bench[side].find(x => x.pid === row[14]);
      if (!info) return;
      this.swapping[k] = true;
      this.subs = this.subs.filter(x => !(x.side === side && x.i === i));
      this.swap(side, i, info).catch(e => console.warn(e)).finally(() => { this.swapping[k] = false; });
    });
    all.forEach((q, k) => {
      const A = a.p[k], B = b.p[k];
      if (!A || !B) return;
      q.pos.x = lerp(A[0], B[0]); q.pos.z = lerp(A[1], B[1]); q.y = lerp(A[2], B[2]);
      q.vel.x = lerp(A[3], B[3]); q.vel.z = lerp(A[4], B[4]); q.face = lerpA(A[5], B[5]);
      const X = u < 0.5 ? A : B; // 動作の種類などは近いほう
      q.act = X[6] || null; q.actT = A[6] === B[6] ? lerp(A[7], B[7]) : X[7];
      q.shotKind = X[8] || null; q.passType = X[9] || null; q.stam = X[10];
      q.released = !!X[11]; q.lastGrade = X[12] || null; q.vy = X[13]; q.layup = !!X[15];
    });
    this.ctrls = L.c.map(i => all[i] || null);
    // ボール
    const ball = this.ball;
    const X = u < 0.5 ? a.b : b.b;
    ball.mode = X[0];
    ball.holder = all[X[1]] || null;
    if (ball.mode === 'held' && ball.holder) this.heldBall(ball.holder);
    else ball.pos.set(lerp(a.b[2], b.b[2]), lerp(a.b[3], b.b[3]), lerp(a.b[4], b.b[4]));
    // ネットとリング（新しくゆれはじめたときだけ合わせる）
    L.h.forEach((h, i) => {
      const hp = this.hoops[i];
      if (h[0] > (hp.net.userData.swish || 0) + 0.1) hp.net.userData.swish = h[0];
      if (h[1] > (hp.rim.userData.shake || 0) + 0.1) hp.rim.userData.shake = h[1];
    });
    this.crowd.look(ball.pos.x, ball.pos.z);
    // BGM：自分のチームがボールを持っているかで切りかえ
    const want = st.poss === this.me ? 'off' : 'def';
    if (want !== this.bgmMode) {
      this.bgmT = (this.bgmT || 0) + dt;
      if (this.bgmT > 0.5) { this.bgmMode = want; this.bgmT = 0; if (SFX && SFX.setBgmMode) SFX.setBgmMode(want); }
    } else this.bgmT = 0;
    // 得点カードの疲れのバー
    this.stamT = (this.stamT || 0) + dt;
    if (this.stamT > 0.5 && this.rows) {
      this.stamT = 0;
      all.forEach(q => {
        const r = this.rows[q.info.pid];
        const bar = r && r.querySelector('.stm');
        if (!bar) return;
        bar.firstChild.style.width = Math.round(q.stam) + '%';
        bar.className = 'stm' + (q.stam < 40 ? ' low' : q.stam < 65 ? ' mid' : '');
      });
    }
    all.forEach(q => this.animate(q, dt));
    this.ballMesh(dt);
    this.ballToHand();
  }

  // ---------- ルール ----------
  all() { return this.players[0].concat(this.players[1]); }

  // CPU の選手は能力を下げる（どのレベルでも全体に弱く）
  rateOf(side, info) {
    return this.isCpu(side) ? Object.fromEntries(Object.entries(info.r).map(([k, v]) => [k, clamp(Math.round(v * (1 - CPU_NERF * 0.7 + this.f * 0.07)), 30, 99)])) : info.r;
  }

  // ---------- 疲れと選手交代 ----------
  stamOf(pid) { return this.stam[pid] === undefined ? 100 : this.stam[pid]; }
  // 疲れぐあい 0（元気）〜1（へとへと）。65 を下回ると効きはじめる
  tired(p) { return p ? clamp((65 - p.stam) / 65, 0, 1) : 0; }

  tire(dt) {
    const q = 60 / Math.max(60, this.st.qLen); // クォーターが短いときは早く疲れる（1クォーターあたりは同じくらい）
    const live = this.state === 'play';
    this.all().forEach(p => {
      const spd = Math.hypot(p.vel.x, p.vel.z);
      const eff = live ? 0.35 + Math.min(1.3, spd / 5) + (p.sprint ? 0.5 : 0) + (p.y > 0 ? 0.6 : 0) : 0.1;
      p.stam = clamp(p.stam - eff * TIRE_DRAIN * q * dt, 0, 100);
      if (this.human(p.side) && p.stam < 35 && !p.warned && live) {
        p.warned = true;
        this.call('疲れています', `${p.info.name}　Ⅱ →「選手交代」で休ませましょう`, 'TIRED', p.side, p.side);
      }
      if (p.stam > 55) p.warned = false;
    });
    Object.keys(this.stam).forEach(pid => { this.stam[pid] = Math.min(100, this.stam[pid] + TIRE_REST * q * dt); });
    // 得点カードの疲れのバー（0.5秒ごと）
    this.stamT = (this.stamT || 0) + dt;
    if (this.stamT > 0.5 && this.rows) {
      this.stamT = 0;
      this.all().forEach(p => {
        const r = this.rows[p.info.pid];
        const bar = r && r.querySelector('.stm');
        if (!bar) return;
        bar.firstChild.style.width = Math.round(p.stam) + '%';
        bar.className = 'stm' + (p.stam < 40 ? ' low' : p.stam < 65 ? ' mid' : '');
      });
    }
  }

  // CPU：疲れた選手を、元気なベンチの選手と交代（ボールが止まったとき）
  autoSubs(side) {
    const bench = this.bench[side];
    const fit = (q, i) => (q.pos.split('/').includes(SLOTS5[i]) ? 1 : 0);
    this.players[side].forEach((p, i) => {
      if (p.stam > 48 || this.subs.some(s => s.side === side && s.i === i)) return;
      const pick = bench.filter(q => this.stamOf(q.pid) > 80 && !this.subs.some(s => s.info.pid === q.pid))
        .sort((a, b) => (fit(b, i) - fit(a, i)) || (b.r.ovr - a.r.ovr))[0];
      if (pick) this.subs.push({ side, i, info: pick });
    });
  }

  // 予約した交代は、ボールが止まっているとき（得点の後・スローインの前・クォーターの間など）に行う
  trySubs() {
    if (this.subBusy || !this.subs.length || this.ended || this.stopped) return;
    if (this.state !== 'dead' && this.state !== 'throwin') return;
    const s = this.subs.shift();
    this.subBusy = true;
    this.swap(s.side, s.i, s.info).catch(e => console.warn(e)).finally(() => { this.subBusy = false; this.trySubs(); });
  }

  async swap(side, i, info) {
    const bench = this.bench[side];
    if (!bench.some(q => q.pid === info.pid)) return;
    const face = await loadFace(this.o.faceOf(info.pid), this.o.faceHiOf && this.o.faceHiOf(info.pid));
    const K = this.kitInfo[side];
    const look = buildPlayer({ ...info }, K.jc, K.fg, face, K.badge, K.kit);
    const sty = STYLES[info.pid];
    if (sty && sty.model) { const m = await loadModel(sty.model, sty.anims); if (m) attachModel(look, m, look.sty); }
    if (this.stopped) return;
    const j = bench.findIndex(q => q.pid === info.pid);
    if (j < 0) return;
    const p = this.players[side][i];
    const old = p.info;
    this.scene.remove(p.look.root);
    this.scene.add(look.root);
    bench.splice(j, 1, old);
    this.stam[old.pid] = p.stam;
    // 同じ選手の入れものを使いまわす（ボールを持っていても、位置や役わりはそのまま）
    p.info = info; p.look = look; p.r = this.rateOf(side, info); p.stam = this.stamOf(info.pid);
    delete this.stam[info.pid];
    p.warned = false; p.zoneUntil = 0; p.hot3 = false;
    this.st.sides[side].players[i] = info;
    if (!this.st.box[side][info.pid]) this.st.box[side][info.pid] = BOX0();
    this.bond = [0, 1].map(sd => this.players[sd].some(q => this.has(q, 'bond')) && this.players[sd].some(q => ['m45', 'm80'].includes(q.info.pid)));
    this.scorersDirty = true;
    this.animate(p, 0);
    this.call('選手交代', `${old.name} → ${info.name}`, 'SUB', side);
    if (this.ui.menu.classList.contains('subs-open')) this.renderSubs();
  }

  // 一時停止メニューの「選手交代」：コートの選手 → ベンチの選手 の順にタップ
  renderSubs() {
    const box = this.ui.menu.querySelector('.m3d-subs');
    if (!this.ui.menu.classList.contains('subs-open')) { box.innerHTML = ''; return; }
    const bar = v => `<i class="stm${v < 40 ? ' low' : v < 65 ? ' mid' : ''}"><i style="width:${Math.round(v)}%"></i></i>`;
    const me = this.me;
    const pend = this.subs.filter(x => x.side === me);
    const sel = this.subSel;
    const bench = this.bench[me];
    box.innerHTML = `
      <p class="sub-hint">${sel == null ? '① 下げる選手（コート）をタップ' : '② 入れる選手（ベンチ）をタップ'}　…ボールが止まったときに交代します</p>
      <div class="sub-cols">
        <div><h3>コート</h3>${this.players[me].map((p, i) => { const pd = pend.find(x => x.i === i); return `
          <button class="sub-row${sel === i ? ' sel' : ''}${pd ? ' pend' : ''}" data-ci="${i}"><span class="pos">${SLOTS5[i]}</span>
            <span class="nm">${escH(p.info.name)}${pd ? `<small>→ ${escH(pd.info.name)}（タップで取り消し）</small>` : ''}</span><b>${p.r.ovr}</b>${bar(p.stam)}</button>`; }).join('')}</div>
        <div><h3>ベンチ</h3>${bench.length ? bench.map((q, j) => { const used = pend.some(x => x.info.pid === q.pid); return `
          <button class="sub-row${used ? ' used' : ''}" data-bi="${j}" ${sel == null || used ? 'disabled' : ''}><span class="pos">${escH(q.pos)}</span>
            <span class="nm">${escH(q.name)}</span><b>${q.r.ovr}</b>${bar(this.stamOf(q.pid))}</button>`; }).join('') : '<p class="sub-hint">ベンチに選手がいません</p>'}</div>
      </div>`;
    box.querySelectorAll('[data-ci]').forEach(b => b.onclick = () => {
      const i = +b.dataset.ci;
      const k = this.subs.findIndex(x => x.side === me && x.i === i);
      if (k >= 0) { if (this.guest) this.send({ unsub: i }); this.subs.splice(k, 1); this.subSel = null; } else this.subSel = this.subSel === i ? null : i;
      this.renderSubs();
    });
    box.querySelectorAll('[data-bi]').forEach(b => b.onclick = () => {
      if (this.subSel == null) return;
      const info = bench[+b.dataset.bi];
      this.subs.push({ side: me, i: this.subSel, info });
      if (this.guest) this.send({ sub: [this.subSel, info.pid] }); else this.trySubs();
      this.subSel = null;
      this.renderSubs();
    });
  }


  // アイテムの効果（自分の選手だけ。CPU はなし）
  ifx(p) { return (p && p.info.fx) || NO_FX; }
  has(p, sp) { return !!(p && p.info.fx && p.info.fx.sp.includes(sp)); }
  // ★5 にしたアイテムの特別な効果は 1.5倍（それ以外は 1）
  aw(p, sp) { return p && p.info.fx && p.info.fx.sp5 && p.info.fx.sp5.includes(sp) ? 1.5 : 1; }

  // アイテムでシュートが入りやすくなる分（特別な効果）
  itemShotBonus(p, kind, three) {
    const f = this.ifx(p), st = this.st, t = this.time;
    let b = 0;
    if (kind === 'ft') b += f.ft * 0.006;
    if (kind === 'dunk') b += f.dunk * 0.004;
    if (three && p.hot3) { b += 0.1 * this.aw(p, 'nextThree'); p.hot3 = false; }                 // スナイパーバンド
    if ((p.zoneUntil || 0) > t) b += 0.15;                             // ゾーン
    if (this.has(p, 'clutch') && st.q >= 4 && st.clock <= 60) b += 0.08 * this.aw(p, 'clutch');
    if ((p.assistUntil || 0) > t) b += 0.08;                           // 千里眼スリーブのパス
    if (this.has(p, 'afterBeat') && (p.beatUntil || 0) > t) b += 0.08 * this.aw(p, 'afterBeat');
    if (this.has(p, 'fastBreak') && (p.fbUntil || 0) > t) b += 0.1 * this.aw(p, 'fastBreak');
    if (this.has(p, 'ot') && st.q > 4) b += 0.06 * this.aw(p, 'ot');
    if (kind === 'ft' && this.aw(p, 'ftPerfect') > 1) b += 0.05;
    if (this.bond && this.bond[p.side]) b += 0.04 * (this.players[p.side].some(q => this.aw(q, 'bond') > 1) ? 1.5 : 1);                     // ピック＆ロールのきずな
    return b;
  }
  get poss() { return this.st.poss; }

  spot(side, i) {
    const d = dirOf(side), hx = d * HX;
    const S = [[7.6, 0], [6.4, -4.4], [6.4, 4.4], [2.6, -5.6], [1.8, 2.2]][i];
    const t = this.time * 0.45 + i * 1.7;
    return { x: hx - d * (S[0] + Math.sin(t) * 0.6), z: S[1] + Math.cos(t * 0.8) * 0.7 };
  }

  // 守る位置：マークする相手とリングのあいだ
  guardSpot(p) {
    const off = 1 - p.side;
    const o = this.players[off][p.i];
    const h = hoopOf(off);
    const b = this.ball.holder;
    const gap = this.state === 'throwin' ? 2.4 : b === o ? 1.0 : 1.7;
    const dx = h.x - o.pos.x, dz = h.z - o.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    let x = o.pos.x + dx / l * Math.min(gap, l * 0.5), z = o.pos.z + dz / l * Math.min(gap, l * 0.5);
    if (b && b.side === off && b !== o && d2(b.pos, h) < 5) { x += (b.pos.x - x) * 0.3; z += (b.pos.z - z) * 0.3; } // ヘルプ
    return { x, z };
  }

  kickoff(side) {
    this.all().forEach(p => {
      const s = p.side === side ? this.spot(p.side, p.i) : null;
      if (s) { s.x -= dirOf(side) * 6; p.pos = s; }
      p.vel = { x: 0, z: 0 }; p.y = 0; p.vy = 0; p.act = null; p.stun = 0;
    });
    this.all().filter(p => p.side !== side).forEach(p => { p.pos = this.guardSpot(p); });
    this.give(this.players[side][0], true);
    this.shotClock = 24;
    this.dead(1.2, () => { if (SFX) SFX.whistle(); });
  }

  // 得点・バイオレーションのあと：自分のゴール下からはじめる
  inbound(side, at) {
    const p = this.players[side][0];
    p.pos = at || { x: -dirOf(side) * (LEN - 1), z: 1.5 };
    p.vel = { x: 0, z: 0 };
    p.act = null;
    this.give(p, true);
    this.shotClock = 24;
    this.dead(0.9);
  }

  dead(t, then) { this.state = 'dead'; this.deadT = t; this.afterDead = then || null; }

  give(p, quiet) {
    const b = this.ball;
    const changed = this.st.poss !== p.side;
    if (b.mode === 'loose' && b.reb) {
      this.box(p).reb++;
      b.reb = false;
    }
    b.holder = p; b.mode = 'held'; b.last = p.side;
    p.gotAt = this.time;
    p.think = 0.4 + rand() * 0.3;
    this.st.poss = p.side;
    if (changed) this.shotClock = 24;
    // ボールを持ったチームはその選手を操作。相手チームは、その選手をマークする選手に自動で切りかえ
    if (this.human(p.side)) this.ctrls[p.side] = p;
    if (this.human(1 - p.side)) this.ctrls[1 - p.side] = this.players[1 - p.side][p.i];
    if (!quiet && changed && this.human(p.side) && this.lastLoose) this.pop('マイボール！', 'ok', p.side);
  }

  box(p) { return this.st.box[p.side][p.info.pid]; }

  // 審判のコールや試合の区切り：左からさっと出てくるカード
  // tag：左の四角に出す短い英字（FOUL・FT など）、side：有利になるチーム（そのチームの色の帯）。null は金
  // to：その端末だけに出す（通信対戦）。null は両方
  call(title, sub, tag, side = null, to = null) {
    this.relay('call', [title, sub, tag, side], to);
    if (to !== null && to !== this.me) return;
    const e = this.ui.call;
    const h = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    e.style.setProperty('--cc', side === null ? '#e8b33a' : this.colors[side]);
    e.innerHTML = `<div class="tag">${h(tag)}</div><div class="tx"><b>${h(title)}</b>${sub ? `<small>${h(sub)}</small>` : ''}</div>`;
    e.className = 'm3d-call';
    void e.offsetWidth;
    e.className = 'm3d-call show' + (side === null ? '' : side === this.me ? ' mine' : ' opp');
    this.callT = performance.now();
    this.ui.pop.className = 'm3d-pop'; // まん中の文字は消す
  }

  // 出ているカードに1行たす（ファウルのすぐあとのスローインなど）。出ていなければ新しいカード
  callAdd(text, tag, side) {
    this.relay('callAdd', [text, tag, side]);
    const e = this.ui.call;
    if (performance.now() - (this.callT || -1e9) < 900 && e.querySelector('.tx')) {
      const sm = document.createElement('small');
      sm.className = 'add';
      sm.textContent = text;
      e.querySelector('.tx').appendChild(sm);
      return;
    }
    this.relaying = true; // ゲストには callAdd として送ってあるので、call としては送らない
    this.call(text, '', tag, side);
    this.relaying = false;
  }

  pop(text, cls = '', to = null) {
    this.relay('pop', [text, cls], to);
    if (to !== null && to !== this.me) return;
    const e = this.ui.pop;
    e.textContent = text;
    e.className = 'm3d-pop show ' + cls + (text.length >= 9 ? ' long' : ''); // 長い文は小さく
    void e.offsetWidth;
  }

  is3(p, side) {
    return d2(p.pos, hoopOf(side)) >= 6.75 || Math.abs(p.pos.z) >= 6.6;
  }

  nearestOpp(p) {
    let best = null, bd = 1e9;
    this.players[1 - p.side].forEach(q => { const d = d2(p.pos, q.pos); if (d < bd) { bd = d; best = q; } });
    return { q: best, d: bd };
  }

  // ---------- アクション ----------
  pass(from, to, safe = false) {
    if (!to || to === from) return;
    const b = this.ball;
    b.mode = 'pass'; b.holder = null; b.from = from; b.to = to; b.tried = new Set(); b.safe = safe;
    b.last = from.side;
    this.lastPass = { from, to, t: this.time };
    if (this.has(from, 'assist')) to.assistUntil = this.time + 3 * this.aw(from, 'assist');
    from.face = Math.atan2(to.pos.x - from.pos.x, to.pos.z - from.pos.z);
    from.act = 'pass'; from.actT = 0;
    // パスの種類をランダムにえらぶ（遠い→オーバーヘッド、近い・間に相手→バウンドが出やすい）
    const dist = d2(from.pos, to.pos);
    const dx = (to.pos.x - from.pos.x) / (dist || 1), dz = (to.pos.z - from.pos.z) / (dist || 1);
    const between = this.players[1 - from.side].some(q => {
      const t = (q.pos.x - from.pos.x) * dx + (q.pos.z - from.pos.z) * dz;
      return t > 0.5 && t < dist - 0.5 && Math.abs((q.pos.x - from.pos.x) * dz - (q.pos.z - from.pos.z) * dx) < 0.9;
    });
    const r = rand();
    const type = dist > 11 ? (r < 0.5 ? 'over' : r < 0.9 ? 'chest' : 'bounce')
      : between ? (r < 0.5 ? 'bounce' : r < 0.75 ? 'over' : 'chest')
      : dist < 4.5 ? (r < 0.45 ? 'bounce' : r < 0.9 ? 'chest' : 'over')
      : (r < 0.55 ? 'chest' : r < 0.8 ? 'bounce' : 'over');
    from.passType = type;
    const H = from.look.height;
    const y0 = from.y + (type === 'over' ? H + 0.12 : type === 'bounce' ? H * 0.55 : H * 0.72);
    b.pos.set(from.pos.x + dx * 0.42, y0, from.pos.z + dz * 0.42);
    b.pass = { type, x0: b.pos.x, y0, z0: b.pos.z, u: 0, speed: { chest: 14, over: 12.5, bounce: 11 }[type], bounced: false };
  }

  // 十字キーの向きにいる味方（向きがなければいちばん空いている味方）
  passTarget(p) {
    const mates = this.players[p.side].filter(q => q !== p);
    const joy = this.inp[p.side].joy;
    const jl = Math.hypot(joy.x, joy.z);
    if (this.human(p.side) && jl > 0.3) {
      return mates.reduce((best, q) => {
        const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
        const s = (dx * joy.x + dz * joy.z) / ((Math.hypot(dx, dz) || 1) * jl);
        return s > best.s ? { q, s } : best;
      }, { q: null, s: -2 }).q;
    }
    return this.openest(p);
  }

  openest(p) {
    const h = hoopOf(p.side);
    return this.players[p.side].filter(q => q !== p).reduce((best, q) => {
      const s = this.nearestOpp(q).d * 1.2 - d2(q.pos, h) * 0.15;
      return s > best.s ? { q, s } : best;
    }, { q: null, s: -1e9 }).q;
  }

  startShot(p) {
    if (p.act === 'shoot' || this.ball.holder !== p) return;
    p.act = 'shoot'; p.actT = 0; p.released = false; p.jumped = false;
    const h = hoopOf(p.side);
    p.face = Math.atan2(h.x - p.pos.x, h.z - p.pos.z);
    const dh = d2(p.pos, h);
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const big = ['PF', 'C'].includes(p.info.pos.split('/')[0]) || p.look.realH >= 2.0;
    // ゴール近くで勢いがあり、ビッグマンかドライブが得意ならダンク
    p.shotKind = this.state === 'ft' ? 'ft' : dh < 2.0 && spd > 2.6 && (big || p.r.drive >= 75 || this.ifx(p).dunk >= 4 || this.has(p, 'sky')) ? 'dunk' : dh < 2.6 ? 'layup' : 'jumper';
    p.layup = p.shotKind === 'dunk' || p.shotKind === 'layup';
    // 3Dモデルの動き（見た目だけ）：スリーを後ろに下がりながら打つときはステップバック。CPU・自動のシュートはときどき
    p.shotAnim = 'jump_shot';
    if (p.look.model && p.look.model.anim && p.shotKind === 'jumper' && this.is3(p, p.side)) {
      const back = -(p.vel.x * (h.x - p.pos.x) + p.vel.z * (h.z - p.pos.z)) / (dh || 1);
      const auto = !this.human(p.side) || p !== this.ctrls[p.side];
      if (back > 0.8 || (auto && rand() < 0.4)) p.shotAnim = 'stepback3';
    }
    if (!this.human(p.side) || p !== this.ctrls[p.side]) {
      const attr = this.shotAttr(p);
      const sd = clamp(0.13 - (attr - 50) * 0.0018, 0.035, 0.15);
      // CPU はタイミングのばらつきを大きく（早すぎ・遅すぎで外すこともある）。自分の味方の自動シュートは今まで通り
      p.cpuRelease = clamp(PERFECT + gauss() * sd * (this.isCpu(p.side) ? 1 : 0.7), 0.3, 1.3) * FILL_TIME;
    }
    // 近くの相手がブロックに跳ぶ
    if (p.shotKind !== 'ft') this.players[1 - p.side].forEach(q => {
      if (d2(q.pos, p.pos) < 2.0 && q !== this.ctrls[q.side] && rand() < 0.65) q.jumpAt = this.time + 0.28 + rand() * 0.22;
    });
  }

  shotAttr(p) { return p.layup ? p.r.drive : this.is3(p, p.side) ? p.r.three : p.r.mid; }

  // ゲージの緑の幅（レイアップ・ダンクは広い）
  shotWindow(p) {
    const easy = p.side === 0 && !this.vs ? clamp(1 - this.f * 0.2, 0.75, 1.25) : 1;
    const f = this.ifx(p);
    const item = (1 + f.gauge / 100) * (this.has(p, 'eagle') ? (this.aw(p, 'eagle') > 1 ? 2.5 : 2) : 1); // ヘッドバンド・アイウェアなど
    return (0.07 + (this.shotAttr(p) - 50) * 0.0012) * ({ dunk: 2.2, layup: 1.6, ft: 1.3 }[p.shotKind] || 1) * easy * item;
  }

  release(p) {
    if (p.act !== 'shoot' || p.released) return;
    p.released = true;
    const side = p.side;
    const h = hoopOf(side);
    const dist = d2(p.pos, h);
    const three = !p.layup && this.is3(p, side);
    const kind = p.shotKind === 'ft' ? 'ft' : p.layup ? p.shotKind : three ? 'three' : 'mid';
    const r = p.r;
    let base, attr;
    if (kind === 'ft') { attr = r.mid; base = clamp(0.42 + attr * 0.004, 0.45, 0.88); }
    else if (kind === 'dunk') { attr = r.drive; base = 0.84 + attr * 0.001; }
    else if (kind === 'layup') { attr = r.drive; base = 0.54 + attr * 0.0034; }
    else if (kind === 'mid') { attr = r.mid; base = 0.28 + attr * 0.0042 - Math.max(0, dist - 2.2) * 0.018; }
    else { attr = r.three; base = 0.12 + attr * 0.0042 - Math.max(0, dist - 7.3) * 0.07; }
    if (this.isCpu(side)) base -= CPU_INSIDE[kind] || 0;
    const { q: dfd, d: dd } = this.nearestOpp(p);
    let pen = kind === 'ft' ? 0 : Math.max(0, 1.6 - dd) * 0.14 * (dfd.r.def / 70) * (kind === 'dunk' ? 0.5 : 1);
    if (kind !== 'ft' && dfd.y > 0.25 && dd < 1.4) pen += 0.08;
    if (dfd.lock && dd < 1.6) pen += 0.04;
    if (this.has(dfd, 'lockdown') && dd < 1.6) pen += 0.05 * this.aw(dfd, 'lockdown');
    if (this.human(dfd.side)) pen *= DEF_BOOST;
    pen *= 1 - 0.3 * this.tired(dfd); // 守る選手が疲れていると、守りが弱くなる
    // タイミング
    const val = p.actT / FILL_TIME;
    const w = this.shotWindow(p);
    const err = kind === 'ft' && this.has(p, 'ftPerfect') ? 0 : val <= PERFECT ? PERFECT - val : (val - PERFECT) * 2.5;
    let bonus, grade;
    p.lastGrade = err < w * 0.5 ? 'perfect' : 'other';
    if (err < w * 0.5) { bonus = 0.22; grade = 'パーフェクト！'; }
    else if (err < w * 1.3) { bonus = 0.08; grade = 'グッド'; }
    else if (err < w * 2.4) { bonus = -0.06; grade = val < PERFECT ? '少し早い' : '少し遅い'; }
    else { bonus = -0.22; grade = val < PERFECT ? '早すぎ！' : '遅すぎ！'; }
    if (this.isCpu(side)) bonus += this.f * 0.04 - CPU_NERF * 0.4;
    const prob = clamp(base - pen + bonus + this.itemShotBonus(p, kind, three) - 0.12 * this.tired(p), 0.03, 0.95);
    if (this.human(side) && p === this.ctrls[side]) this.pop(grade, err < w * 1.3 ? 'ok' : 'ng', side);

    const bs = this.box(p);
    if (kind !== 'ft') bs.fga++;
    if (three) bs.p3a++;
    this.ball.last = side;

    // ブロック
    const jumper = kind === 'ft' ? null : this.players[1 - side].find(q => q.y > 0.25 && d2(q.pos, p.pos) < 1.4);
    const blk = jumper ? this.ifx(jumper).block / 150 + (this.has(jumper, 'sky') ? 0.05 * this.aw(jumper, 'sky') : 0) : 0;
    if (jumper && rand() < (0.2 + (jumper.r.def - 60) / 150 + blk) * (three ? 0.5 : kind === 'dunk' ? 0.6 : 1) * (this.human(jumper.side) ? DEF_BOOST : 1)) {
      this.box(jumper).blk++;
      this.call('ブロック！', jumper.info.name, 'BLOCK', jumper.side);
      if (SFX) SFX.dribble(1);
      this.fx('stop', jumper.side);
      const b = this.ball;
      b.holder = null; b.mode = 'loose'; b.reb = true; b.last = jumper.side;
      b.pos.set(p.pos.x, p.look.height + 0.5, p.pos.z);
      b.vel.set(-dirOf(side) * (2 + rand() * 2), 1.5, (rand() - 0.5) * 4);
      p.act = 'land'; p.actT = 0;
      this.switchToBall();
      return;
    }

    const made = rand() < prob;
    const mine = this.human(dfd.side); // 人が操作するチームはファウルになりにくい
    const foul = kind !== 'ft' && ((p.layup && dd < 0.9 && rand() < (mine ? 0.12 : 0.18)) || (!p.layup && dd < 0.7 && rand() < (mine ? 0.04 : 0.06)));
    if (foul) this.teamFouls[dfd.side]++;
    const b = this.ball;
    b.holder = null;
    b.mode = 'shot';
    b.shot = {
      shooter: p, made, pts: three ? 3 : 2, foul, perfect: err < w * 0.5, t: 0, kind,
      T: kind === 'dunk' ? 0.16 : kind === 'layup' ? 0.55 : 0.7 + dist * 0.045,
      from: new THREE.Vector3(p.pos.x, p.y + p.look.height + 0.35, p.pos.z),
      to: made ? new THREE.Vector3(h.x, RIM_Y + 0.05, 0)
        : new THREE.Vector3(h.x - dirOf(side) * (0.18 + rand() * 0.15), RIM_Y + 0.08, (rand() - 0.5) * 0.4),
    };
    if (kind === 'dunk') {
      b.shot.from.y = p.y + p.look.height * 1.12 + 0.15;
      b.shot.ctrl = b.shot.from.clone().lerp(b.shot.to, 0.5).setY(Math.max(b.shot.from.y, RIM_Y) + 0.15);
      // リングにぶら下がる
      p.act = 'hang'; p.actT = 0; p.hangY = Math.max(p.y, RIM_Y + 0.15 - p.look.height * 1.12);
      return;
    }
    if (kind === 'layup') {
      // ボードに当てて入れる
      const bx = dirOf(side) * (LEN - 1.25);
      b.shot.ctrl = new THREE.Vector3(bx, RIM_Y + 0.75, clamp(p.pos.z * 0.3, -0.35, 0.35));
    } else {
      const peak = Math.max(b.shot.from.y, RIM_Y) + 1.0 + dist * 0.12;
      const mid = b.shot.from.clone().lerp(b.shot.to, 0.5);
      b.shot.ctrl = mid.setY(2 * peak - (b.shot.from.y + b.shot.to.y) / 2);
    }
    p.act = 'land'; p.actT = 0;
  }

  shotLanded() {
    const b = this.ball;
    const { shooter: p, made, pts, foul, perfect } = b.shot;
    const side = p.side;
    const h = hoopOf(side);
    if (b.shot.kind === 'ft') return this.ftLanded(p, made);
    p.streak = made ? (p.streak || 0) + 1 : 0;
    if (made && this.has(p, 'zone') && p.streak >= 2 && !((p.zoneUntil || 0) > this.time)) {
      const zs = 10 * this.aw(p, 'zone'); // ★5 で15秒
      p.zoneUntil = this.time + zs;
      if (this.human(p.side)) setTimeout(() => this.call('ゾーン突入！', `${p.info.name}　${zs}秒間 シュートが入りやすい`, 'ZONE', p.side, p.side), 700);
    }
    if (made && perfect && this.has(p, 'nextThree')) p.hot3 = true;
    if (made) {
      this.score(p, pts);
      this.announce(p, { dunk: 'ダンク', layup: 'レイアップ' }[b.shot.kind] || (pts === 3 ? '3P' : '2P'));
      this.hoops[side].net.userData.swish = 0.5;
      if (SFX) { if (b.shot.kind === 'dunk') SFX.rim(1); SFX.swish(); }
      this.fx(b.shot.kind === 'dunk' ? 'dunk' : pts === 3 ? 'score3' : 'score', side);
      if (b.shot.kind === 'dunk') { this.hoops[side].rim.userData.shake = 0.6; this.pop('ダンク！ +2', 'three'); }
      else if (b.shot.kind === 'layup') this.pop('レイアップ +2', 'ok');
      else this.pop(`+${pts}${perfect ? ' スウィッシュ！' : ''}`, pts === 3 ? 'three' : 'ok');
      b.mode = 'drop';
      b.pos.set(h.x, RIM_Y - 0.05, 0);
      b.vel.set(0, -2.5, 0);
      if (foul) return this.freeThrows(p, 1, () => this.inbound(1 - side));
      return this.dead(1.0, () => this.inbound(1 - side));
    }
    if (foul) {
      b.mode = 'drop';
      b.vel.set(-dirOf(side) * 1.5, 0, 0);
      return this.freeThrows(p, pts, () => this.inbound(1 - side));
    }
    // 外れ → リバウンド
    if (SFX) SFX.rim(b.shot.kind === 'dunk' ? 1 : 0.45);
    this.fx('miss', side);
    b.mode = 'loose'; b.reb = true;
    if (b.shot.kind === 'dunk') b.vel.set(-dirOf(side) * (2 + rand() * 2), 4 + rand() * 1.5, (rand() - 0.5) * 3);
    else b.vel.set(-dirOf(side) * (1.2 + rand() * 2.6), 2.4 + rand() * 1.6, (rand() - 0.5) * 3.5);
    this.lastLoose = true;
    this.switchToBall();
  }

  // 得点した選手を画面の上に出す（例：「ボイド 3P（12点）」）
  announce(p, label) {
    this.relay('ann', [p.side, p.i, label]);
    const e = this.ui.lastScore;
    e.textContent = `${shortName(p.info.name)} ${label}（${this.box(p).pts}点）`;
    e.className = 'm3d-last show side' + p.side;
    clearTimeout(this.lastT);
    this.lastT = setTimeout(() => { e.className = 'm3d-last'; }, 2600);
  }

  // 得点カード：両チーム5人ずつ（コートに出ている選手）。点が入ると数字が1点ずつふえていく
  drawScorers() {
    this.scorersDirty = false;
    this.shown = this.shown || {};
    [0, 1].forEach(side => {
      this.ui['sc' + side].innerHTML = this.players[side].map(q => {
        const pid = q.info.pid;
        if (this.shown[pid] === undefined) this.shown[pid] = this.box(q).pts;
        return `<div class="srow" data-pid="${pid}"><span class="nm">${q.info.no} ${shortName(q.info.name)}</span><b>${this.shown[pid]}</b><i class="stm"><i style="width:${Math.round(q.stam)}%"></i></i></div>`;
      }).join('');
    });
    this.rows = {};
    this.el.querySelectorAll('.m3d-scard .srow').forEach(r => { this.rows[r.dataset.pid] = r; });
  }

  // 表示している点数を本当の点数まで1点ずつふやす
  tickScores(dt) {
    this.scoreT = (this.scoreT || 0) + dt;
    if (this.scoreT < 0.09) return;
    this.scoreT = 0;
    this.all().forEach(q => {
      const pid = q.info.pid, real = this.box(q).pts;
      if (this.shown[pid] >= real) return;
      this.shown[pid]++;
      const r = this.rows[pid];
      if (!r) return;
      r.querySelector('b').textContent = this.shown[pid];
      r.classList.remove('up');
      void r.offsetWidth;
      r.classList.add('up');
    });
  }

  score(p, pts) {
    const bs = this.box(p);
    bs.fgm++;
    if (pts === 3) bs.p3m++;
    bs.pts += pts;
    this.st.score[p.side] += pts;
    const lp = this.lastPass;
    if (lp && lp.to === p && lp.from.side === p.side && this.time - lp.t < 5) this.box(lp.from).ast++;
    this.lastPass = null;
    this.st.qScores[this.st.q - 1] = [...this.st.score];
  }

  // フリースロー：ファウルされた選手がフリースローラインから打つ（自分の選手はゲージで打つ）
  freeThrows(p, n, then) {
    if (SFX) SFX.whistle();
    this.ft = { shooter: p, left: n, total: n, made: 0, then };
    setTimeout(() => this.call('ファウル', `${p.info.name} にフリースロー ${n}本`, 'FOUL', p.side), 400);
    this.dead(1.4, () => this.setupFT());
  }

  setupFT() {
    const ft = this.ft;
    const p = ft.shooter;
    const side = p.side;
    const d = dirOf(side), hx = hoopOf(side).x;
    this.state = 'ft';
    this.ball.mode = 'dead';
    this.ball.holder = null;
    // ほかの選手はレーンの横と3Pラインの外にならぶ
    const lane = [[1.6, -2.2], [1.6, 2.2], [2.6, -2.2], [2.6, 2.2], [3.6, -2.2], [3.6, 2.2]];
    const outside = [[7.2, -3], [7.2, 3], [8.5, 0]];
    let li = 0, oi = 0;
    const def = this.players[1 - side], off = this.players[side].filter(q => q !== p);
    // 守る側が先にゴールに近い場所をとる
    [def[4], off.find(q => q.i === 4) || off[0], def[3], off.find(q => q.i === 3) || off[1], def[2], def[1]]
      .forEach(q => { if (q && li < lane.length && !q.ftSpot) { const [a, z] = lane[li++]; q.ftSpot = { x: hx - d * a, z }; } });
    this.all().forEach(q => {
      if (q === p) q.ftSpot = { x: hx - d * 4.6, z: 0 };
      else if (!q.ftSpot) { const [a, z] = outside[oi++ % outside.length]; q.ftSpot = { x: hx - d * a, z }; }
      q.pos = { ...q.ftSpot };
      q.vel = { x: 0, z: 0 }; q.y = 0; q.vy = 0; q.act = null;
      q.face = Math.atan2(hx - q.pos.x, -q.pos.z);
    });
    this.ball.holder = p;
    this.ball.mode = 'held';
    this.st.poss = side;
    p.face = Math.atan2(hx - p.pos.x, 0);
    if (this.human(side)) this.ctrls[side] = p;
    p.ftWait = this.human(side) ? 8 : 1.2 + rand() * 0.5; // CPUはすこし間をおいてから。自分も8秒たったら自動で打つ
    this.call('フリースロー', `${p.info.name}　${ft.total - ft.left + 1}本目 / ${ft.total}`, 'FT', side);
  }

  ftLanded(p, made) {
    const ft = this.ft;
    const b = this.ball;
    const h = hoopOf(p.side);
    ft.left--;
    if (made) {
      ft.made++;
      this.box(p).pts += 1;
      this.announce(p, 'フリースロー');
      this.st.score[p.side] += 1;
      this.st.qScores[this.st.q - 1] = [...this.st.score];
      this.hoops[p.side].net.userData.swish = 0.5;
      if (SFX) SFX.swish();
      this.fx('score', p.side);
      b.mode = 'drop';
      b.pos.set(h.x, RIM_Y - 0.05, 0);
      b.vel.set(0, -2.5, 0);
    } else {
      if (SFX) SFX.rim(0.45);
      this.fx('miss', p.side);
    }
    this.call(made ? 'フリースロー成功' : 'フリースロー失敗', `${ft.made} / ${ft.total - ft.left} 本`, 'FT', made ? p.side : 1 - p.side);
    if (ft.left > 0) {
      if (!made) { b.mode = 'dead'; b.vel.set(-dirOf(p.side) * 1.5, 1, 0); }
      this.dead(1.0, () => this.setupFT());
      return;
    }
    // 最後の1本
    const then = ft.then;
    this.ft = null;
    this.all().forEach(q => { q.ftSpot = null; });
    if (made) { this.dead(1.0, then); return; }
    // 外れたらリバウンドから再開
    this.state = 'play';
    b.mode = 'loose'; b.reb = true;
    b.vel.set(-dirOf(p.side) * (1.2 + rand() * 2.2), 2.4 + rand() * 1.4, (rand() - 0.5) * 3);
    this.lastLoose = true;
    this.switchToBall();
  }

  turnover(side, text, at) {
    if (!at && this.ball.holder) at = { ...this.ball.holder.pos };
    this.call(text, side === 0 ? '相手ボール' : 'マイボール', 'TURNOVER', 1 - side);
    if (SFX) text.startsWith('24') ? SFX.buzzer(0.6) : SFX.whistle();
    this.fx('stop', 1 - side);
    this.ball.holder = null;
    this.ball.mode = 'dead';
    this.throwIn(1 - side, at || { x: 0, z: WID });
  }

  // スローイン：試合を止めて、いちばん近いサイドラインの外からボールを入れる
  throwIn(side, at) {
    this.ball.holder = null;
    this.ball.mode = 'dead';
    this.dead(1.0, () => {
      const z = (at.z >= 0 ? 1 : -1) * (WID + 0.45);
      const x = clamp(at.x, -LEN + 1.5, LEN - 1.5);
      const p = this.players[side].slice().sort((a, b) => d2(a.pos, { x, z }) - d2(b.pos, { x, z }))[0];
      p.pos = { x, z };
      p.vel = { x: 0, z: 0 }; p.act = null; p.y = 0;
      p.face = z > 0 ? Math.PI : 0;
      this.give(p, true);
      this.inbounder = p;
      this.state = 'throwin';
      p.tiWait = this.human(side) ? 5 : 1.0 + rand() * 0.6; // CPUはすこし待ってから。自分のチームも5秒たったら自動で入れる
      this.callAdd('スローイン', 'IN', side);
      if (SFX) SFX.whistle();
    });
  }

  // スローインのパスを出したら試合再開
  throwInPass(p, to) {
    if (!to) return;
    this.inbounder = null;
    this.state = 'play';
    this.pass(p, to, true);
  }

  // ドライブで相手を抜く
  tryBeat(p) {
    if (p.beatCd > 0) return;
    const h = hoopOf(p.side);
    const fx = h.x - p.pos.x, fz = h.z - p.pos.z;
    const fl = Math.hypot(fx, fz) || 1;
    const q = this.players[1 - p.side].find(o => {
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, l = Math.hypot(dx, dz);
      return l < 1.15 && o.stun <= 0 && (dx * fx + dz * fz) / (l * fl) > 0.4;
    });
    if (!q) return;
    p.beatCd = 0.9;
    const item = (this.has(p, 'beat') ? 0.08 * this.aw(p, 'beat') : 0) - (this.has(q, 'shadow') ? 0.12 * this.aw(q, 'shadow') : 0);
    if (rand() < clamp(0.35 + (p.r.drive - q.r.def) / 110 - (q.lock ? 0.1 : 0) + item, 0.12, 0.85)) {
      q.stun = 0.75;
      p.beatUntil = this.time + 2;
      if (this.human(p.side)) this.pop('抜いた！', 'ok', p.side);
    } else {
      p.slow = 0.5;
      if (this.human(q.side) && q === this.ctrls[q.side]) this.pop('止めた！', 'ok', q.side);
    }
  }

  trySteal(d) {
    if (d.cd > 0) return;
    d.cd = 0.9;
    d.act = 'reach'; d.actT = 0;
    const h = this.ball.holder;
    if (!h || h.side === d.side || d2(h.pos, d.pos) > 1.5 || h.act === 'shoot' || (h.safeUntil || 0) > this.time) return;
    if (h.sprint && this.has(h, 'driveSafe')) return; // 疾風ゼロ：ドライブ中はとられない
    let p = clamp(0.1 + (d.r.def - (h.r.pass + h.r.drive) / 2) / 220 + (this.isCpu(d.side) ? this.f * 0.04 - CPU_NERF * 0.3 : 0), 0.02, 0.4)
      + this.ifx(d).steal / 200;
    if (this.human(d.side)) p *= DEF_BOOST;
    p *= 1 - 0.3 * this.tired(d); // 疲れているとスティールしにくい
    if (rand() < p) {
      if (this.has(d, 'fastBreak')) d.fbUntil = this.time + 4;
      this.box(d).stl++;
      this.call('スティール！', d.info.name, 'STEAL', d.side);
      this.fx('stop', d.side);
      this.give(d, true);
    } else if (rand() < (this.human(d.side) ? 0.08 : 0.12)) {
      const n = ++this.teamFouls[d.side];
      if (n >= 5) {
        this.call('チームファウル', `${n}つ目　フリースロー`, 'FOUL', h.side);
        return this.freeThrows(h, 1, () => this.inbound(d.side));
      }
      this.call('ファウル', `${d.info.name}（チームファウル ${n}）`, 'FOUL', h.side);
      if (SFX) SFX.whistle();
      this.shotClock = Math.max(this.shotClock, 14);
      this.throwIn(h.side, { ...h.pos });
    }
  }

  jump(p, v = 3.6) { if (p.y <= 0.001) p.vy = v * (this.has(p, 'sky') ? 1 + 0.12 * this.aw(p, 'sky') : 1); }

  // ---------- 毎フレーム ----------
  loop(now) {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.guest) { if (this.players) this.updateGuest(dt); }
    else if (this.net && !this.net.ready) {
      // ホスト：相手の読み込みが終わるまで待つ
      if (!this.waitShown && this.players) { this.waitShown = true; this.call('相手の準備を待っています', '読み込みが終わると始まります', 'WAIT'); }
      if (this.players) this.all().forEach(p => this.animate(p, dt));
    }
    else if (this.intro) this.updateIntro(dt);
    else if (this.netWait) { if (this.players) this.all().forEach(p => this.animate(p, dt)); } // 通信対戦：つなぎ直すまで止める
    else if (!this.paused && this.players) this.update(dt);
    if (!this.stopped) this.render();
  }

  updateIntro(dt) {
    this.intro.t += dt;
    this.crowd.update(dt);
    if (this.crowd.near) this.crowd.near.crowd.update(dt);
    this.crowd.ribbons.forEach(t => { t.offset.x = (t.offset.x + dt * 0.02) % 1; });
    if (this.jumbo) this.jumbo.draw(this.st, Math.max(0, Math.ceil(this.shotClock)));
    this.all().forEach(p => this.animate(p, dt));
    // ボールを持っている選手がいれば、手元（胸の前で両手）に合わせる
    if (this.ball.mode === 'held' && this.ball.holder) { this.heldBall(this.ball.holder); this.ballMesh(dt); }
    if (this.intro.t >= this.intro.dur) this.endIntro();
  }

  endIntro() {
    if (!this.intro) return;
    this.intro = null;
    if (this.crowd.near) this.crowd.near.group.visible = false; // 試合中は見えないので描かない
    if (this.introCap) { this.introCap.remove(); this.introCap = null; }
    this.el.classList.remove('intro');
    this.resize();
  }

  update(dt) {
    this.time += dt;
    const st = this.st;
    const b = this.ball;
    if (this.state === 'dead') {
      this.deadT -= dt;
      if (this.deadT <= 0) {
        const f = this.afterDead;
        this.afterDead = null;
        this.state = 'play';
        if (f) f();
      }
    } else if (!this.ended && this.state === 'play') {
      st.clock = Math.max(0, st.clock - dt);
      if (b.mode === 'held' || b.mode === 'pass') this.shotClock -= dt;
      if (st.clock <= 0) this.clockZero = true;
      if (this.clockZero && b.mode !== 'shot' && b.mode !== 'drop' && this.state === 'play') this.endQuarter();
      else if (this.shotClock <= 0 && b.mode === 'held') this.turnover(b.holder.side, '24秒バイオレーション');
    }

    this.crowd.update(dt);
    if (this.jumbo) this.jumbo.draw(st, Math.max(0, Math.ceil(this.shotClock)));
    if (this.leds) this.leds.tex.offset.x = (this.leds.tex.offset.x + dt * 0.03) % 1;
    this.crowd.ribbons.forEach(t => { t.offset.x = (t.offset.x + dt * 0.02) % 1; });
    this.crowd.look(b.pos.x, b.pos.z);
    this.handleInput(dt);
    this.all().forEach(p => this.think(p, dt));
    this.move(dt);
    this.tire(dt);
    if (this.state === 'dead' || this.state === 'throwin') {
      if (!this.subChecked) { this.subChecked = true; if (!this.vs) this.autoSubs(1); }
      this.trySubs();
    } else this.subChecked = false;
    // BGM：ボールを持っているチームでオフェンス／ディフェンスの曲を切りかえる（0.5秒つづいたら）
    const want = this.st.poss === this.me ? 'off' : 'def';
    if (want !== this.bgmMode) {
      this.bgmT = (this.bgmT || 0) + dt;
      if (this.bgmT > 0.5) { this.bgmMode = want; this.bgmT = 0; if (SFX && SFX.setBgmMode) SFX.setBgmMode(want); }
    } else this.bgmT = 0;
    this.updateBall(dt);
    this.all().forEach(p => this.animate(p, dt));
    this.ballToHand();
    if (this.net) this.netTick(dt);
  }

  endQuarter() {
    const st = this.st;
    this.clockZero = false;
    if (st.q >= 4 && st.score[0] !== st.score[1]) {
      this.ended = true;
      this.call('試合終了！', `${st.sides[0].team.short} ${st.score[0]} - ${st.score[1]} ${st.sides[1].team.short}`, 'FINAL');
      if (SFX) { SFX.buzzer(1.4); if (st.score[0] > st.score[1]) SFX.cheer(1); }
      if (st.score[0] > st.score[1]) this.cheer(1, true);
      this.dead(2.2, () => { if (this.net) this.send({ end: { score: st.score, box: st.box, qScores: st.qScores } }); this.destroy(); this.o.onEnd(st); });
      return;
    }
    st.q++;
    st.clock = st.q > 4 ? Math.min(60, st.qLen) : st.qLen; // 同点なら1分の延長
    // クォーターの間の休けい：コートの選手 +10、ベンチ +30
    this.all().forEach(p => { p.stam = Math.min(100, p.stam + 10); });
    Object.keys(this.stam).forEach(pid => { this.stam[pid] = Math.min(100, this.stam[pid] + 30); });
    if (st.q <= 4) this.teamFouls = [0, 0];
    st.qScores.push([...st.score]);
    this.call(st.q > 4 ? '延長戦！' : `第${st.q}クォーター`, `${st.sides[0].team.short} ${st.score[0]} - ${st.score[1]} ${st.sides[1].team.short}`, st.q > 4 ? 'OT' : `Q${st.q}`);
    if (SFX) SFX.buzzer(1.1);
    this.ball.mode = 'dead';
    this.ball.holder = null;
    this.dead(1.8, () => this.kickoff((this.firstPoss + st.q - 1) % 2));
  }

  handleInput(dt) {
    [0, 1].forEach(side => { if (this.human(side)) this.handleSide(side); });
  }

  handleSide(side) {
    const I = this.inp[side];
    const edges = I.edges.splice(0);
    const c = this.ctrls[side];
    if (c && this.state === 'ft' && this.ball.holder === c) {
      for (const e of edges) {
        if (e.k === 'b' && e.down) this.startShot(c);
        if (e.k === 'b' && !e.down) this.release(c);
      }
      if (c.act === 'shoot' && !c.released && c.actT / FILL_TIME > 1.3) this.release(c);
      return;
    }
    if (c && this.state === 'throwin') {
      const b = this.ball;
      if (b.holder === c) {
        for (const e of edges) if (e.k === 'a' && e.down) this.throwInPass(c, this.passTarget(c));
      } else {
        for (const e of edges) if (e.k === 'b' && e.down) this.jump(c, 3.8);
        c.lock = I.btn.c && b.holder && b.holder.side !== c.side;
      }
      return;
    }
    if (!c || this.state !== 'play') { if (c && c.act === 'shoot' && !I.btn.b) this.release(c); return; }
    const b = this.ball;
    const offense = b.holder === c;
    for (const e of edges) {
      if (offense) {
        if (e.k === 'a' && e.down && c.act !== 'shoot') this.pass(c, this.passTarget(c));
        if (e.k === 'b' && e.down) this.startShot(c);
        if (e.k === 'b' && !e.down) this.release(c);
      } else {
        if (e.k === 'a' && e.down) this.trySteal(c);
        if (e.k === 'b' && e.down) this.jump(c, 3.8);
      }
    }
    if (c.act === 'shoot' && !c.released && c.actT / FILL_TIME > 1.3) this.release(c);
    c.sprint = offense && I.btn.c;
    c.lock = !offense && I.btn.c; // ディフェンス長押し：自動でマークにつく
    if (c.sprint && offense) this.tryBeat(c);
  }

  // ルーズボールのときは、ボールにいちばん近い自分の選手に切りかえ
  switchToBall() {
    const b = this.ball;
    [0, 1].forEach(side => {
      if (this.human(side)) this.ctrls[side] = this.players[side].slice().sort((p, q) => d2(p.pos, b.pos) - d2(q.pos, b.pos))[0];
    });
  }

  // AI：どこへ動くか・何をするか
  think(p, dt) {
    p.cd -= dt; p.stun -= dt; p.slow -= dt; p.beatCd -= dt;
    if (p !== this.ctrls[p.side]) p.lock = false;
    if (p.jumpAt && this.time >= p.jumpAt) { p.jumpAt = 0; this.jump(p, 3.6); }
    if (p.act === 'shoot') {
      p.actT += dt;
      const jv = { dunk: 4.4, layup: 3.4, jumper: 2.9, ft: 1.2 }[p.shotKind];
      if (!p.jumped && p.actT >= PERFECT * FILL_TIME - jv / 11) { p.jumped = true; this.jump(p, jv); }
      if (p.cpuRelease !== undefined && p.actT >= p.cpuRelease) { this.release(p); p.cpuRelease = undefined; }
      p.tgt = null;
      return;
    }
    if (p.act === 'hang') {
      p.actT += dt;
      if (p.actT > 0.45) { p.act = 'land'; p.actT = 0; }
      p.tgt = null;
      return;
    }
    if (p.act) { p.actT += dt; if (p.actT > 0.35 && p.y <= 0) p.act = null; }
    const b = this.ball;
    if (this.state === 'ft' || (this.ft && this.state === 'dead')) {
      p.tgt = p.ftSpot || null;
      if (b.holder === p) {
        p.ftWait -= dt;
        if (p.ftWait <= 0 && !p.act) {
          this.startShot(p);
          if (this.human(p.side)) p.cpuRelease = FILL_TIME * (0.8 + rand() * 0.25); // 自動のときはふつうのタイミング
        }
      }
      return;
    }
    const isCtrl = p === this.ctrls[p.side];
    const joy = this.inp[p.side].joy;
    if (isCtrl) {
      if (this.state === 'throwin' && b.holder === p) {
        // ボタンを押さなくても5秒で自動のスローイン
        p.tgt = null;
        p.tiWait -= dt;
        if (p.tiWait <= 0) this.throwInPass(p, this.passTarget(p));
        return;
      }
      if (this.state !== 'play' && this.state !== 'throwin') { p.tgt = null; return; }
      if (p.lock) {
        const g = b.mode === 'loose' ? { x: b.pos.x + b.vel.x * 0.25, z: b.pos.z + b.vel.z * 0.25 } : this.guardSpot(p);
        p.tgt = { x: g.x + joy.x * 1.2, z: g.z + joy.z * 1.2 };
      } else p.tgt = { joy: true };
      return;
    }
    if (this.state === 'throwin' && b.holder === p) {
      p.tgt = null;
      p.tiWait -= dt;
      if (p.tiWait <= 0) this.throwInPass(p, this.openest(p));
      return;
    }
    if (this.state !== 'play' && b.holder === p) { p.tgt = null; return; }
    // ルーズボール：近い2人がボールを追う
    if (b.mode === 'loose') {
      const near = this.players[p.side].slice().sort((x, y) => d2(x.pos, b.pos) - d2(y.pos, b.pos)).slice(0, 2);
      if (near.includes(p)) {
        p.tgt = { x: b.pos.x + b.vel.x * 0.25, z: b.pos.z + b.vel.z * 0.25 };
        if (d2(p.pos, b.pos) < 1.3 && b.pos.y > 2.4 && b.pos.y < 3.8 && b.vel.y < 0 && rand() < 0.15) this.jump(p, 3.4);
        return;
      }
    }
    const off = b.holder ? b.holder.side : this.st.poss;
    if (b.holder === p) return this.thinkHolder(p, dt);
    if (p.side === off) p.tgt = this.spot(p.side, p.i);
    else {
      p.tgt = this.guardSpot(p);
      const h = b.holder;
      if (h && h.side !== p.side && h === this.players[off][p.i] && this.state === 'play') {
        if (d2(h.pos, p.pos) < 1.2 && p.cd <= 0 && rand() < dt * 0.6 * (this.isCpu(p.side) ? (1 - CPU_NERF * 2) * (1 + this.f * 0.5) : 1)) this.trySteal(p);
      }
    }
  }

  thinkHolder(p, dt) {
    const h = hoopOf(p.side);
    if (this.state !== 'play') { p.tgt = null; return; }
    // ゴール下：ダンクできる選手は勢いのまま飛びこむ（毎フレーム見る）
    const close = d2(p.pos, h);
    const canDunk = ['PF', 'C'].includes(p.info.pos.split('/')[0]) || p.look.realH >= 2.0 || p.r.drive >= 75;
    if (close < (canDunk ? 1.9 : 2.3)) return this.startShot(p);
    p.think -= dt;
    if (p.think <= 0) {
      p.think = 0.3 + rand() * 0.3;
      const dh = d2(p.pos, h);
      const open = this.nearestOpp(p).d;
      const three = this.is3(p, p.side);
      const rate = three ? p.r.three : p.r.mid;
      const backcourt = (p.pos.x - 0) * dirOf(p.side) < 0;
      if (this.shotClock < 2.5 && !backcourt) return this.startShot(p);
      if (!backcourt && dh < 7.6 && open > 1.25 && rand() < (rate - 45) / 110) return this.startShot(p);
      if (this.time - p.gotAt > 0.8 && rand() < (backcourt ? 0.1 : 0.24)) return this.pass(p, this.openest(p));
      if (backcourt) p.goal = this.spot(p.side, p.i);
      else if (p.r.drive >= 62 || open > 1.6 || rand() < 0.3) p.goal = { x: h.x - dirOf(p.side) * 0.8, z: (p.pos.z > 0 ? 1 : -1) * (0.5 + rand()) };
      else p.goal = this.spot(p.side, p.i);
      p.sprint = !backcourt && rand() < p.r.drive / 140;
    }
    p.tgt = p.goal;
    if (p.sprint) this.tryBeat(p);
  }

  move(dt) {
    const ps = this.all();
    ps.forEach(p => {
      let dx = 0, dz = 0;
      if (p.act === 'shoot' && p.layup) {
        // リングに向かって踏みこむ（ダンクは強く）
        const h = hoopOf(p.side), tx = h.x - p.pos.x, tz = h.z - p.pos.z, l = Math.hypot(tx, tz) || 1;
        const stop = p.shotKind === 'dunk' ? 0.45 : 0.7;
        if (l > stop) { const f = p.shotKind === 'dunk' ? 0.85 : 0.6; dx = tx / l * f; dz = tz / l * f; }
      } else if (p.act === 'shoot' || p.act === 'hang' || p.stun > 0) { /* 止まる */ }
      else if (p.tgt && p.tgt.joy) { const j = this.inp[p.side].joy; dx = j.x; dz = j.z; }
      else if (p.tgt) {
        const tx = p.tgt.x - p.pos.x, tz = p.tgt.z - p.pos.z, l = Math.hypot(tx, tz);
        if (l > 0.12) { const k = Math.min(1, l / 1.2); dx = tx / l * k; dz = tz / l * k; }
      }
      const base = (4.6 + (p.r.drive + p.r.def) * 0.012 + (this.isCpu(p.side) ? this.f * 0.25 : 0)) * (this.isCpu(p.side) ? 1 - CPU_NERF * 0.6 : 1);
      let sp = base * (p.sprint ? 1.3 : 1) * (this.ball.holder === p ? 0.92 : 1) * (p.slow > 0 ? 0.5 : 1);
      // アイテム：速さ（%）、横浜グリーンソックスは守るときにさらに速い
      sp *= 1 + this.ifx(p).speed * 0.012;
      if (this.has(p, 'chase') && this.ball.holder && this.ball.holder.side !== p.side) sp *= 1 + 0.08 * this.aw(p, 'chase');
      if (p.sprint && this.aw(p, 'driveSafe') > 1) sp *= 1.05;
      if (p.stun > 0) sp *= 0.2;
      sp *= 1 - 0.18 * this.tired(p); // 疲れると遅くなる
      const k = Math.min(1, dt * 9);
      p.vel.x += (dx * sp - p.vel.x) * k;
      p.vel.z += (dz * sp - p.vel.z) * k;
      if (p.y > 0) { p.vel.x *= 0.98; p.vel.z *= 0.98; }
      if (this.state === 'throwin' && p === this.inbounder) { p.vel.x = p.vel.z = 0; }
      else {
        p.pos.x = clamp(p.pos.x + p.vel.x * dt, -LEN + 0.3, LEN - 0.3);
        p.pos.z = clamp(p.pos.z + p.vel.z * dt, -WID + 0.3, WID - 0.3);
      }
      // ジャンプ
      if (p.act === 'hang') { p.y = p.hangY; p.vy = 0; p.vel.x = p.vel.z = 0; }
      else if (p.y > 0 || p.vy > 0) { p.vy -= 11 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0; }
      // 向き
      const spd = Math.hypot(p.vel.x, p.vel.z);
      // バッシュのキュッ：急に向きを変えた・急に止まった・急に走りだしたとき（床にいるときだけ）
      if (SFX && p.y === 0 && p.lastVel && this.time - (p.squeakT || 0) > 0.45) {
        const lsp = Math.hypot(p.lastVel.x, p.lastVel.z);
        const dot = (p.vel.x * p.lastVel.x + p.vel.z * p.lastVel.z) / ((spd * lsp) || 1);
        const turn = spd > 2.2 && lsp > 2.2 && dot < 0.55; // 約55度より大きく曲がった
        const stop = lsp > 4 && spd < 1.2;
        const go = lsp < 0.8 && spd > 3.5;
        // 同時にたくさん鳴りすぎないよう、コート全体で 0.12 秒あける
        if ((turn || stop || go) && this.time - (this.squeakAll || 0) > 0.12 && rand() < 0.85) {
          p.squeakT = this.squeakAll = this.time;
          // カメラから遠い選手の音は小さく。切り返し（逆向き）は「キュッキュッ」
          SFX.squeak(clamp(1 - Math.abs(p.pos.x - this.camX) / 18, 0.35, 1), turn && dot < 0 ? 2 : 1);
        }
      }
      if (this.time - (p.velT || 0) > 0.15) { p.lastVel = { x: p.vel.x, z: p.vel.z }; p.velT = this.time; }
      if (this.state === 'ft') { /* ならんだときの向きのまま */ }
      else if (p.act !== 'shoot' && p.act !== 'pass') {
        const b = this.ball;
        const defending = b.holder && b.holder.side !== p.side;
        if (defending && spd < 2.5) { const o = this.players[1 - p.side][p.i]; p.face = Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z); }
        else if (spd > 0.4) p.face = Math.atan2(p.vel.x, p.vel.z);
      }
    });
    // ぶつからないように押しあう
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, l = Math.hypot(dx, dz);
      if (l > 0 && l < 0.8) {
        const push = (0.8 - l) / 2;
        const wa = this.ball.holder === a ? 0.4 : 1, wc = this.ball.holder === c ? 0.4 : 1;
        a.pos.x -= dx / l * push * wa; a.pos.z -= dz / l * push * wa;
        c.pos.x += dx / l * push * wc; c.pos.z += dz / l * push * wc;
      }
    }
  }

  updateBall(dt) {
    const b = this.ball;
    if (b.mode === 'held' && b.holder) {
      const sn = this.heldBall(b.holder);
      // ボールが床に着いた瞬間にドリブルの音（カメラから遠いほど小さく）
      if (SFX && sn !== null && (sn > 0) !== this.dribSign) {
        this.dribSign = sn > 0;
        SFX.dribble(clamp(1 - Math.abs(b.holder.pos.x - this.camX) / 16, 0.15, 1) * 0.7);
      }
    } else if (b.mode === 'pass') {
      const to = b.to, P = b.pass || (b.pass = { type: 'chest', x0: b.pos.x, y0: b.pos.y, z0: b.pos.z, u: 0, speed: 14 });
      // 投げた所から受け手（動いている）までの道のりのうち、どこまで来たか（u：0〜1）
      const endY = (P.type === 'bounce' ? 0.95 : 1.3) + to.y;
      const total = Math.max(1, Math.hypot(to.pos.x - P.x0, to.pos.z - P.z0));
      P.u = Math.min(1, P.u + P.speed * dt / total);
      const u = P.u, K = 0.56; // バウンドパスは道のりの56%のところで床にはずむ
      let y;
      if (P.type === 'over') y = P.y0 + (endY - P.y0) * u + Math.sin(Math.PI * u) * Math.min(1.1, 0.09 * total);
      else if (P.type === 'bounce') y = u < K ? P.y0 + (BALL_R - P.y0) * (u / K) : BALL_R + (endY - BALL_R) * ((u - K) / (1 - K));
      else y = P.y0 + (endY - P.y0) * u + Math.sin(Math.PI * u) * Math.min(0.25, 0.03 * total);
      if (P.type === 'bounce' && !P.bounced && u >= K) { P.bounced = true; if (SFX) SFX.dribble(0.8); }
      if (u >= 1) {
        if (b.safe) to.safeUntil = this.time + 1.6; // スローインを受けた直後はスティールされない
        this.give(to);
        this.lastLoose = false;
      }
      else {
        b.pos.set(P.x0 + (to.pos.x - P.x0) * u, y, P.z0 + (to.pos.z - P.z0) * u);
        // パスカット
        if (!b.safe) this.players[1 - b.from.side].forEach(q => {
          if (b.tried.has(q) || d2(q.pos, b.pos) > 0.6 || b.pos.y > 2.4 + q.y) return;
          b.tried.add(q);
          if (q.stun > 0) return;
          let pc = clamp(0.18 + (q.r.def - 60) / 160 + (this.isCpu(q.side) ? this.f * 0.06 - CPU_NERF * 0.4 : 0), 0.03, 0.5);
          pc += this.ifx(q).steal / 250 + (this.has(q, 'readPass') ? 0.08 * this.aw(q, 'readPass') : 0);
          if (this.human(q.side)) pc *= DEF_BOOST;
          if (P.type === 'bounce') pc *= 1.1; // バウンドパスは遅いぶん少しだけカットされやすい
          if (this.has(b.from, 'noCut')) pc *= this.aw(b.from, 'noCut') > 1 ? 0.25 : 0.4;
          if (rand() < pc) { if (this.has(q, 'fastBreak')) q.fbUntil = this.time + 4; this.box(q).stl++; this.call('パスカット！', q.info.name, 'STEAL', q.side); this.fx('stop', q.side); this.give(q, true); }
        });
      }
    } else if (b.mode === 'shot') {
      const s = b.shot;
      s.t += dt / s.T;
      const t = Math.min(1, s.t), u = 1 - t;
      b.pos.set(0, 0, 0).addScaledVector(s.from, u * u).addScaledVector(s.ctrl, 2 * u * t).addScaledVector(s.to, t * t);
      if (s.t >= 1) this.shotLanded();
    } else if (b.mode === 'loose' || b.mode === 'drop' || b.mode === 'dead') {
      b.vel.y -= 9.8 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < 0.12) { b.pos.y = 0.12; b.vel.y = Math.abs(b.vel.y) * 0.62; b.vel.x *= 0.85; b.vel.z *= 0.85; }
      if (b.mode === 'loose' && this.state === 'play') {
        if (Math.abs(b.pos.x) > LEN || Math.abs(b.pos.z) > WID) {
          this.turnover(b.last, 'アウトオブバウンズ', { x: clamp(b.pos.x, -LEN + 0.5, LEN - 0.5), z: clamp(b.pos.z, -WID + 0.5, WID - 0.5) });
          return;
        }
        // リバウンド：手がとどく人がとる（リバウンド力が高いほど広い）
        let best = null, bd = 1e9;
        this.all().forEach(p => {
          const d = d2(p.pos, b.pos);
          const reach = p.look.realH * 1.25 + p.y;
          if (d < 0.55 + p.r.reb / 180 + (this.has(p, 'rebPos') ? 0.15 * this.aw(p, 'rebPos') : 0) && b.pos.y < reach && d < bd) { bd = d; best = p; }
        });
        if (best && (b.pos.y < RIM_Y - 0.3 || b.vel.y < 0)) {
          const off = best.side === this.st.poss;
          this.give(best, true);
          if (this.human(best.side)) this.pop(off ? 'オフェンスリバウンド！' : 'リバウンド！', 'ok', best.side);
          if (off) this.shotClock = Math.max(this.shotClock, 14);
        }
      }
    }
    this.ballMesh(dt);
  }

  // 3Dモデルの動きでドリブルしているとき：体を動かしたあとの手の位置にボールを合わせなおす（1コマ遅れないように）
  ballToHand() {
    const b = this.ball, h = b.holder;
    const A = h && h.look.model && h.look.model.anim;
    if (b.mode === 'held' && A && A.ballW > 0) { this.heldBall(h, true); this.ballMesh(0); }
  }

  // ボールを持っている選手の手元のボールの位置（ドリブル中は、床に着く向きの sin を返す）
  // again：同じコマでの2回目（音の判定はしない）
  heldBall(p, again = false) {
    const b = this.ball;
    const lk = p.look;
    if (p.act === 'shoot' && p.shotKind === 'dunk') {
      // 両手で頭の上にふりかぶる
      const up = Math.min(1, p.actT / (PERFECT * FILL_TIME));
      b.pos.set(p.pos.x + Math.sin(p.face) * (0.25 - up * 0.1), p.y + lk.height * (0.75 + up * 0.42), p.pos.z + Math.cos(p.face) * (0.25 - up * 0.1));
    } else if (p.act === 'shoot' && p.shotKind === 'layup') {
      // 右手で持ち上げる
      const side = p.face - 0.35;
      const up = Math.min(1, p.actT / (PERFECT * FILL_TIME));
      b.pos.set(p.pos.x + Math.sin(side) * 0.28, p.y + lk.height * (0.7 + up * 0.5), p.pos.z + Math.cos(side) * 0.28);
    } else if (p.act === 'shoot') {
      b.pos.set(p.pos.x + Math.sin(p.face) * 0.15, p.y + lk.height * (0.95 + Math.min(p.actT * 0.5, 0.25)), p.pos.z + Math.cos(p.face) * 0.15);
    } else if (this.state === 'throwin' || this.state === 'dead') {
      // スローイン・試合開始の前など（プレーが止まっているとき）：ドリブルせず、胸の前で両手で持つ
      b.pos.set(p.pos.x + Math.sin(p.face) * 0.32, p.y + lk.height * 0.62, p.pos.z + Math.cos(p.face) * 0.32);
    } else {
      // 3Dモデルの動きがある選手は、ボールを持っている手の側でつく
      const A = lk.model && lk.model.anim;
      const side = p.face + Math.PI / 2 * 0.7 * (A && A.hand === 'R' ? -1 : 1);
      const sn = Math.sin(this.time * 8.5);
      const bounce = Math.abs(sn);
      b.pos.set(p.pos.x + Math.sin(side) * 0.38, 0.13 + bounce * 0.82 + p.y, p.pos.z + Math.cos(side) * 0.38);
      if (A && A.ballW > 0) {
        // 動きのデータのボールの位置（手の動きに合わせたもの）へ寄せる
        const v = A.ballNode.getWorldPosition(_ballV);
        b.pos.lerp(v, A.ballW);
        // 床で跳ねた瞬間（下がる → 上がる）に符号を変えて、ドリブルの音を鳴らす
        if (!again) {
          if (A.down && v.y > A.by + 1e-4) A.sign = -A.sign;
          A.down = v.y < A.by - 1e-4; A.by = v.y;
        }
        if (A.ballW > 0.5) return A.sign;
      }
      return sn;
    }
    return null;
  }

  // ボール・影・ネット・リングの見た目
  ballMesh(dt) {
    const b = this.ball;
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.x += dt * 6;
    b.shadow.position.set(b.pos.x, 0.013, b.pos.z);
    this.hoops.forEach(hp => {
      const n = hp.net;
      if (n.userData.swish > 0) {
        // ボールが通ると、ネットが下にのびて、すぼまり、ゆれてもどる
        n.userData.swish -= dt;
        const k = n.userData.swish / 0.5;
        n.scale.set(1 - Math.sin(k * Math.PI) * 0.12, 1 + Math.sin(n.userData.swish * 25) * 0.25 * k + 0.15 * k, 1 - Math.sin(k * Math.PI) * 0.12);
      } else n.scale.set(1, 1, 1);
      const rim = hp.rim;
      if (rim.userData.shake > 0) { rim.userData.shake -= dt; rim.position.y = RIM_Y - Math.sin(rim.userData.shake * 40) * 0.05 * rim.userData.shake; }
      else rim.position.y = RIM_Y;
    });
  }

  animate(p, dt) {
    const lk = p.look;
    lk.root.position.set(p.pos.x, p.y, p.pos.z);
    lk.root.rotation.y = p.face;
    lk.shadow.position.y = 0.012 - p.y;
    lk.shadow.scale.setScalar(Math.max(0.5, 1 - p.y * 0.4));
    const spd = Math.hypot(p.vel.x, p.vel.z);
    p.phase += dt * (3 + spd * 2.2);
    const sw = Math.min(spd / 5, 1) * 0.9;
    const s = Math.sin(p.phase);
    const air = p.y > 0.02;
    const b = this.ball;
    const defending = b.holder && b.holder.side !== p.side && !air;
    const stance = defending && spd < 3 ? 1 : 0;
    lk.body.position.y = -stance * 0.1;
    lk.legs[0].hip.rotation.set(air ? -0.5 : s * sw - stance * 0.35, 0, stance * 0.12);
    lk.legs[1].hip.rotation.set(air ? -0.2 : -s * sw - stance * 0.35, 0, -stance * 0.12);
    lk.legs[0].knee.rotation.x = air ? 0.9 : Math.max(0, -s) * sw * 1.3 + stance * 0.6;
    lk.legs[1].knee.rotation.x = air ? 0.5 : Math.max(0, s) * sw * 1.3 + stance * 0.6;
    const [L, R] = lk.arms;
    if (p.act === 'hang') {
      // リングにぶら下がる：両手を上、脚は前に
      L.sh.rotation.set(-3.0, 0, -0.25); R.sh.rotation.set(-3.0, 0, 0.25);
      L.el.rotation.x = 0; R.el.rotation.x = 0;
      lk.legs[0].hip.rotation.set(-0.7, 0, 0); lk.legs[1].hip.rotation.set(-0.4, 0, 0);
      lk.legs[0].knee.rotation.x = 1.0; lk.legs[1].knee.rotation.x = 0.8;
    } else if (p.act === 'shoot' && p.shotKind === 'layup') {
      // レイアップ：右手を高く、左ひざを上げる
      const up = Math.min(1, p.actT / (PERFECT * FILL_TIME));
      R.sh.rotation.set(-1.2 - up * 1.8, 0, 0.1); R.el.rotation.x = -0.4 + up * 0.3;
      L.sh.rotation.set(-1.0, 0, -0.3); L.el.rotation.x = -1.0;
      if (air) { lk.legs[0].hip.rotation.set(-1.3, 0, 0); lk.legs[0].knee.rotation.x = 1.5; lk.legs[1].hip.rotation.set(0.3, 0, 0); lk.legs[1].knee.rotation.x = 0.3; }
    } else if (p.act === 'shoot' && p.shotKind === 'dunk') {
      // ダンク：両手でふりかぶる
      const up = Math.min(1, p.actT / (PERFECT * FILL_TIME));
      L.sh.rotation.set(-1.0 - up * 2.0, 0, -0.2); R.sh.rotation.set(-1.0 - up * 2.0, 0, 0.2);
      L.el.rotation.x = -0.8 + up * 0.6; R.el.rotation.x = -0.8 + up * 0.6;
      if (air) { lk.legs[0].hip.rotation.set(-0.9, 0, 0); lk.legs[0].knee.rotation.x = 1.3; lk.legs[1].hip.rotation.set(0.2, 0, 0); lk.legs[1].knee.rotation.x = 0.6; }
    } else if (p.act === 'shoot' || (air && b.holder !== p && p.vy !== 0)) {
      // シュート・ブロック：両手を上に
      const up = p.act === 'shoot' ? -2.6 - Math.min(p.actT, 0.3) : -2.9;
      L.sh.rotation.set(up, 0, -0.15); R.sh.rotation.set(up, 0, 0.15);
      L.el.rotation.x = -0.5; R.el.rotation.x = -0.5;
    } else if (p.act === 'pass') {
      // パスの種類ごとに、ひじを曲げた形からぐっと押し出す
      const k = Math.min(1, p.actT / 0.16);
      const [sh0, sh1, el0] = { over: [-3.0, -2.2, -1.4], bounce: [-0.6, -1.0, -1.4], chest: [-1.1, -1.45, -1.7] }[p.passType] || [-1.4, -1.4, 0];
      const a = sh0 + (sh1 - sh0) * k, e = el0 * (1 - k);
      L.sh.rotation.set(a, 0, -0.12); R.sh.rotation.set(a, 0, 0.12);
      L.el.rotation.x = e; R.el.rotation.x = e;
      if (p.passType === 'bounce') { lk.legs[0].knee.rotation.x = 0.5; lk.legs[1].knee.rotation.x = 0.5; lk.legs[0].hip.rotation.x = -0.4; lk.legs[1].hip.rotation.x = -0.4; }
    } else if (p.act === 'reach') {
      L.sh.rotation.set(-1.4, 0, -0.1); R.sh.rotation.set(-1.4, 0, 0.1);
      L.el.rotation.x = 0; R.el.rotation.x = 0;
    } else if (b.holder === p && (this.state === 'throwin' || this.state === 'dead')) {
      // スローイン・試合開始の前など：胸の前で両手で持つ
      L.sh.rotation.set(-1.1, 0, -0.12); R.sh.rotation.set(-1.1, 0, 0.12);
      L.el.rotation.x = -1.6; R.el.rotation.x = -1.6;
    } else if (b.holder === p) {
      // ドリブル：右手でボールをつく（3Dモデルの動きがある選手は、ボールを持っている手で）
      const A = lk.model && lk.model.anim, rh = A && A.hand === 'R';
      const D = rh ? L : R, O = rh ? R : L, sg = rh ? -1 : 1;
      const bounce = Math.abs(Math.sin(this.time * 8.5));
      D.sh.rotation.set(-0.5 + bounce * 0.25, 0, 0.55 * sg);
      D.el.rotation.x = -0.6 + bounce * 0.4;
      O.sh.rotation.set(-s * sw * 0.8, 0, -0.2 * sg);
      O.el.rotation.x = -0.4;
    } else if (stance) {
      L.sh.rotation.set(-0.3, 0, -1.0); R.sh.rotation.set(-0.3, 0, 1.0);
      L.el.rotation.x = -0.6; R.el.rotation.x = -0.6;
    } else {
      L.sh.rotation.set(-s * sw * 0.9, 0, -0.12); R.sh.rotation.set(s * sw * 0.9, 0, 0.12);
      L.el.rotation.x = -0.3 - sw * 0.5; R.el.rotation.x = -0.3 - sw * 0.5;
    }
    if (lk.model) this.animModel(p, dt);
  }

  // 3Dモデルの動き：ドリブル・シュート・技は動きのデータを再生し、ほかはいつもの体の関節に合わせる
  animModel(p, dt) {
    const lk = p.look, m = lk.model, A = m.anim;
    if (!A) return poseModel(lk);
    const b = this.ball;
    const cur = A.cur, curA = cur && A.acts[cur];
    const done = !curA || (curA.loop === THREE.LoopOnce && curA.time >= curA.getClip().duration - 1e-3);
    let name = null, t = null;
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const holding = b.holder === p && !p.act && this.state === 'play';
    // フロントチェンジ（crossover）の動きはファイルにあるが、手とボールが合いきらないので使わない
    const move = null;
    if (p.act === 'shoot' && (p.shotKind === 'jumper' || p.shotKind === 'ft')) {
      // シュート：ゲームが跳ぶ時刻に、動きの踏み切りを合わせる
      name = p.shotAnim || 'jump_shot';
      const jv = p.shotKind === 'ft' ? 1.2 : 2.9;
      const aj = Math.max(0.05, PERFECT * FILL_TIME - jv / 11);
      const [s0, to] = name === 'stepback3' ? [0, 0.82] : [0.5, 0.95];
      t = p.actT < aj ? s0 + (to - s0) * p.actT / aj : to + (p.actT - aj);
    } else if (SHOT_CLIPS.has(cur) && !done && p.act === 'land') {
      name = cur; // 打ったあと：着地まで続ける
    } else if (holding) {
      if (move) name = move;
      else if (MOVE_CLIPS.has(cur) && !done) name = cur;
      // 止まっているときだけ、その場のドリブル。走っているときは、これまでどおりの動き（name = null）
      else if (spd < 0.6 || (cur && cur.startsWith('dribble') && spd < 1.0)) name = A.hand === 'L' ? 'dribble_l' : 'dribble';
    }
    // フロントチェンジが終わったら（途中で止めても）、ボールを持つ手が入れかわる
    if (MOVE_CLIPS.has(cur) && name !== cur) A.hand = cur === 'crossover' ? 'L' : 'R';
    if (name !== cur || move) {
      if (curA && name !== cur) curA.fadeOut(0.18);
      if (name) {
        const a = A.acts[name];
        a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.18).play();
        if (MOVE_CLIPS.has(name)) A.face0 = lk.root.rotation.y;
      }
      A.cur = name;
    }
    if (name) {
      const a = A.acts[name];
      if (t !== null) { a.timeScale = 0; a.time = Math.min(t, a.getClip().duration); } else a.timeScale = 1;
      // 技の間は、体の向きを元の向きから今の向きへゆっくり回す（スピンはその上で1回転する）
      if (MOVE_CLIPS.has(name)) {
        const u = Math.min(1, a.time / a.getClip().duration), k = u * u * (3 - 2 * u);
        lk.root.rotation.y = A.face0 + angDiff(p.face, A.face0) * k;
      }
    }
    A.mixer.update(dt);
    // ボールを手の動きに合わせる割合（切りかえのときは 0.15 秒かけて移す）
    A.ballW = clamp(A.ballW + (name && BALL_CLIPS.has(name) ? dt : -dt) / 0.15, 0, 1);
    if (name) m.holder.position.y = 0;
    else poseModel(lk); // 動きのデータを使わないときは、いつもの体の関節に合わせる
  }

  render() {
    const b = this.ball;
    // ボールを持っている選手を中心に、左右だけでなく前後（サイドライン側）にもカメラが動く
    const focus = b.holder ? b.holder.pos : b.pos;
    const tx = clamp(focus.x, this.portrait ? -11 : -10, this.portrait ? 11 : 10);
    const tz = clamp(focus.z, -7, 7);
    this.camX += (tx - this.camX) * 0.07;
    this.camZ += (tz - this.camZ) * 0.05;
    // 奥（遠いサイドライン）側へは大きく、手前側へは少しだけ（手前の外はなにもないので）
    const dz = this.camZ < 0 ? this.camZ * (this.portrait ? 0.6 : 0.55) : this.camZ * 0.12;
    const cam = this.camera;
    if (this.portrait) { cam.position.set(this.camX, 12, 13 + dz); cam.lookAt(this.camX, 0, 2 + dz); }
    else { cam.position.set(this.camX * 0.85, 9.6, 16.2 + dz); cam.lookAt(this.camX, 0, 0.2 + dz); }
    if (this.intro) {
      // オープニング：客席の上からアリーナ全体 → ゆっくり横へ → 試合のカメラにおりてくる
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const K = [
        { p: V(-15, 15.5, 22), l: V(3, 6.5, -12), f: 72 },
        { p: V(9, 13, 21.5), l: V(-2, 5, -9), f: 62 },
        { p: cam.position.clone(), l: V(this.camX, 0, (this.portrait ? 2 : 0.2) + dz), f: this.portrait ? 52 : 33.5 },
      ];
      const t = this.intro.t / this.intro.dur;
      const sm = x => x * x * (3 - 2 * x);
      const [a, b2, u] = t < 0.6 ? [K[0], K[1], sm(t / 0.6)] : [K[1], K[2], sm((t - 0.6) / 0.4)];
      cam.position.lerpVectors(a.p, b2.p, u);
      cam.lookAt(V(0, 0, 0).lerpVectors(a.l, b2.l, u));
      cam.fov = a.f + (b2.f - a.f) * u;
      cam.updateProjectionMatrix();
    }
    const c = this.ctrl;
    if (c) { this.ring.visible = true; this.ring.position.set(c.pos.x, 0.02, c.pos.z); }
    this.renderer.render(this.scene, cam);
    this.hud();
  }

  hud() {
    const st = this.st, ui = this.ui;
    if (this.scorersDirty || !this.rows) this.drawScorers();
    this.tickScores(1 / 60);
    const set = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
    set(ui.s0, st.score[0]); set(ui.s1, st.score[1]);
    set(ui.qtr, st.q > 4 ? 'OT' : `${st.q}Q`);
    set(ui.clk, `${Math.floor(st.clock / 60)}:${String(Math.ceil(st.clock % 60) === 60 ? 59 : Math.floor(st.clock % 60)).padStart(2, '0')}`);
    set(ui.sc, Math.max(0, Math.ceil(this.shotClock)));
    this.hoops.forEach(h => h.setClock(Math.max(0, Math.ceil(this.shotClock))));
    // チームファウル：得点の下の赤い四角（5つまで）。4つ目からは光って、次はフリースローだと分かる
    [0, 1].forEach(sd => {
      const n = Math.min(5, this.teamFouls[sd]);
      const e = this.el.querySelector('.fl' + sd);
      if (e && e.dataset.n !== String(n)) {
        e.dataset.n = n;
        [...e.children].forEach((x, i) => x.classList.toggle('on', i < n));
        e.classList.toggle('bonus', n >= 4);
      }
    });
    ui.sc.classList.toggle('low', this.shotClock < 6);
    const c = this.ctrl;
    if (!c) return;
    const offense = this.ball.holder === c;
    const loose = !this.ball.holder;
    const ftMine = this.state === 'ft' && offense;
    this.el.classList.toggle('ft-mode', this.state === 'ft');
    const tiMine = this.state === 'throwin' && offense;
    this.el.classList.toggle('ti-mode', tiMine);
    set(ui.a.firstChild, offense ? (tiMine ? 'スローイン' : 'パス') : 'スティール');
    set(ui.b.firstChild, offense ? (ftMine ? 'フリースロー' : 'シュート') : loose ? 'ジャンプ' : 'ブロック');
    set(ui.c.firstChild, offense ? 'ドライブ' : 'ディフェンス');
    // 守りのときはアイコンと色を変える。長い文字は少し小さく
    this.el.classList.toggle('def', !offense);
    [ui.a, ui.b, ui.c].forEach(bt => bt.classList.toggle('long', bt.firstChild.textContent.length >= 5));
    if (this.cardPid !== c.info.pid) {
      this.cardPid = c.info.pid;
      const img = ui.card.querySelector('img');
      const url = this.o.faceOf(c.info.pid);
      img.style.display = url ? '' : 'none';
      if (url) img.src = url;
      ui.card.querySelector('b').textContent = c.info.name;
      ui.card.querySelector('small').textContent = `#${c.info.no} ${c.info.pos} OVR ${c.r.ovr}`;
    }
    // シュートゲージ（操作中の選手の横に出す）
    const showMeter = c.act === 'shoot' || (c.released && c.act === 'land');
    ui.meter.classList.toggle('show', !!showMeter && c.side === this.me);
    if (showMeter) {
      const v = new THREE.Vector3(c.pos.x, c.look.height + 0.2 + c.y, c.pos.z).project(this.camera);
      const x = (v.x + 1) / 2 * this.el.clientWidth, y = (1 - v.y) / 2 * this.el.clientHeight;
      ui.meter.style.transform = `translate(${x + 34}px, ${y - 40}px)`;
      const w = this.shotWindow(c);
      // 上のはしが PERFECT。緑（グッド）と濃い緑（パーフェクト）は上にくっついている
      const toPct = v2 => clamp(v2, 0, 1) * 100;
      ui.zone.style.bottom = toPct(PERFECT - w * 1.3) + '%';
      ui.zone.style.height = toPct(w * 1.3) + '%';
      ui.perfect.style.bottom = toPct(PERFECT - w * 0.5) + '%';
      ui.perfect.style.height = toPct(w * 0.5) + '%';
      if (c.act === 'shoot') {
        const v3 = c.actT / FILL_TIME;
        ui.fill.style.height = toPct(v3) + '%';
        ui.meter.classList.toggle('over', v3 > PERFECT + 0.02);
        ui.meter.classList.toggle('perfect-now', v3 >= PERFECT - w * 0.5 && v3 <= PERFECT + 0.02);
      } else {
        // 離したあと：パーフェクトなら満タンの緑で光らせる
        ui.meter.classList.toggle('perfect-now', c.lastGrade === 'perfect');
        if (c.lastGrade === 'perfect') ui.fill.style.height = '100%';
      }
    }
  }
}

window.Match3D = {
  async start(o) {
    const m = new Match(o);
    await m.init();
    return m;
  },
};
window.dispatchEvent(new Event('match3d-ready'));
