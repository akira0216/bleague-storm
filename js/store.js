// 記録の保存・読み込み（端末の中の localStorage に保存）と、選手データの共通処理
window.Store = (() => {
  const KEY = 'bpDynasty.v1';
  const ATTRS = ['three', 'mid', 'drive', 'pass', 'reb', 'def'];
  const ATTR_NAME = { three: '3P', mid: '2P', drive: '突破', pass: 'パス', reb: 'リバウンド', def: '守備' };
  // ポジションごとの総合力（OVR）の重み。tools/fetch_data.py と同じ
  const POS_W = {
    PG: [1.0, .8, 1.1, 1.4, .5, 1.0], SG: [1.4, 1.0, 1.0, .8, .5, 1.0],
    SF: [1.0, 1.0, 1.0, .8, .8, 1.1], PF: [.7, 1.0, .9, .6, 1.3, 1.2],
    C: [.4, 1.0, .9, .5, 1.5, 1.3],
  };

  const DATA = window.BP_DATA;
  const teams = DATA.teams;
  const teamById = {};
  const playerById = {};
  teams.forEach(t => {
    teamById[t.id] = t;
    t.players.forEach(p => {
      p.team = t.id;
      p.mainPos = (p.pos.split('/')[0] || 'SF');
      p.ovrExtra = p.r.ovr - weighted(p.r, p.mainPos); // スタッツの貢献度などで上乗せされた分
      playerById[p.id] = p;
    });
  });

  function weighted(r, pos) {
    const w = POS_W[pos] || [1, 1, 1, 1, 1, 1];
    return ATTRS.reduce((s, k, i) => s + r[k] * w[i], 0) / w.reduce((a, b) => a + b, 0);
  }

  // ---------- 保存データ ----------
  function blank() {
    return {
      version: 1, gm: '', fav: null, coins: 500, owned: {}, lineup: [],
      season: null, cpuLv: 4, quarterMin: 3, sound: 1, bgm: 1, history: [],
      items: blankItems(),
    };
  }

  // アイテム：inv は持っているアイテム（id → 強化 0〜4 ＝ ★1〜★5）、copies は強化に使える同じアイテムの数、equip は選手ごとにつけているアイテム
  // day・used は1日3回の無料ガチャ、pity は天井（SSR以上が出ないまま引いた回数）
  function blankItems() { return { inv: {}, copies: {}, equip: {}, day: '', used: 0, pity: 0, pulls: 0 }; }

  function load() {
    try {
      const s = localStorage.getItem(KEY);
      if (s) {
        const d = JSON.parse(s);
        // 前の版の3段階（-1/0/1）を10段階にうつす
        if (d.cpuLv === undefined && d.cpuLevel !== undefined) d.cpuLv = { '-1': 2, 0: 4, 1: 7 }[d.cpuLevel] || 4;
        delete d.cpuLevel;
        delete d.speed;
        const out = Object.assign(blank(), d);
        out.items = Object.assign(blankItems(), d.items || {});
        out.items.copies = out.items.copies || {};
        return out;
      }
    } catch (e) { console.warn('load failed', e); }
    return blank();
  }

  let data = load();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn('save failed', e); }
  }

  function reset() { data = blank(); save(); }

  // ---------- 自分の選手 ----------
  function own(pid) {
    if (data.owned[pid]) return false;
    data.owned[pid] = { lv: 1, xp: 0, tp: 0, plus: {} };
    return true;
  }

  // ---------- アイテム ----------
  const IT = window.BP_ITEMS;
  const FREE_PER_DAY = 3, COIN_1 = 100, COIN_10 = 900, PITY = 30, PLUS_MAX = IT.LV_MAX;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const equipOf = pid => (data.items.equip[pid] || []).filter(id => IT.byId[id] && id in data.items.inv);

  // アイテムの効果を合計（★が上がるごとに、そのアイテムの効果が全部 約20%ずつ強くなる）
  // sp5：★5 にした SSR・UR の、とくべつな効果（試合でさらに強くなる）
  function itemTotal(pid) {
    const t = { sp: [], sp5: [] };
    if (!data.owned[pid]) return t;
    equipOf(pid).forEach(id => {
      const it = IT.byId[id];
      const lv = data.items.inv[id] || 0;
      Object.entries(it.e).forEach(([k, v], i) => { t[k] = (t[k] || 0) + IT.lvVal(v, lv, i === 0); });
      if (it.sp) t.sp.push(it.sp);
      if (it.sp && lv >= IT.LV_MAX) t.sp5.push(it.sp);
    });
    if (t.sp.includes('home')) t.all = (t.all || 0) + (t.sp5.includes('home') ? 3 : 2); // 自分のチームはいつもホーム
    return t;
  }

  // 強化：同じアイテムを使って ★ を1つ上げる。できなければエラーの文
  function upgrade(id) {
    const it = data.items;
    if (!(id in it.inv)) return 'このアイテムを持っていません';
    const lv = it.inv[id];
    if (lv >= IT.LV_MAX) return 'もう ★5 です';
    const need = IT.LV_COST[lv];
    if ((it.copies[id] || 0) < need) return `同じアイテムがあと ${need - (it.copies[id] || 0)} こ必要です`;
    it.copies[id] -= need;
    if (!it.copies[id]) delete it.copies[id];
    it.inv[id] = lv + 1;
    save();
    return null;
  }

  // ★5 にするのに、あと何こ要るか
  function copiesNeeded(id) {
    const lv = data.items.inv[id] || 0;
    let n = 0;
    for (let l = lv; l < IT.LV_MAX; l++) n += IT.LV_COST[l];
    return Math.max(0, n - (data.items.copies[id] || 0));
  }

  // 試合中だけの効果（速さ・ゲージ・フリースロー・ダンク・スティール・ブロックと、とくべつな効果）
  function itemFx(pid) {
    const t = itemTotal(pid);
    return { speed: t.speed || 0, gauge: t.gauge || 0, ft: t.ft || 0, dunk: t.dunk || 0, steal: t.steal || 0, block: t.block || 0, sp: t.sp, sp5: t.sp5 };
  }

  // だれがつけているか
  function ownerOf(id) { return Object.keys(data.items.equip).find(pid => (data.items.equip[pid] || []).includes(id)) || null; }

  // つける：同じ種類をつけていたら入れかえ、ほかの選手がつけていたら外して移す。5つまで
  function equip(pid, id) {
    const it = IT.byId[id];
    if (!it || !(id in data.items.inv) || !data.owned[pid]) return 'つけられません';
    const list = equipOf(pid).filter(x => IT.byId[x].type !== it.type);
    if (list.length >= 5) return 'アイテムは5つまでです';
    const from = ownerOf(id);
    if (from && from !== pid) data.items.equip[from] = data.items.equip[from].filter(x => x !== id);
    data.items.equip[pid] = [...list, id];
    save();
    return null;
  }
  function unequip(pid, id) {
    data.items.equip[pid] = equipOf(pid).filter(x => x !== id);
    save();
  }

  function freeLeft() {
    const it = data.items;
    if (it.day !== today()) { it.day = today(); it.used = 0; }
    return Math.max(0, FREE_PER_DAY - it.used);
  }

  // レア度をきめる（天井・10回の SR 以上かくてい）
  function rollRarity(atLeastSR) {
    const it = data.items;
    const R = IT.RARITY;
    if (it.pity >= PITY) return rand01() < 0.1 ? 'UR' : 'SSR';
    const keys = atLeastSR ? ['SR', 'SSR', 'UR'] : Object.keys(R);
    const sum = keys.reduce((a, k) => a + R[k].rate, 0);
    let x = rand01() * sum;
    for (const k of keys) { x -= R[k].rate; if (x < 0) return k; }
    return keys[keys.length - 1];
  }
  const rand01 = () => Math.random();

  function pullOne(atLeastSR) {
    const it = data.items;
    const rar = rollRarity(atLeastSR);
    const pool = IT.items.filter(x => x.rarity === rar);
    const item = pool[Math.floor(rand01() * pool.length)];
    it.pity = rar === 'SSR' || rar === 'UR' ? 0 : it.pity + 1;
    it.pulls++;
    const res = { id: item.id, rarity: rar, isNew: false, dup: 0, coins: 0 };
    // はじめて → NEW。同じアイテム → 強化用にためる（★5 に足りる分まで）。それ以上はコイン
    if (!(item.id in it.inv)) { it.inv[item.id] = 0; res.isNew = true; }
    else if (copiesNeeded(item.id) > 0) { it.copies[item.id] = (it.copies[item.id] || 0) + 1; res.dup = it.copies[item.id]; }
    else { res.coins = IT.RARITY[rar].coin; data.coins += res.coins; }
    return res;
  }

  // ガチャ：mode は 'free'（1日3回）・'coin1'（100コイン）・'coin10'（900コインで10回、SR以上1つかくてい）
  function pull(mode) {
    if (mode === 'free') {
      if (freeLeft() <= 0) return { error: '今日の無料ガチャは終わりました' };
      data.items.used++;
      const r = [pullOne(false)];
      save();
      return { results: r };
    }
    const n = mode === 'coin10' ? 10 : 1, cost = mode === 'coin10' ? COIN_10 : COIN_1;
    if (data.coins < cost) return { error: `コインが足りません（${cost}コイン必要）` };
    data.coins -= cost;
    const r = [];
    for (let i = 0; i < n; i++) {
      const last = n === 10 && i === 9 && !r.some(x => ['SR', 'SSR', 'UR'].includes(x.rarity));
      r.push(pullOne(last));
    }
    save();
    return { results: r };
  }

  // 育成とアイテムの成果を足した能力値（アイテムは自分の選手だけ）
  function rating(pid) {
    const p = playerById[pid];
    const o = data.owned[pid];
    const r = {};
    const t = o ? itemTotal(pid) : {};
    ATTRS.forEach(k => { r[k] = Math.min(99, p.r[k] + ((o && o.plus[k]) || 0) + (t[k] || 0) + (t.all || 0)); });
    r.ovr = o ? Math.min(99, Math.round(weighted(r, p.mainPos) + p.ovrExtra)) : p.r.ovr;
    return r;
  }

  const xpNeed = lv => 60 + lv * 40;

  // XPを足してレベルアップを処理。上がったレベル数を返す
  function addXp(pid, xp) {
    const o = data.owned[pid];
    if (!o) return 0;
    let ups = 0;
    o.xp += xp;
    while (o.lv < 30 && o.xp >= xpNeed(o.lv)) {
      o.xp -= xpNeed(o.lv);
      o.lv++;
      o.tp += 2;
      ups++;
    }
    return ups;
  }

  function train(pid, attr) {
    const o = data.owned[pid];
    const p = playerById[pid];
    if (!o || o.tp <= 0 || p.r[attr] + (o.plus[attr] || 0) >= 99) return false;
    o.tp--;
    o.plus[attr] = (o.plus[attr] || 0) + 1;
    save();
    return true;
  }

  function ownedIds() {
    return Object.keys(data.owned).sort((a, b) => rating(b).ovr - rating(a).ovr);
  }

  // スタメン5人（足りなければ OVR 順でうめる）
  function lineup() {
    const ids = data.lineup.filter(id => data.owned[id]).slice(0, 5);
    ownedIds().forEach(id => { if (ids.length < 5 && !ids.includes(id)) ids.push(id); });
    data.lineup = ids;
    return ids;
  }

  return {
    get data() { return data; }, save, reset, ATTRS, ATTR_NAME,
    teams, teamById, playerById, own, rating, addXp, xpNeed, train, ownedIds, lineup,
    ITEM: { FREE_PER_DAY, COIN_1, COIN_10, PITY, PLUS_MAX }, equipOf, itemTotal, itemFx, ownerOf, equip, unequip, freeLeft, pull, upgrade, copiesNeeded,
  };
})();
