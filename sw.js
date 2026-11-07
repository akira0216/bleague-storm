// オフラインでも使えるようにファイルを保存しておく
// ファイルを更新したら VERSION と index.html の ?v= を上げること（上げないと古いままになる）
const VERSION = 'v1.9.28';
// 選手の写真・顔・ロゴ（約10MB）は、アプリを更新しても取り直さないよう別に保存する
// （選手データを取り直して画像が変わったときだけ、ここを上げる）
const ASSETS = 'bp-assets-1';
const FONTS = 'bp-fonts-1';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/game.js',
  './js/match3d.js',
  './js/sound.js',
  './vendor/three.module.min.js',
  './vendor/jsm/GLTFLoader.js',
  './vendor/jsm/BufferGeometryUtils.js',
  // 3Dモデルの圧縮（Meshopt・KTX2）を読む部品
  './vendor/jsm/KTX2Loader.js',
  './vendor/jsm/utils/WorkerPool.js',
  './vendor/jsm/libs/ktx-parse.module.js',
  './vendor/jsm/libs/zstddec.module.js',
  './vendor/jsm/libs/meshopt_decoder.module.js',
  './vendor/jsm/libs/basis/basis_transcoder.js',
  './vendor/jsm/libs/basis/basis_transcoder.wasm',
  './data/players.js',
  './data/mascots.js',
  './data/items.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/logo.png',
];
// 音声ファイル（audio/）も同じく保存して使い回す。曲を差しかえるときはファイル名の数字を上げる
// 3Dモデル（models3d/）も同じ。中身を変えたらファイル名の _v を上げる
const isAsset = path => /\/(photos|faces|logos|audio|models3d)\/[^/]+$/.test(path);
const isFont = host => host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com';

self.addEventListener('install', e => {
  // 初めて入れるときはすぐ使う。新しい版は、画面の「アップデート」ボタンが押されるまで待つ
  const first = !self.registration.active;
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => first && self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const keep = [VERSION, ASSETS, FONTS];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ---------- 写真・顔・ロゴをまとめて保存（画面から 'prefetch' と言われたら） ----------
let prefetching = null;

async function tell(msg) {
  const list = await self.clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage(msg));
}

async function prefetchAll() {
  // 選手データの中から、画像のファイル名をぜんぶ拾う
  const read = async f => (await (await caches.match(f, { ignoreSearch: true }) || await fetch(f)).text());
  const text = (await read('./data/players.js')) + (await read('./data/mascots.js').catch(() => ''));
  const paths = [...new Set([...text.matchAll(/"((?:photos|faces|logos)\/[^"]+)"/g)].map(m => m[1]))];
  const cache = await caches.open(ASSETS);
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname.replace(/^.*\/((?:photos|faces|logos)\/)/, '$1')));
  const need = paths.filter(p => !have.has(p));
  let done = paths.length - need.length, failed = 0, last = 0;
  const report = force => {
    const now = Date.now();
    if (!force && now - last < 300) return;
    last = now;
    tell({ type: 'offline', done, total: paths.length, failed });
  };
  report(true);
  // 6本ずつ同時に取る
  let i = 0;
  const worker = async () => {
    while (i < need.length) {
      const p = need[i++];
      try {
        const r = await fetch(p, { cache: 'no-cache' });
        if (r.ok) { await cache.put(p, r); done++; } else failed++;
      } catch { failed++; }
      report(false);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  report(true);
}

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') return self.skipWaiting(); // 画面で「アップデート」が押された
  if (e.data !== 'prefetch') return;
  if (!prefetching) prefetching = prefetchAll().catch(() => tell({ type: 'offline', error: true })).finally(() => { prefetching = null; });
  e.waitUntil(prefetching);
});

// ---------- 読みこみ ----------
// ネットが遅い・つながらないときは、待ちすぎずに保存したファイルを使う
function timeout(ms) { return new Promise((_, ng) => setTimeout(() => ng(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // フォント：一度使ったものは保存しておき、次からはそれを使う
  if (isFont(url.hostname)) {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
      if (hit) { net.catch(() => {}); return hit; }
      return net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // 写真・顔・ロゴ：保存してあればそれを使う（変わらないので、ネットを見に行かない）
  if (isAsset(url.pathname)) {
    e.respondWith(caches.open(ASSETS).then(async c => {
      const key = url.pathname.replace(/^.*\/((?:photos|faces|logos|audio|models3d)\/)/, '$1');
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(key, res.clone());
      return res;
    }));
    return;
  }

  // プログラム：ネットにつながっていれば新しいファイル、だめなら保存したファイル
  e.respondWith(
    Promise.race([fetch(e.request), timeout(4000)])
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || Response.error())
  );
});
