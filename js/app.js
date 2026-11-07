// Bリーグ ストーム 本体（画面の切りかえ・チーム編成・育成・スカウト・試合）
(() => {
  const S = Store;
  const $app = document.getElementById('app');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const SCOUT_COST = 300;
  const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // チームごとの色（ロゴの代わりにも使う）
  function hue(code) { let h = 0; for (const c of code) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  const teamStyle = t => `--tc:${t.color || `hsl(${hue(t.code)} 65% 48%)`}`;

  function photo(p, cls = '') {
    return `<div class="ph ${cls}" style="${teamStyle(S.teamById[p.team])}">
      <span class="ph-no">${esc(p.no)}</span>
      ${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    </div>`;
  }

  const logo = t => `<img class="logo" src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">`;
  const myTeam = () => S.teamById[S.data.fav];
  const myName = () => (S.data.gm ? `${S.data.gm}の` : '') + myTeam().short;

  function ovrClass(o) { return o >= 85 ? 'gold' : o >= 75 ? 'silver' : o >= 65 ? 'bronze' : ''; }

  // ポジションの合う順に5人をならべる（コートの立ち位置とマッチアップに使う）
  function arrange(ids) {
    const rest = [...ids];
    const out = [];
    SLOTS.forEach(slot => {
      let best = -1;
      let bestScore = -1;
      rest.forEach((id, i) => {
        const p = S.playerById[id];
        const fit = p.pos.split('/').includes(slot) ? 2 : (p.pos.includes(slot[1] || slot) ? 1 : 0);
        const sc = fit * 100 + S.rating(id).ovr;
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      out.push(rest.splice(best, 1)[0]);
    });
    return out;
  }

  function sideOf(ids, team, mine, keepOrder = false) {
    return {
      team, mine,
      tactic: 'man',
      players: (keepOrder ? ids : arrange(ids)).map(id => {
        const p = S.playerById[id];
        return { pid: id, name: p.name, no: p.no, photo: p.photo, pos: p.pos, ht: p.ht, wt: p.wt, r: mine ? S.rating(id) : p.r, fx: mine ? S.itemFx(id) : null };
      }),
    };
  }

  function cpuSide(team) {
    const ids = team.players.slice(0, 8).map(p => p.id); // OVR 順に上位から
    return sideOf(arrange(ids), team, false);
  }


  // ---------- シーズン ----------
  function newSeason() {
    const others = S.teams.filter(t => t.id !== S.data.fav).map(t => t.id);
    const table = {};
    S.teams.forEach(t => { table[t.id] = { w: 0, l: 0, pf: 0, pa: 0 }; });
    S.data.season = { schedule: shuffle(others), game: 0, table };
  }

  function record(a, b, sa, sb) {
    const T = S.data.season.table;
    T[a].pf += sa; T[a].pa += sb; T[b].pf += sb; T[b].pa += sa;
    if (sa > sb) { T[a].w++; T[b].l++; } else { T[b].w++; T[a].l++; }
  }

  // 自分の試合のあいだに、ほかのチームどうしも1試合ずつ行う
  function simRound(oppId) {
    const ids = shuffle(S.teams.map(t => t.id).filter(id => id !== S.data.fav && id !== oppId));
    for (let i = 0; i + 1 < ids.length; i += 2) {
      const st = Game.create(cpuSide(S.teamById[ids[i]]), cpuSide(S.teamById[ids[i + 1]]), 10);
      Game.simulate(st, [0, 0]);
      record(ids[i], ids[i + 1], st.score[0], st.score[1]);
    }
  }

  function standings() {
    const T = S.data.season.table;
    return S.teams.map(t => ({ t, ...T[t.id] }))
      .sort((a, b) => (b.w - b.l) - (a.w - a.l) || (b.pf - b.pa) - (a.pf - a.pa));
  }


  // ---------- アイテム・ガチャ ----------
  const IT = window.BP_ITEMS;
  const RAR_ORDER = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };

  // 効果（★が上がるごとに、全部の効果が約20%ずつ強くなる）
  const effList = (it, lv = 0) => Object.entries(it.e).map(([k, v], i) => `${IT.KEY_NAME[k]} +${IT.lvVal(v, lv, i === 0)}${k === 'speed' || k === 'gauge' ? '%' : ''}`);
  function itemEffect(it, lv = 0) { return effList(it, lv).join('・'); }
  const stars = lv => `<span class="ic-stars" aria-label="★${lv + 1}">${'★'.repeat(lv + 1)}<i>${'★'.repeat(IT.LV_MAX - lv)}</i></span>`;
  const itemSvg = ty => `<svg class="ic-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ty.svg}</svg>`;
  // 強化できるか（同じアイテムが足りているか）
  const canUp = id => { const lv = S.data.items.inv[id] || 0; return lv < IT.LV_MAX && (S.data.items.copies[id] || 0) >= IT.LV_COST[lv]; };

  // opt.lv：表示する強化（ガチャの結果は、引いたときの強化）
  function itemCard(id, opt = {}) {
    const it = IT.byId[id];
    const lv = opt.lv !== undefined ? opt.lv : S.data.items.inv[id] || 0;
    const owner = opt.owner === undefined ? S.ownerOf(id) : opt.owner;
    const ty = IT.typeById[it.type];
    const cp = opt.lv === undefined ? S.data.items.copies[id] || 0 : 0;
    const up = opt.lv === undefined && canUp(id);
    const aw = it.sp && lv >= IT.LV_MAX;
    const op = owner && S.playerById[owner]; // 装備している選手
    return `<div class="icard r-${it.rarity}${up ? ' can-up' : ''}${aw ? ' awake' : ''}${op ? ' owned' : ''}${opt.cls ? ' ' + opt.cls : ''}" ${opt.attr || ''}>
      <div class="ic-art">${itemSvg(ty)}</div>
      ${op ? photo(op, 'ic-face') : ''}
      <span class="ic-rar">${it.rarity}</span>
      ${cp ? `<span class="ic-cp" title="強化に使える同じアイテム">×${cp}</span>` : ''}
      ${stars(lv)}
      <b class="ic-name">${esc(it.name)}</b>
      <small class="ic-type">${esc(ty.name)}</small>
      <div class="ic-effs">${effList(it, lv).map(e => `<span>${esc(e)}</span>`).join('')}</div>
      ${it.sp ? `<small class="ic-sp">◆ ${esc(IT.SP[it.sp])}${aw ? `<em>★5：${esc(IT.SP5[it.sp])}</em>` : ''}</small>` : ''}
      ${op ? `<small class="ic-own" style="${teamStyle(S.teamById[op.team])}">${photo(op, 'xs')}<span>${esc(op.name)}</span></small>` : ''}
      ${up ? '<span class="ic-up">▲ 強化できる</span>' : ''}
      ${opt.extra || ''}
    </div>`;
  }

  // アイテムの詳しい画面と強化
  function openItem(id, justUp) {
    const it = IT.byId[id];
    const ty = IT.typeById[it.type];
    const lv = S.data.items.inv[id] || 0;
    const cp = S.data.items.copies[id] || 0;
    const max = lv >= IT.LV_MAX;
    const need = max ? 0 : IT.LV_COST[lv];
    const dlg = document.getElementById('dlg');
    dlg.innerHTML = `
      <div class="sheet isheet">
        <button class="close" aria-label="閉じる">×</button>
        <div class="isheet-card${justUp ? ' just-up' : ''}">${itemCard(id, { cls: 'big', lv })}</div>
        <div class="up-box">
          <h3>強化 ${stars(lv)}</h3>
          ${max ? `<p class="hint">★5（最大）です。${it.sp ? `特別な効果も強くなっています：<b>${esc(IT.SP5[it.sp])}</b>` : ''}<br>これ以降、同じアイテムはコインになります。</p>`
            : `<div class="up-cmp">
                <div><small>いま ★${lv + 1}</small>${effList(it, lv).map(e => `<span>${esc(e)}</span>`).join('')}</div>
                <b class="arrow">→</b>
                <div class="next"><small>強化後 ★${lv + 2}</small>${effList(it, lv + 1).map(e => `<span>${esc(e)}</span>`).join('')}</div>
              </div>
              ${it.sp && lv + 1 >= IT.LV_MAX ? `<p class="hint">★5 にすると、特別な効果も強くなります：<b>${esc(IT.SP5[it.sp])}</b></p>` : ''}
              <p class="hint">使う同じアイテム：<b>${need}個</b>（所持 ${cp}個）　${S.copiesNeeded(id) ? `★5 まで あと ${S.copiesNeeded(id)}個` : '★5 まで集まっています'}</p>
              <button class="btn primary wide" id="doUp" ${cp >= need ? '' : 'disabled'}>${cp >= need ? `★${lv + 2} に強化する` : `同じアイテムがあと ${need - cp}個 必要`}</button>`}
          <p class="hint">同じアイテムはガチャで出ます。★1→★2 に1個、★3 に2個、★4 に3個、★5 に4個（合計10個）。</p>
        </div>
      </div>`;
    dlg.classList.add('open');
    const close = () => { dlg.classList.remove('open'); dlg.innerHTML = ''; render(); };
    dlg.querySelector('.close').onclick = close;
    dlg.onclick = e => { if (e.target === dlg) close(); };
    const b = document.getElementById('doUp');
    if (b) b.onclick = () => {
      const err = S.upgrade(id);
      if (err) return toast(err);
      toast(`${it.name} が ★${S.data.items.inv[id] + 1} に強化しました`);
      if (window.Sound && Sound.cheer) { Sound.unlock(); Sound.cheer(S.data.items.inv[id] >= IT.LV_MAX ? 0.9 : 0.5); }
      openItem(id, true);
    };
  }

  function renderGacha() {
    const free = S.freeLeft();
    const it = S.data.items;
    const C = S.ITEM;
    const owned = Object.keys(it.inv).length;
    $app.innerHTML = `
      ${header('ガチャ')}
      <section class="gacha-hero">
        <div class="gh-title">🎁 アイテムガチャ</div>
        <p>バッシュ・リストバンド・マイボールなど100種類。選手に装備すると能力が上がります（1人5つまで、同じ種類は1つ）。同じアイテムを集めると ★5 まで強化できます。</p>
        <div class="gh-info"><span>今日の無料 <b>${free}</b> / ${C.FREE_PER_DAY}</span><span>SSR以上まで あと <b>${Math.max(1, C.PITY - it.pity)}</b> 回</span><span>持っているアイテム <b>${owned}</b> / ${IT.items.length}</span></div>
      </section>
      <div class="gacha-btns">
        <button class="gbtn free" data-pull="free" ${free ? '' : 'disabled'}><b>無料で1回</b><small>${free ? `残り ${free} 回` : 'また明日'}</small></button>
        <button class="gbtn" data-pull="coin1" ${S.data.coins >= C.COIN_1 ? '' : 'disabled'}><b>1回</b><small>🪙 ${C.COIN_1}</small></button>
        <button class="gbtn ten" data-pull="coin10" ${S.data.coins >= C.COIN_10 ? '' : 'disabled'}><b>10回</b><small>🪙 ${C.COIN_10}・SR以上 1つ確定</small></button>
      </div>
      <div id="gres" class="gres"></div>
      <div class="gacha-foot">
        <button class="btn" data-go="items">🎒 持ち物を見る</button>
        <details class="rates"><summary>出る確率</summary>
          <p>N 50% ／ R 30% ／ SR 15% ／ SSR 4.5% ／ UR 0.5%</p>
          <p>${C.PITY}回連続でSSR以上が出なかった場合、次は必ずSSR以上。</p>
          <p>同じアイテムがまた出たら、強化用に貯まります（アイテム画面でカードを押して強化。★5 まで合計10個）。★5 の分が貯まった後はコイン（N 20・R 40・SR 80・SSR 200・UR 500）。</p>
        </details>
      </div>`;
    bind();
    $app.querySelectorAll('[data-pull]').forEach(b => b.onclick = () => {
      const r = S.pull(b.dataset.pull);
      if (r.error) return toast(r.error);
      Sound.unlock();
      renderGacha();
      showPull(r.results);
    });
  }

  // 引いた結果：カードが1まいずつめくれる。いちばんよいレア度で光る
  function showPull(results) {
    const box = document.getElementById('gres');
    const best = results.reduce((a, x) => (RAR_ORDER[x.rarity] < RAR_ORDER[a] ? x.rarity : a), 'N');
    box.className = 'gres show best-' + best;
    box.innerHTML = `<div class="gres-title">${best === 'UR' ? '🌈 UR！！' : best === 'SSR' ? '✨ SSR！' : '結果'}</div>
      <div class="gres-cards ${results.length > 1 ? 'ten' : 'one'}">${results.map((x, i) => `
        <div class="flip" style="--d:${i * 0.12 + 0.2}s">
          <div class="back r-${x.rarity}"><span>?</span></div>
          ${itemCard(x.id, { cls: 'front', owner: null, lv: S.data.items.inv[x.id] || 0, extra: x.isNew ? '<span class="tag-new">NEW</span>' : x.dup ? `<span class="tag-up">同じアイテム ×${x.dup}${canUp(x.id) ? '・強化できる！' : ''}</span>` : `<span class="tag-coin">🪙 +${x.coins}</span>` })}
        </div>`).join('')}</div>`;
    if (window.Sound && (best === 'SSR' || best === 'UR')) setTimeout(() => Sound.cheer && Sound.cheer(best === 'UR' ? 1 : 0.7), 600);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let itemTab = 'all';
  function renderItems() {
    const inv = S.data.items.inv;
    const ids = Object.keys(inv).filter(id => IT.byId[id] && (itemTab === 'all' || IT.byId[id].type === itemTab))
      .sort((a, b) => RAR_ORDER[IT.byId[a].rarity] - RAR_ORDER[IT.byId[b].rarity] || a.localeCompare(b));
    $app.innerHTML = `
      ${header('持ち物（アイテム）')}
      <p class="hint">カードを押すと強化できます（同じアイテムを使って ★5 まで）。選手の画面（チーム・育成 → 選手をタップ）で装備できます。持っているのは ${Object.keys(inv).length} / ${IT.items.length} 種類。</p>
      ${Object.keys(inv).some(canUp) ? `<p class="up-note">▲ 強化できるアイテムが ${Object.keys(inv).filter(canUp).length}個 あります</p>` : ''}
      <div class="chips itabs">
        <button class="chip ${itemTab === 'all' ? 'on' : ''}" data-tab="all">全て</button>
        ${IT.TYPES.map(t => `<button class="chip ${itemTab === t.id ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('')}
      </div>
      ${ids.length ? `<div class="igrid">${ids.map(id => itemCard(id, { attr: `data-item="${id}" role="button" tabindex="0"`, cls: 'pickable' })).join('')}</div>`
        : `<div class="panel center"><p>まだアイテムがありません。</p><button class="btn primary" data-go="gacha">🎁 ガチャを引く</button></div>`}`;
    bind();
    $app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { itemTab = b.dataset.tab; renderItems(); });
    $app.querySelectorAll('[data-item]').forEach(b => b.onclick = () => openItem(b.dataset.item));
  }

  // 選手につけるアイテムをえらぶ（同じ種類をつけていたら入れかえ）
  function openItemPicker(pid) {
    const dlg = document.getElementById('dlg');
    const p = S.playerById[pid];
    const mine = S.equipOf(pid);
    const mineTypes = Object.fromEntries(mine.map(id => [IT.byId[id].type, id]));
    const ids = Object.keys(S.data.items.inv).filter(id => IT.byId[id] && !mine.includes(id))
      .sort((a, b) => RAR_ORDER[IT.byId[a].rarity] - RAR_ORDER[IT.byId[b].rarity] || IT.byId[a].type.localeCompare(IT.byId[b].type));
    dlg.innerHTML = `
      <div class="sheet">
        <button class="close" aria-label="戻る">‹</button>
        <h2 class="picker-title">${esc(p.name)} に装備（${mine.length}/5）</h2>
        <p class="hint">同じ種類を装備している場合は入れ替えます。他の選手が装備しているアイテムは、この選手に移ります。</p>
        ${ids.length ? `<div class="igrid">${ids.map(id => {
          const swap = mineTypes[IT.byId[id].type];
          return itemCard(id, { attr: `data-pick="${id}" role="button" tabindex="0"`, cls: 'pickable',
            extra: swap ? `<span class="tag-swap">「${esc(IT.byId[swap].name)}」と入れ替え</span>` : '' });
        }).join('')}</div>` : '<div class="panel center"><p>装備できるアイテムがありません。</p></div>'}
      </div>`;
    dlg.classList.add('open');
    dlg.querySelector('.close').onclick = () => openPlayer(pid);
    dlg.onclick = e => { if (e.target === dlg) openPlayer(pid); };
    dlg.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const err = S.equip(pid, b.dataset.pick);
      if (err) return toast(err);
      toast(`${IT.byId[b.dataset.pick].name} を装備しました`);
      openPlayer(pid);
    });
  }

  // ---------- 画面 ----------
  let view = 'home';
  let viewArg = null;
  function go(v, arg) { view = v; viewArg = arg; render(); window.scrollTo(0, 0); syncHist(); }

  // ---------- 戻る操作（左端からのスワイプ・Android の戻るボタン） ----------
  // ホームで下から出る画面も開いていないときだけ、ブラウザの履歴を1つにしておく（戻るとアプリが閉じる）。
  // それ以外のときは履歴を1つ積んでおき、戻る操作が来たらアプリの中で1つ前に戻す。
  let atTop = !!(history.state && history.state.bs);
  let skipPop = false;
  const dlgOpen = () => document.getElementById('dlg').classList.contains('open');
  const needTop = () => view !== 'home' || dlgOpen();
  function syncHist() {
    if (needTop()) {
      if (!atTop) { history.pushState({ bs: 1 }, ''); atTop = true; }
    } else if (atTop) {
      atTop = false; skipPop = true; history.back();
    }
  }
  function goBack() {
    const c = view === 'match' && match && match.ctrl;
    if (c) {
      // 試合中：説明・交代の画面を閉じる → 一時停止 ⇔ 試合に戻る
      const mn = c.ui.menu;
      if (mn.classList.contains('help-open') || mn.classList.contains('subs-open')) mn.classList.remove('help-open', 'subs-open');
      else c.pause(!c.paused);
    } else if (view === 'match' && match) {
      // 試合の読み込み中は何もしない
    } else if (dlgOpen()) {
      const cb = document.querySelector('#dlg .close');
      if (cb) cb.click(); else closeDlg();
    } else if ((view === 'pre' && String(viewArg || '').startsWith('free:')) || view === 'online') go('free');
    else if (view !== 'home') go('home');
  }
  window.addEventListener('popstate', e => {
    atTop = !!(e.state && e.state.bs);
    if (skipPop) skipPop = false; else goBack();
    syncHist();
  });

  function render() {
    if (view !== 'match') Sound.setMenu(true);
    // 通信対戦の部屋の画面から離れたら、接続を閉じる（試合を始めたときは試合が使う）
    if (view !== 'online' && view !== 'match' && lobby) closeLobby();
    if (!S.data.fav) return renderWelcome();
    ({ home: renderHome, team: renderTeam, scout: renderScout, table: renderTable,
      pre: renderPre, match: renderMatch, settings: renderSettings, free: renderFree, help: renderHelp,
      gacha: renderGacha, items: renderItems, online: renderOnline }[view] || renderHome)();
  }

  function header(title, back = true) {
    return `<header class="bar">
      ${back ? '<button class="back" data-go="home" aria-label="戻る">‹</button>' : '<span></span>'}
      <h1>${title}</h1>
      <span class="coins">🪙 ${S.data.coins}</span>
    </header>`;
  }

  // 最初の画面：推しチームをえらぶ
  function renderWelcome() {
    const groups = [['B.ONE（推し）', S.teams.filter(t => t.league === 'B.ONE')],
      ['B.PREMIER', S.teams.filter(t => t.league === 'B.PREMIER')]];
    $app.innerHTML = `
      <section class="welcome">
        <div class="title-logo"><img src="icons/logo.png" alt="Bリーグ ストーム"><span>Bリーグ</span><b>STORM</b></div>
        <p class="lead">${esc(window.BP_DATA.season)} シーズンの選手で、自分だけのチームを育てよう。</p>
        <div class="panel restore">
          <span>前のスマホやインストールし直す前の記録がある人は</span>
          <label class="btn">バックアップから戻す<input type="file" accept=".json,application/json" id="bkLoad" hidden></label>
        </div>
        <label class="field">GMの名前（なくてもOK）<input id="gm" maxlength="12" placeholder="例：アキラ"></label>
        ${groups.map(([g, ts]) => `<h2 class="sec">${g}</h2>
          <div class="team-grid">${ts.map(t => `
            <button class="team-pick" data-team="${t.id}" style="${teamStyle(t)}">
              ${logo(t)}<span>${esc(t.short)}</span>
            </button>`).join('')}</div>`).join('')}
        <p class="note">データ：B.LEAGUE公式サイト（${esc(window.BP_DATA.updated)} 取得）。個人・家族で楽しむためのファンアプリです。</p>
      </section>`;
    document.getElementById('bkLoad').onchange = e => { loadBackup(e.target.files[0]); e.target.value = ''; };
    $app.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
      const t = S.teamById[b.dataset.team];
      S.data.gm = document.getElementById('gm').value.trim();
      S.data.fav = t.id;
      t.players.forEach(p => S.own(p.id));
      S.lineup();
      newSeason();
      S.save();
      toast(`${t.short} のGMに就任！`);
      go('home');
    });
  }

  function renderHome() {
    const t = myTeam();
    const sea = S.data.season;
    const rec = sea.table[t.id];
    const next = S.teamById[sea.schedule[sea.game]];
    const susp = S.data.suspended;
    const rank = standings().findIndex(x => x.t.id === t.id) + 1;
    const ids = S.lineup();
    const ovr = Math.round(ids.reduce((a, id) => a + S.rating(id).ovr, 0) / 5);
    $app.innerHTML = `
      ${header('<img class="hlogo" src="icons/logo.png" alt="">Bリーグ ストーム', false)}
      <section class="hero" style="${teamStyle(t)}">
        ${logo(t)}
        <div>
          <div class="hero-name">${esc(myName())}</div>
          <div class="hero-rec"><b>${rec.w}</b>勝 <b>${rec.l}</b>敗 ・ ${rank}位 ・ チーム力 <b>${ovr}</b></div>
        </div>
      </section>
      <div class="starters">${ids.map(id => `<button class="mini" data-player="${id}">${photo(S.playerById[id])}<span>${S.rating(id).ovr}</span></button>`).join('')}</div>
      ${susp ? `
      <div class="panel resume">
        <div><small>⏸ 中断した試合${susp.free ? '（フリー対戦）' : ''}</small>
          <b>VS ${esc(S.teamById[susp.opp].short)}　${susp.score[0]} - ${susp.score[1]}</b>
          <small>${susp.q > 4 ? 'OT' : susp.q + 'Q'} 残り ${Math.floor(susp.clock / 60)}:${String(Math.floor(susp.clock % 60)).padStart(2, '0')}</small></div>
        <button class="btn primary" id="resume">再開する</button>
        <button class="btn" id="discard">破棄</button>
      </div>` : next ? `
      <button class="big-btn" data-go="pre" data-arg="${next.id}">
        <small>シーズン 第${sea.game + 1}戦 / ${sea.schedule.length}</small>
        <span>VS ${esc(next.short)}</span>
      </button>` : `
      <div class="panel center"><h2>シーズン終了！</h2><p>${rec.w}勝${rec.l}敗・${rank}位</p>
        <button class="btn" id="newSeason">次のシーズンへ</button></div>`}
      <div class="menu">
        <button data-go="team"><b>🏀</b>チーム・育成</button>
        <button data-go="scout"><b>🎴</b>スカウト</button>
        <button data-go="gacha" class="m-gacha"><b>🎁</b>ガチャ${S.freeLeft() ? `<em class="badge">${S.freeLeft()}</em>` : ''}</button>
        <button data-go="items"><b>🎒</b>アイテム</button>
        <button data-go="free"><b>⚔️</b>フリー対戦</button>
        <button data-go="table"><b>📊</b>順位表</button>
        <button data-go="help"><b>📖</b>遊び方</button>
        <button data-go="settings"><b>⚙️</b>設定</button>
      </div>`;
    bind();
    const rs = document.getElementById('resume');
    if (rs) rs.onclick = () => { Sound.unlock(); resumeMatch(); };
    const ds = document.getElementById('discard');
    if (ds) ds.onclick = () => {
      if (!confirm('中断した試合を消しますか？（記録されません）')) return;
      delete S.data.suspended;
      S.save();
      render();
    };
    const ns = document.getElementById('newSeason');
    if (ns) ns.onclick = () => { newSeason(); S.save(); render(); };
  }

  // チーム：スタメンと選手一覧
  function renderTeam() {
    const ids = S.ownedIds();
    const lineup = S.lineup();
    $app.innerHTML = `
      ${header('チーム・育成')}
      <p class="hint">選手をタップすると育成ができます。「⇄ 交代」で、誰と入れ替えるかを選べます。</p>
      <h2 class="sec">スタメン</h2>
      <div class="cards">${lineup.map(id => `<div class="pcard-wrap">${card(id)}<button class="swap-btn" data-swap="${id}">⇄ 交代</button></div>`).join('')}</div>
      <h2 class="sec">ベンチ（${ids.length - lineup.length}人）</h2>
      <div class="cards">${ids.filter(id => !lineup.includes(id)).map(id => `<div class="pcard-wrap">${card(id)}<button class="swap-btn" data-swap="${id}">⇄ スタメンへ</button></div>`).join('')}</div>`;
    bind();
    $app.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => openSwap(b.dataset.swap));
  }

  // 交代する相手を選ぶ：スタメンならベンチの選手から、ベンチの選手ならスタメンから
  function openSwap(id) {
    const ids = S.lineup();
    const isStarter = ids.includes(id);
    const p = S.playerById[id];
    const cands = (isStarter ? S.ownedIds().filter(x => !ids.includes(x)) : ids)
      .map(x => ({ x, same: S.playerById[x].mainPos === p.mainPos, ovr: S.rating(x).ovr }))
      .sort((a, b) => (b.same - a.same) || (b.ovr - a.ovr));
    if (!cands.length) return toast('ベンチに選手がいません');
    const dlg = document.getElementById('dlg');
    dlg.innerHTML = `
      <div class="sheet">
        <button class="close" aria-label="閉じる">×</button>
        <h2 class="swap-h">${esc(p.name)} <small>${esc(p.pos)} ・ OVR ${S.rating(id).ovr}</small></h2>
        <p class="hint">${isStarter ? '代わりにスタメンに入れる選手を選んでください（同じポジションが上）' : 'ベンチに下げるスタメンを選んでください（同じポジションが上）'}</p>
        <div class="swap-list">${cands.map(c => { const q = S.playerById[c.x]; return `
          <button class="swap-row${c.same ? ' same' : ''}" data-to="${c.x}">${photo(q, 'sm')}
            <span class="nm"><b>${esc(q.name)}</b><small>${esc(q.pos)}${c.same ? ' ・ 同じポジション' : ''}</small></span>
            <b class="ovr">${c.ovr}</b></button>`; }).join('')}</div>
      </div>`;
    dlg.classList.add('open');
    dlg.querySelector('.close').onclick = closeDlg;
    dlg.onclick = e => { if (e.target === dlg) closeDlg(); };
    dlg.querySelectorAll('[data-to]').forEach(b => b.onclick = () => {
      const to = b.dataset.to;
      const [out, inn] = isStarter ? [id, to] : [to, id];
      S.data.lineup = S.lineup().map(x => (x === out ? inn : x));
      S.save();
      toast(`${S.playerById[inn].name} がスタメンに入りました（${S.playerById[out].name} はベンチへ）`);
      closeDlg();
    });
  }

  function card(id) {
    const p = S.playerById[id];
    const r = S.rating(id);
    const o = S.data.owned[id];
    const t = S.teamById[p.team];
    return `<button class="pcard ${ovrClass(r.ovr)}" data-player="${id}">
      ${photo(p)}
      <div class="pcard-ovr">${r.ovr}</div>
      <div class="pcard-body">
        <b>${esc(p.name)}</b>
        <small>${esc(t.short)} #${esc(p.no)} ${esc(p.pos)}</small>
        <small>Lv${o ? o.lv : 1}${o && o.tp ? ` <em>育成pt ${o.tp}</em>` : ''}</small>
      </div>
    </button>`;
  }

  // 選手の詳細（育成）
  function openPlayer(id) {
    const p = S.playerById[id];
    const t = S.teamById[p.team];
    const o = S.data.owned[id];
    const r = S.rating(id);
    const st = p.st;
    const itb = o ? S.itemTotal(id) : {}; // アイテムで上がった分
    const lineup = S.lineup();
    const isStarter = lineup.includes(id);
    const dlg = document.getElementById('dlg');
    dlg.innerHTML = `
      <div class="sheet" style="${teamStyle(t)}">
        <button class="close" aria-label="閉じる">×</button>
        <div class="sheet-top">
          ${photo(p, 'lg')}
          <div>
            <div class="sheet-team">${logo(t)}${esc(t.short)} #${esc(p.no)} ${esc(p.pos)}${p.ht ? ` ・ ${p.ht}cm / ${p.wt}kg` : ''}</div>
            <h2>${esc(p.name)}</h2>
            <div class="sheet-ovr ${ovrClass(r.ovr)}">OVR <b>${r.ovr}</b></div>
          </div>
        </div>
        ${st ? `<div class="realstats">
          <span><b>${st.g}</b>試合</span><span><b>${st.ppg}</b>得点</span><span><b>${st.rpg}</b>RB</span>
          <span><b>${st.apg}</b>AST</span><span><b>${st.p3p}%</b>3P</span><span><b>${st.eff}</b>EFF</span>
        </div>` : p.note ? `<p class="hint">${esc(p.note)}</p>` : '<p class="hint">今シーズンの出場記録がまだないので、ポジションからの推定値です。</p>'}
        ${o ? `<div class="lv"><span>Lv <b>${o.lv}</b></span>
          <div class="xpbar"><i style="width:${Math.round(o.xp / S.xpNeed(o.lv) * 100)}%"></i></div>
          <span>育成pt <b>${o.tp}</b></span></div>` : ''}
        <div class="attrs">${S.ATTRS.map(k => `
          <div class="attr">
            <span>${S.ATTR_NAME[k]}</span>
            <div class="abar"><i style="width:${r[k]}%"></i></div>
            <b>${r[k]}</b>
            ${o ? `<button class="plus" data-attr="${k}" ${o.tp > 0 && r[k] < 99 ? '' : 'disabled'}>＋</button>` : ''}
            <small>${o && o.plus[k] ? `+${o.plus[k]}` : ''}${itb[k] || itb.all ? `<em class="itb">🎒+${(itb[k] || 0) + (itb.all || 0)}</em>` : ''}</small>
          </div>`).join('')}
        </div>
        ${o ? `<div class="eqsec">
          <h3>アイテム <small>${S.equipOf(id).length} / 5</small></h3>
          <div class="eqlist">${S.equipOf(id).map(iid => itemCard(iid, { owner: null, cls: 'mini', extra: `<button class="eq-x" data-unequip="${iid}" aria-label="外す">×</button>` })).join('')}
            ${S.equipOf(id).length < 5 ? '<button class="eq-add" id="eqAdd">＋<small>装備</small></button>' : ''}</div>
        </div>` : ''}
        ${o ? `<button class="btn wide" id="toggleStarter">${isStarter ? '⇄ 交代する（ベンチの選手を選ぶ）' : '⇄ スタメンに入れる（交代する選手を選ぶ）'}</button>` : ''}
      </div>`;
    dlg.classList.add('open');
    dlg.querySelector('.close').onclick = closeDlg;
    dlg.onclick = e => { if (e.target === dlg) closeDlg(); };
    dlg.querySelectorAll('[data-attr]').forEach(b => b.onclick = () => {
      if (S.train(id, b.dataset.attr)) openPlayer(id);
    });
    dlg.querySelectorAll('[data-unequip]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      S.unequip(id, b.dataset.unequip);
      openPlayer(id);
    });
    const ea = document.getElementById('eqAdd');
    if (ea) ea.onclick = () => openItemPicker(id);
    const tg = document.getElementById('toggleStarter');
    if (tg) tg.onclick = () => openSwap(id);
  }
  function closeDlg() { const d = document.getElementById('dlg'); d.classList.remove('open'); d.innerHTML = ''; render(); }

  // スカウト：ほかのチームの選手を1人ゲット
  function renderScout() {
    const all = S.teams.flatMap(t => t.players).filter(p => !S.data.owned[p.id]);
    $app.innerHTML = `
      ${header('スカウト')}
      <div class="panel center">
        <p>🪙 ${SCOUT_COST} で、B.PREMIER と B.ONE（横浜EX）の選手から1人がチームに加わります。<br>
        OVRの高い選手ほど出にくくなっています。</p>
        <button class="btn big" id="draw" ${S.data.coins < SCOUT_COST || !all.length ? 'disabled' : ''}>スカウトする</button>
        <p class="hint">コインは試合でもらえます（勝利 150 / 敗戦 60）</p>
      </div>
      <div id="reveal"></div>`;
    bind();
    document.getElementById('draw').onclick = () => {
      const i = (() => {
        const ws = all.map(p => Math.pow(Math.max(100 - p.r.ovr, 5), 2.4));
        let x = Math.random() * ws.reduce((a, b) => a + b, 0);
        for (let k = 0; k < ws.length; k++) { x -= ws[k]; if (x <= 0) return k; }
        return ws.length - 1;
      })();
      const p = all[i];
      S.data.coins -= SCOUT_COST;
      S.own(p.id);
      S.save();
      renderScout();
      const el = document.getElementById('reveal');
      el.innerHTML = `<div class="reveal ${ovrClass(p.r.ovr)}">${card(p.id)}</div>`;
      bind();
    };
  }

  function renderTable() {
    const rows = standings();
    $app.innerHTML = `
      ${header('順位表')}
      <table class="table">
        <thead><tr><th>#</th><th>チーム</th><th>勝</th><th>敗</th><th>得失</th></tr></thead>
        <tbody>${rows.map((x, i) => `<tr class="${x.t.id === S.data.fav ? 'me' : ''}">
          <td>${i + 1}</td><td class="tname">${logo(x.t)}${esc(x.t.id === S.data.fav ? myName() : x.t.short)}</td>
          <td>${x.w}</td><td>${x.l}</td><td>${x.pf - x.pa > 0 ? '+' : ''}${x.pf - x.pa}</td></tr>`).join('')}
        </tbody>
      </table>`;
    bind();
  }

  function renderFree() {
    $app.innerHTML = `
      ${header('フリー対戦')}
      <button class="big-btn online-btn" data-go="online"><small>2台のスマホで</small><span>📡 通信対戦</span></button>
      <p class="hint">好きなチームと対戦できます（順位表には入りません）。</p>
      <div class="team-grid">${S.teams.filter(t => t.id !== S.data.fav).map(t => `
        <button class="team-pick" data-go="pre" data-arg="free:${t.id}" style="${teamStyle(t)}">
          ${logo(t)}<span>${esc(t.short)}</span><small>${Math.round(t.players.slice(0, 5).reduce((a, p) => a + p.r.ovr, 0) / 5)}</small>
        </button>`).join('')}</div>`;
    bind();
  }

  // ---------- 通信対戦（2台の端末。PeerJS で直接つなぐ） ----------
  // ホスト（部屋を作った人）が試合を計算し、ゲスト（部屋に入った人）は自分のチームを操作する
  const PEER_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  const ROOM_PREFIX = 'bstorm-room-';
  let lobby = null; // { peer, conn, role, code, state, msg }

  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PEER_URL;
      s.onload = () => res();
      s.onerror = () => rej(new Error('peerjs'));
      document.head.appendChild(s);
    });
  }

  // PeerJS の JSON 送信は1回に送れる大きさが小さいので、大きいメッセージは分けて送り、受け取ったらつなげる
  const PART = 4000;
  function wireSend(conn, m) {
    if (!conn || !conn.open) return;
    const s = JSON.stringify(m);
    if (s.length <= PART) { conn.send(m); return; }
    const id = Math.random().toString(36).slice(2, 8), n = Math.ceil(s.length / PART);
    for (let i = 0; i < n; i++) conn.send({ pt: [id, i, n, s.slice(i * PART, (i + 1) * PART)] });
  }
  function wireOn(conn, f) {
    const parts = {};
    conn.on('data', d => {
      if (d && d.pt) {
        const [id, i, n, s] = d.pt;
        const a = parts[id] || (parts[id] = { got: 0, s: [] });
        if (a.s[i] === undefined) { a.s[i] = s; a.got++; }
        if (a.got < n) return;
        delete parts[id];
        try { d = JSON.parse(a.s.join('')); } catch (e) { return; }
      }
      f(d);
    });
  }

  function closeLobby() {
    if (!lobby) return;
    try { if (lobby.conn) lobby.conn.close(); } catch (e) { /* もう閉じている */ }
    try { lobby.peer.destroy(); } catch (e) { /* もう閉じている */ }
    lobby = null;
  }

  // 試合に渡す通信の窓口
  // 一瞬切れても試合を終わらせず、つなぎ直して続ける：
  // ・1秒ごとに合図を送り合い、4秒届かなければ「切れた」とみなす
  // ・切れたら、ゲストがホストの部屋へつなぎ直す（試合ごとの合言葉で本人か確かめる）。25秒もどらなければ終了
  // ・アプリが裏に回るときは相手に知らせる（相手は90秒まで待つ）
  const NET_HB = 1000, NET_DEAD = 4000, NET_GIVEUP = 25000, NET_AWAY = 90000, NET_RETRY = 2000;
  function netOf(lb) {
    const ls = [], cs = [], ss = [];
    let conn = null, lost = false, lostAt = 0, peerAway = false, awayAt = 0, closed = false;
    let lastRecv = Date.now(), hbAt = 0, retryAt = 0, trying = null, tryingAt = 0;
    const now = () => Date.now();
    const tell = s => ss.forEach(f => f(s));
    const keepPeer = p => {
      p.on('disconnected', () => { if (!closed && !p.destroyed) try { p.reconnect(); } catch (e) { /* */ } });
      p.on('error', () => { /* 試合中のエラーは、つなぎ直しで対応する */ });
    };
    // つないだ線を使う（はじめの線と、つなぎ直した線）
    const wire = c => {
      wireOn(c, d => {
        if (closed || !d) return;
        if (c !== conn) { if (d.rejoinOk && lb.role === 'guest') adopt(c); return; }
        lastRecv = now();
        if (d.hb) return;
        if (d.away !== undefined) {
          peerAway = !!d.away; awayAt = now();
          if (!lost) tell(peerAway ? 'away' : 'ok');
          return;
        }
        if (d.ready) w.ready = true;
        ls.forEach(f => f(d));
      });
      const down = () => { if (c === conn && !closed) goLost(); };
      c.on('close', down);
      c.on('error', down);
    };
    const adopt = c => {
      const old = conn;
      conn = c; lost = false; peerAway = false; lastRecv = now(); trying = null;
      if (old && old !== c) try { old.close(); } catch (e) { /* */ }
      tell('ok');
    };
    const goLost = () => {
      if (lost || closed) return;
      lost = true; lostAt = now(); retryAt = 0;
      // 古い線は閉じる（片方向だけ届いている場合も、相手がすぐ気づいてつなぎ直せる）
      try { conn.close(); } catch (e) { /* */ }
      tell('lost');
    };
    const giveUp = () => {
      if (closed) return;
      w.close();
      cs.forEach(f => f());
    };
    // ゲスト：ホストの部屋へつなぎ直す
    const rejoin = () => {
      let p = lb.peer;
      if (!p || p.destroyed) { p = lb.peer = new Peer(); keepPeer(p); return; }
      if (p.disconnected) { try { p.reconnect(); } catch (e) { /* */ } return; }
      if (!p.open) return;
      // つなぎかけの線は6秒までは待つ（つながるまで数秒かかることがある）
      if (trying) { if (now() - tryingAt < 6000) return; try { trying.close(); } catch (e) { /* */ } }
      tryingAt = now();
      const c = trying = p.connect(ROOM_PREFIX + lb.code, { reliable: true, serialization: 'json' });
      wire(c);
      c.on('open', () => { if (!closed) wireSend(c, { rejoin: lb.tok }); });
      const fail = () => { if (trying === c) trying = null; }; // だめだったら、次はすぐ試す
      c.on('close', fail);
      c.on('error', fail);
    };
    // ホスト：部屋を開けておく（接続サービスから外れたら入り直す）
    const keepRoom = () => {
      const p = lb.peer;
      if (!p || p.destroyed) {
        const q = lb.peer = new Peer(ROOM_PREFIX + lb.code);
        keepPeer(q);
        q.on('connection', lb.onConn);
      } else if (p.disconnected) { try { p.reconnect(); } catch (e) { /* */ } }
    };
    const timer = setInterval(() => {
      if (closed) return;
      const t = now();
      if (!lost) {
        if (t - hbAt >= NET_HB) { hbAt = t; try { wireSend(conn, { hb: 1 }); } catch (e) { /* */ } }
        if (peerAway) { if (t - awayAt > NET_AWAY) giveUp(); }
        else if (t - lastRecv > NET_DEAD) goLost();
        return;
      }
      if (t - lostAt > (peerAway ? NET_AWAY : NET_GIVEUP)) return giveUp();
      if (t - retryAt < NET_RETRY) return;
      retryAt = t;
      if (lb.role === 'guest') rejoin(); else keepRoom();
    }, 250);
    const w = {
      role: lb.role,
      ready: false,
      send: m => { if (!lost && !closed) try { wireSend(conn, m); } catch (e) { /* 切れている */ } },
      // 送りきれていないデータがたまっている（このあいだは新しい状態を送らない）
      busy: () => {
        if (lost || !conn || !conn.open) return true;
        const dc = conn.dataChannel;
        return (conn.bufferSize || 0) > 0 || (dc && dc.bufferedAmount > 32 * 1024);
      },
      onMessage: f => ls.push(f),
      onClose: f => cs.push(f),
      onState: f => ss.push(f), // 'lost'（再接続中）・'away'（相手がアプリを離れた）・'ok'（もどった）
      // 自分のアプリが裏に回った・もどった
      away: hidden => {
        if (closed) return;
        if (!lost) try { wireSend(conn, { away: hidden ? 1 : 0 }); } catch (e) { /* */ }
        if (!hidden) {
          // 裏にいるあいだは時計が止まっているので、待ち時間を数え直す
          lastRecv = now();
          if (lost) { lostAt = now(); retryAt = 0; }
        }
      },
      // ホスト：つなぎ直しに来た線を受け入れる
      adopt: c => { wire(c); adopt(c); },
      close: () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        if (lobby === lb) lobby = null;
        const c = conn, p = lb.peer;
        setTimeout(() => { try { c.close(); } catch (e) { /* */ } }, 150); // 最後のメッセージ（bye など）を送りきってから
        setTimeout(() => { try { p.destroy(); } catch (e) { /* */ } }, 400);
      },
    };
    conn = lb.conn;
    conn.off('data');
    conn.off('close');
    wire(conn);
    keepPeer(lb.peer);
    lb.net = w;
    return w;
  }

  function myVsSide() {
    const side = sideOf(S.lineup(), myTeam(), true);
    side.team = { ...myTeam(), short: myName() };
    return side;
  }
  function myVsBench(side) {
    const on = side.players.map(p => p.pid);
    return sideOf(S.ownedIds().filter(id => !on.includes(id)), myTeam(), true, true).players;
  }

  function lobbyFail(msg) {
    closeLobby();
    lobby = { state: 'error', msg };
    if (view === 'online') renderOnline();
  }

  async function hostRoom() {
    closeLobby();
    const lb = lobby = { role: 'host', state: 'wait', msg: '部屋を作っています…' };
    renderOnline();
    try { await loadPeer(); } catch (e) { return lobbyFail('通信の部品を読み込めませんでした。ネット接続を確認してください'); }
    let tries = 0;
    const open = () => {
      if (lobby !== lb) return;
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const peer = new Peer(ROOM_PREFIX + code);
      lb.peer = peer;
      peer.on('open', () => { if (lobby !== lb) return peer.destroy(); lb.code = code; lb.msg = '相手が入るのを待っています…'; renderOnline(); });
      peer.on('error', e => {
        if (lobby !== lb || lb.started) return; // 試合が始まってからは、つなぎ直しで対応する（ここで閉じると試合が切れる）
        if (e.type === 'unavailable-id' && ++tries < 6) { peer.destroy(); return open(); } // 番号が使われていたら別の番号で
        lobbyFail('部屋を作れませんでした（' + e.type + '）');
      });
      peer.on('connection', lb.onConn);
    };
    lb.onConn = conn => {
        if (lb.started) {
          // 試合中：つなぎ直しに来た相手（合言葉が合えば）だけ受け入れる
          const first = d => {
            conn.off('data', first);
            if (d && d.rejoin && lb.tok && d.rejoin === lb.tok && lb.net) { lb.net.adopt(conn); wireSend(conn, { rejoinOk: 1 }); }
            else { wireSend(conn, { full: 1 }); setTimeout(() => conn.close(), 500); }
          };
          conn.on('data', first);
          return;
        }
        if (lb.conn) { conn.on('open', () => { wireSend(conn, { full: 1 }); setTimeout(() => conn.close(), 500); }); return; }
        lb.conn = conn;
        wireOn(conn, d => {
          if (!d || !d.hello || lobby !== lb || lb.started) return;
          if (d.hello.ver !== APP_VER) { wireSend(conn, { verNg: APP_VER }); return lobbyFail('アプリのバージョンが違います。両方とも最新にしてください（相手 ' + d.hello.ver + '・自分 ' + APP_VER + '）'); }
          lb.started = true;
          const me = myVsSide();
          const st = Game.create(me, d.hello.side, Math.min(S.data.quarterMin, 5));
          const bench = [myVsBench(me), d.hello.bench || []];
          // データが届いていても、こちら側の open がまだのことがある（open の前に送ると捨てられる）
          lb.tok = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); // つなぎ直しのときの合言葉
          const go2 = () => { wireSend(conn, { start: { st, bench, tok: lb.tok } }); startVs(lb, st, bench); };
          if (conn.open) go2(); else conn.once('open', go2);
        });
        conn.on('close', () => { if (lobby === lb && !lb.started) { lb.conn = null; lb.msg = '相手が抜けました。待っています…'; renderOnline(); } });
    };
    open();
  }

  async function joinRoom(code) {
    if (!/^\d{4}$/.test(code)) { toast('4桁の部屋番号を入力してください'); return; }
    closeLobby();
    const lb = lobby = { role: 'guest', state: 'wait', msg: '部屋につないでいます…', code };
    renderOnline();
    try { await loadPeer(); } catch (e) { return lobbyFail('通信の部品を読み込めませんでした。ネット接続を確認してください'); }
    if (lobby !== lb) return;
    const peer = new Peer();
    lb.peer = peer;
    const timer = setTimeout(() => { if (lobby === lb && !lb.started) lobbyFail('つながりませんでした。部屋番号と、同じWi-Fiにいるかを確認してください'); }, 15000);
    peer.on('error', e => {
      if (lobby !== lb || lb.started) return; // 試合が始まってからは、つなぎ直しで対応する
      clearTimeout(timer);
      lobbyFail(e.type === 'peer-unavailable' ? 'その番号の部屋が見つかりません' : 'つながりませんでした（' + e.type + '）');
    });
    peer.on('open', () => {
      if (lobby !== lb) return;
      const conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
      lb.conn = conn;
      conn.on('open', () => {
        const side = myVsSide();
        wireSend(conn, { hello: { ver: APP_VER, side, bench: myVsBench(side) } });
        lb.msg = '相手の準備を待っています…';
        renderOnline();
      });
      wireOn(conn, d => {
        if (lobby !== lb || !d) return;
        if (d.full) { clearTimeout(timer); return lobbyFail('その部屋はもう対戦中です'); }
        if (d.verNg) { clearTimeout(timer); return lobbyFail('アプリのバージョンが違います。両方とも最新にしてください（相手 ' + d.verNg + '・自分 ' + APP_VER + '）'); }
        if (d.start && !lb.started) { clearTimeout(timer); lb.started = true; lb.tok = d.start.tok; startVs(lb, d.start.st, d.start.bench); }
      });
    });
  }

  function startVs(lb, st, bench) {
    if (S.data.suspended) { delete S.data.suspended; S.save(); } // 中断中の試合は消える（部屋に入る前に確認ずみ）
    Sound.unlock();
    match = { st, free: true, opp: st.sides[1].team, vs: { net: netOf(lb), bench, side: lb.role === 'host' ? 0 : 1 } };
    go('match');
  }

  function renderOnline() {
    const lb = lobby;
    const busy = lb && lb.state === 'wait';
    $app.innerHTML = `
      ${header('通信対戦')}
      <p class="hint">2台のスマホで対戦します。1人が「部屋を作る」、もう1人がその部屋番号で「部屋に入る」を押してください。
        それぞれ自分のチーム（チーム・育成のスタメン）で戦います。コイン・XP・順位表には入りません。</p>
      ${busy ? `
        <section class="online-box">
          ${lb.role === 'host' && lb.code ? `<small>部屋番号</small><b class="room-code">${lb.code}</b>` : ''}
          ${lb.role === 'guest' ? `<small>部屋番号 ${esc(lb.code)}</small>` : ''}
          <p>${esc(lb.msg)}</p>
          <button class="btn" id="vsCancel">やめる</button>
        </section>` : `
        ${lb && lb.state === 'error' ? `<p class="online-err">${esc(lb.msg)}</p>` : ''}
        <section class="online-box">
          <h2>部屋を作る</h2>
          <p>部屋番号が表示されます。相手に伝えてください。</p>
          <button class="btn primary" id="vsHost">部屋を作る</button>
        </section>
        <section class="online-box">
          <h2>部屋に入る</h2>
          <input id="vsCode" class="room-in" inputmode="numeric" maxlength="4" placeholder="4桁の番号" autocomplete="off">
          <button class="btn primary" id="vsJoin">部屋に入る</button>
        </section>
        <p class="hint">同じWi-Fiにつないでいると、遅れが少なく快適です。最初の接続だけ、無料の接続サービス（PeerJS）を使います。
          両方とも同じバージョンのアプリが必要です（現在 ${esc(APP_VER)}）。</p>`}`;
    bind();
    const q = id => document.getElementById(id);
    const okSus = () => !S.data.suspended || confirm('中断した試合があります。通信対戦を始めると消えますが、よろしいですか？');
    if (q('vsCancel')) q('vsCancel').onclick = () => { closeLobby(); renderOnline(); };
    if (q('vsHost')) q('vsHost').onclick = () => { if (okSus()) hostRoom(); };
    if (q('vsJoin')) {
      const inp = q('vsCode');
      inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 4); };
      inp.onkeydown = e => { if (e.key === 'Enter') q('vsJoin').click(); };
      q('vsJoin').onclick = () => { if (okSus()) joinRoom(inp.value); };
    }
  }

  // 通信対戦の結果（記録はしない）
  function finishVs(st, me) {
    const op = 1 - me;
    const win = st.score[me] > st.score[op];
    const nm = sd => esc(st.sides[sd].team.short);
    const who = sd => Object.keys(st.box[sd]).map(pid => ({ pid, name: S.playerById[pid] ? S.playerById[pid].name : pid }));
    const tbl = sd => `<table class="box"><thead><tr><th>選手</th><th>PTS</th><th>RB</th><th>AST</th><th>STL</th><th>FG</th><th>3P</th></tr></thead>
      <tbody>${who(sd).map(p => { const b = st.box[sd][p.pid]; return `<tr><td>${esc(p.name)}</td><td><b>${b.pts}</b></td><td>${b.reb}</td><td>${b.ast}</td><td>${b.stl}</td><td>${b.fgm}/${b.fga}</td><td>${b.p3m}/${b.p3a}</td></tr>`; }).join('')}</tbody></table>`;
    const qs = st.qScores.map((s, i) => [s[me] - (i ? st.qScores[i - 1][me] : 0), s[op] - (i ? st.qScores[i - 1][op] : 0)]);
    $app.innerHTML = `
      ${header(win ? '勝利！' : '敗戦…')}
      <section class="result ${win ? 'win' : 'lose'}">
        <div class="final"><span>${nm(me)}</span><b>${st.score[me]} - ${st.score[op]}</b><span>${nm(op)}</span></div>
        <div class="qs">${qs.map((s, i) => `<span>${i < 4 ? i + 1 + 'Q' : 'OT'} ${s[0]}-${s[1]}</span>`).join('')}</div>
        <div class="reward">通信対戦（記録には残りません）</div>
      </section>
      <h2 class="sec">${nm(me)}</h2>${tbl(me)}
      <h2 class="sec">${nm(op)}</h2>${tbl(op)}
      <div class="row2">
        <button class="btn" data-go="online">通信対戦へ</button>
        <button class="btn primary" data-go="home">ホームへ</button>
      </div>`;
    match = null;
    bind();
  }

  const lvName = v => ['', 'とても弱い', '弱い', '少し弱い', '普通', '普通', '少し強い', '強い', 'とても強い', '非常に強い', '最強'][v];

  // ---------- 自分の BGM（このスマホの中だけに保存。GitHub などには送らない） ----------
  const BgmStore = (() => {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open('bstorm-bgm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('songs');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
      const t = d.transaction('songs', mode);
      const q = fn(t.objectStore('songs'));
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    }));
    return {
      get: k => tx('readonly', st => st.get(k)),
      put: (k, v) => tx('readwrite', st => st.put(v, k)),
      del: k => tx('readwrite', st => st.delete(k)),
    };
  })();
  const myBgm = {}; // mode → 曲のファイル名
  const BGM_MODES = [['menu', 'ホーム・メニュー'], ['off', 'オフェンス'], ['def', 'ディフェンス']];
  function loadMyBgm() {
    if (!window.indexedDB) return;
    BGM_MODES.forEach(([k]) => BgmStore.get(k).then(v => {
      if (!v || !v.data) return;
      myBgm[k] = v.name;
      Sound.setCustom(k, v.data).catch(() => {});
      if (view === 'settings') render();
    }).catch(() => {}));
  }

  async function pickBgm(k, file) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) return toast('ファイルが大きすぎます（60MBまで）');
    toast('曲を読み込み中…');
    try {
      const data = await file.arrayBuffer();
      Sound.unlock();
      await Sound.setCustom(k, data); // 読めない形式ならここでエラー
      await BgmStore.put(k, { name: file.name, data });
      myBgm[k] = file.name;
      toast(`${BGM_MODES.find(m => m[0] === k)[1]}の曲を「${file.name}」にしました`);
    } catch (e) {
      // 前にえらんでいた曲にもどす
      BgmStore.get(k).then(v => Sound.setCustom(k, v && v.data ? v.data : null)).catch(() => Sound.setCustom(k, null));
      toast('この曲は読み込めませんでした（mp3・m4a などの音声ファイルを選んでください）');
    }
    render();
  }

  // ---------- バックアップ（記録をファイルに保存・ファイルから戻す） ----------
  const BACKUP_KEY = 'bpDynasty.v1'; // store.js の保存先と同じ
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  async function saveBackup() {
    S.data.lastBackup = new Date().toISOString();
    S.save();
    const body = JSON.stringify({ app: 'bleague-storm', kind: 'backup', ver: APP_VER, at: S.data.lastBackup, data: S.data });
    const name = `Bストーム_バックアップ_${today()}.json`;
    const file = new File([body], name, { type: 'application/json' });
    // スマホは共有画面（Google ドライブ・LINE・メールなど）。使えないときはダウンロード
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Bストームのバックアップ' });
        toast('バックアップを保存しました');
        return render();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return render(); // 共有をやめた
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`「${name}」をダウンロードしました`);
    render();
  }

  async function loadBackup(file) {
    if (!file) return;
    let b;
    try { b = JSON.parse(await file.text()); } catch (e) { b = null; }
    const d = b && b.app === 'bleague-storm' && b.kind === 'backup' ? b.data : null;
    if (!d || typeof d !== 'object' || typeof d.owned !== 'object' || !Array.isArray(d.lineup)) {
      return toast('Bストームのバックアップファイルではないようです');
    }
    const n = Object.keys(d.owned).length;
    const when = b.at ? new Date(b.at).toLocaleString('ja-JP') : '日時不明';
    if (!confirm(`${when} のバックアップ（選手 ${n}人・コイン ${d.coins || 0}）に戻します。\n現在の記録は上書きされて消えます。よろしいですか？`)) return;
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(d)); } catch (e) { return toast('保存できませんでした（空き容量を確認してください）'); }
    alert('バックアップから戻しました。アプリを読み込み直します。');
    location.reload();
  }

  function renderSettings() {
    const d = S.data;
    const opt = (key, vals) => vals.map(([v, l]) => `<button class="chip ${d[key] === v ? 'on' : ''}" data-set="${key}" data-val="${v}">${l}</button>`).join('');
    $app.innerHTML = `
      ${header('設定')}
      <div class="panel">
        <h3>CPUの強さ <b id="lvName">${lvName(d.cpuLv)}</b></h3>
        <div class="lv-row">
          <button class="chip" data-lv="-1">−</button>
          <input type="range" id="cpuLv" min="1" max="10" step="1" value="${d.cpuLv}">
          <button class="chip" data-lv="1">＋</button>
          <b class="lv-num" id="lvNum">${d.cpuLv}</b>
        </div>
        <p class="hint">弱くすると、CPUの能力・スティール・シュートが下がり、自分のシュートゲージの緑が広くなります。</p>
        <h3>1クォーターの長さ</h3><div class="chips">${opt('quarterMin', [[1, '1分'], [2, '2分'], [3, '3分'], [5, '5分']])}</div>
        <h3>効果音・観客の声</h3><div class="chips">${opt('sound', [[1, 'あり'], [0, 'なし']])}</div>
        <h3>BGM</h3><div class="chips">${opt('bgm', [[1, 'あり'], [0, 'なし']])}</div>
        <h3>BGMの曲</h3>
        <p class="hint">スマホに入っている曲（mp3・m4a など）を、ホーム・メニュー画面（試合以外の画面）と、試合中のオフェンス・ディフェンスのBGMにできます。曲はこのスマホの中だけに保存され、他の人には届きません。選ばない場合は、アプリの曲が流れます。</p>
        ${BGM_MODES.map(([k, l]) => `<div class="mybgm">
          <span>${l}：<b>${myBgm[k] ? '🎵 ' + esc(myBgm[k]) : 'アプリの曲'}</b></span>
          <label class="btn">曲を選ぶ<input type="file" accept="audio/*,.mp3,.m4a,.aac,.wav" data-bgmfile="${k}" hidden></label>
          ${myBgm[k] ? `<button class="btn" data-bgmreset="${k}">アプリの曲に戻す</button>` : ''}
        </div>`).join('')}
      </div>
      <div class="panel">
        <h3>バックアップ</h3>
        <p class="hint">選手・育成・コイン・アイテム・シーズンなどの記録を、1つのファイルに保存できます。<b>アプリを削除・インストールし直す前</b>や<b>スマホを変えるとき</b>は、必ず保存してください（BGMに選んだ曲は含まれません）。</p>
        <p class="hint">前回の保存：<b>${d.lastBackup ? esc(new Date(d.lastBackup).toLocaleString('ja-JP')) : 'まだありません'}</b></p>
        <div class="row2">
          <button class="btn primary" id="bkSave">バックアップを保存</button>
          <label class="btn">バックアップから戻す<input type="file" accept=".json,application/json" id="bkLoad" hidden></label>
        </div>
      </div>
      <div class="panel">
        <h3>オフライン</h3>
        <div id="offState">${offlineHtml()}</div>
      </div>
      <div class="panel">
        <h3>アップデート</h3>
        <p class="hint">現在のバージョン：<b>v${APP_VER}</b></p>
        <button class="btn" id="checkUpd">新しいバージョンがあるか確認する</button>
      </div>
      <div class="panel">
        <h3>推しチームを選び直す</h3>
        <p class="hint">記録・育成・コインが全て消えます。</p>
        <button class="btn danger" id="reset">最初からやり直す</button>
      </div>
      <p class="note">選手データ：B.LEAGUE公式サイト ${esc(window.BP_DATA.season)}（${esc(window.BP_DATA.updated)} 取得）<br>
      能力値はスタッツから自動で計算した、このアプリ独自のものです。</p>`;
    bind();
    $app.querySelectorAll('[data-set]').forEach(b => b.onclick = () => {
      d[b.dataset.set] = Number(b.dataset.val);
      if (b.dataset.set === 'sound') Sound.setOn(!!d.sound);
      if (b.dataset.set === 'bgm') Sound.setBgmOn(!!d.bgm);
      S.save();
      render();
    });
    const setLv = v => {
      d.cpuLv = Math.max(1, Math.min(10, v));
      S.save();
      document.getElementById('cpuLv').value = d.cpuLv;
      document.getElementById('lvNum').textContent = d.cpuLv;
      document.getElementById('lvName').textContent = lvName(d.cpuLv);
    };
    document.getElementById('cpuLv').oninput = e => setLv(Number(e.target.value));
    $app.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => setLv(d.cpuLv + Number(b.dataset.lv)));
    document.getElementById('checkUpd').onclick = () => checkUpdate(true);
    document.getElementById('bkSave').onclick = () => saveBackup();
    document.getElementById('bkLoad').onchange = e => { loadBackup(e.target.files[0]); e.target.value = ''; };
    $app.querySelectorAll('[data-bgmfile]').forEach(inp => inp.onchange = () => pickBgm(inp.dataset.bgmfile, inp.files[0]));
    $app.querySelectorAll('[data-bgmreset]').forEach(b => b.onclick = async () => {
      const k = b.dataset.bgmreset;
      await Sound.setCustom(k, null);
      delete myBgm[k];
      try { await BgmStore.del(k); } catch (e) { /* 消せなくても次から使わない */ }
      toast('アプリの曲に戻しました');
      render();
    });
    document.getElementById('reset').onclick = () => {
      if (confirm('本当に最初からやり直しますか？')) { S.reset(); go('home'); }
    };
  }

  // ---------- オフライン（写真・顔・ロゴをスマホに保存） ----------
  const offline = { done: 0, total: 0, failed: 0, on: false };

  function offlineHtml() {
    if (!offline.on) return `<p class="hint">ネット上（https）で開くと、選手の写真などをスマホに保存して、オフラインでも遊べるようになります。</p>`;
    const { done, total, failed } = offline;
    if (total && done >= total) return `<p class="ok">✅ オフラインでも遊べます（画像 ${total} 枚を保存済み）</p>`;
    const pct = total ? Math.floor(done / total * 100) : 0;
    return `<div class="bar"><i style="width:${pct}%"></i></div>
      <p class="hint">${total ? `保存中… ${done} / ${total} 枚（${pct}%）` : '準備中…'}${failed ? `<br>${failed} 枚が取れませんでした。ネットにつないで開き直すと、続きを取得します。` : ''}</p>`;
  }

  function startOffline() {
    const sw = navigator.serviceWorker;
    offline.on = true;
    sw.addEventListener('message', e => {
      const m = e.data || {};
      if (m.type !== 'offline' || m.error) return;
      Object.assign(offline, m);
      const box = document.getElementById('offState');
      if (box) box.innerHTML = offlineHtml();
      if (m.total && m.done >= m.total && !S.data.offlineReady) {
        S.data.offlineReady = 1;
        S.save();
        toast('オフラインでも遊べるようになりました');
      }
    });
    // スマホの空きが少ないときに消されないようにたのむ
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    sw.register('sw.js').then(reg => { watchUpdate(reg); return sw.ready; }).then(reg => reg.active && reg.active.postMessage('prefetch'));
  }

  // ---------- アップデート ----------
  // 新しい版を公開すると、新しい sw.js が裏で読み込まれて待っている。それを見つけたらお知らせを出す
  const APP_VER = ((document.querySelector('script[src*="js/app.js"]') || {}).src || '').split('v=')[1] || '?';
  let updReg = null, updating = false;

  function watchUpdate(reg) {
    updReg = reg;
    const sw = navigator.serviceWorker;
    if (reg.waiting && sw.controller) showUpdate();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && sw.controller) showUpdate(); });
    });
    // 新しい版に切りかわったら読み込み直す（ボタンを押したときだけ）
    sw.addEventListener('controllerchange', () => { if (updating) location.reload(); });
    // アプリに戻ってきたときと、30分ごとに確認する
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(false); });
    setInterval(() => checkUpdate(false), 30 * 60 * 1000);
  }

  function checkUpdate(byUser) {
    if (!updReg) { if (byUser) toast('この画面では確認できません（ネットで開いたときに使えます）'); return; }
    updReg.update().then(() => {
      if (!byUser) return;
      if (updReg.waiting) showUpdate();
      else if (updReg.installing) toast('新しいバージョンを読み込み中です。しばらくお待ちください');
      else toast(`現在のバージョン（v${APP_VER}）が最新です`);
    }).catch(() => { if (byUser) toast('確認できませんでした。ネット接続を確認してください'); });
  }

  function showUpdate() {
    if (document.getElementById('updBar')) return;
    // 試合中はじゃまをしないよう、試合が終わってから出す
    if (document.getElementById('m3d')) { setTimeout(showUpdate, 5000); return; }
    const bar = document.createElement('div');
    bar.id = 'updBar';
    bar.className = 'upd-bar';
    bar.innerHTML = `<span>✨ 新しいバージョンがあります</span>
      <button class="go">アップデート</button><button class="later" aria-label="後で">後で</button>`;
    bar.querySelector('.go').onclick = () => {
      const w = updReg && updReg.waiting;
      if (!w) { location.reload(); return; }
      updating = true;
      bar.querySelector('.go').textContent = '更新中…';
      w.postMessage('skipWaiting');
    };
    bar.querySelector('.later').onclick = () => bar.remove();
    document.body.appendChild(bar);
  }

  // ---------- あそびかた（操作説明） ----------
  // 1つの項目：見出し・1行のまとめ・「くわしく」（開くと出る）
  const hsec = (icon, title, sum, more = '') => `
      <section><h3><span class="hi">${icon}</span>${title}</h3>
        <p class="sum">${sum}</p>
        ${more ? `<details><summary>詳しく</summary>${more}</details>` : ''}</section>`;
  // ボタンの説明（こうげき・まもりで、ボタンの名前と役割が変わる）
  // rows：[ボタン（b-b 右下の大きいボタン／b-a その左／b-c その上）, 名前, 説明]
  const hbtns = (cls, icon, title, lead, rows, more) => `
      <section class="hb ${cls}"><h3><span class="hi">${icon}</span>${title}</h3>
        <p class="sum">${lead}</p>
        <div class="hb-list">${rows.map(([k, name, txt]) => `
          <div class="hb-row"><i class="hb-btn ${k}${name.length >= 5 ? ' long' : ''}">${name}</i><div><b>${name}</b><span>${txt}</span></div></div>`).join('')}</div>
        <details><summary>詳しく</summary>${more}</details></section>`;
  const HELP_MATCH = hsec('🕹', '動く', '左下を指でなぞると<b>十字キー</b>が出ます。黄色い輪の選手が動きます。',
      `<p>操作する選手は自動で切り替わります（オフェンス：ボールを持った選手／ディフェンス：ボールを持った相手をマークする選手）。</p>`)
    + hbtns('off', '🏀', 'オフェンスのボタン', '<b>ボールを持っているとき</b>。右下の3つのボタンは、次のように使います。', [
      ['b-b', 'シュート', '長押しでゲージが溜まる。<b>一番上（緑に光る）</b>で離すと「パーフェクト」で入りやすい。押しすぎて赤くなると入りにくい。'],
      ['b-a', 'パス', '十字キーの向きにいる味方へパス。コートの<b>味方をタップ</b>しても、その選手にパス。'],
      ['b-c', 'ドライブ', '長押しでダッシュ。相手の近くで使うと、抜けることがあります。'],
    ], `<ul><li>ゴールの近くでシュート → <b>レイアップ</b>。勢いよく走り込んでシュート → <b>ダンク</b>（大きい選手・ドライブが得意な選手）。</li>
        <li>十字キーを倒していないときのパスは、一番空いている味方へ。</li>
        <li>疲れている選手や、相手が近くにいるときは入りにくくなります。</li></ul>`)
    + hbtns('def', '🛡', 'ディフェンスのボタン', '<b>相手がボールを持っているとき</b>。同じ3つのボタンの<b>名前と役割が変わります</b>。', [
      ['b-b', 'ブロック', 'ジャンプ。相手がシュートするときに近くで跳ぶと、止められることがあります。こぼれたボールのときは「ジャンプ」と出て、リバウンドを取ります。'],
      ['b-a', 'スティール', 'ボールを持った相手の近くで押すと、ボールを奪えることがあります。やりすぎるとファウル。'],
      ['b-c', 'ディフェンス', '長押ししている間、マークする相手に自動でついて行きます。十字キーで少しずらせます。'],
    ], `<ul><li>コートの<b>味方をタップ</b>すると、その選手を操作できます。</li>
        <li>疲れている選手は、足が遅くなり、スティールも少し弱くなります。</li></ul>`)
    + hsec('🚩', 'フリースロー・スローイン', 'フリースローは<b>シュートボタン</b>、スローインは<b>パスボタン</b>（「スローイン」と出ます）。',
      `<ul><li>シュート中にファウルされると<b>フリースロー</b>。</li>
        <li>それ以外のファウル・アウト・24秒は<b>スローイン</b>。</li>
        <li>チームファウル（得点ボードの F）が5つ目からは、シュート中でなくても<b>フリースロー1本</b>。F4 から赤くなります。</li></ul>`)
    + hsec('🔋', '疲れと選手交代', '得点カードの下の<b>バー</b>が疲れ（緑→黄→赤）。左上の「Ⅱ」→「<b>選手交代</b>」で休ませましょう。',
      `<ul><li>疲れると足が遅くなり、シュートや守りも少し弱くなります。ベンチで休むと回復。クォーターの間にも少し回復します。</li>
        <li>交代は、下げる選手 → 入れる選手 の順にタップ。ボールが止まったとき（得点の後・スローインの前など）に入れ替わります。</li>
        <li>相手のチームも、疲れたら交代します。</li></ul>`)
    + hsec('⏸', '中断と再開', '左上の「Ⅱ」→「中断して、後で再開」。ホームの「再開する」で続きから。',
      `<p>アプリを閉じてしまっても、続きから遊べます。</p>`)
    + hsec('⌨️', 'パソコンのキー', '移動：WASD／矢印　J：パス・スティール　K（スペース）：シュート・ブロック　L：ドライブ・ディフェンス');
  const HELP_GROW = hsec('🏆', 'シーズン', 'ホームの大きなボタンで、次の試合へ。勝つほど順位が上がります（「順位表」で見られます）。',
      `<ul><li>「フリー対戦」は、好きなチームと練習試合。</li>
        <li>試合でコインがもらえます（勝ち 150・負け 60、シーズンの試合は +20）。</li></ul>`)
    + hsec('📈', '選手を育てる', '試合で XP が貯まってレベルアップ → 育成pt。「チーム・育成」で選手をタップして能力を上げましょう。',
      `<ul><li>試合に出た選手（交代で入った選手も）に XP が入ります。活躍するほど多め、勝つと1.3倍。</li>
        <li>スタメンの「⇄ 交代」で、誰と入れ替えるか選べます。</li></ul>`)
    + hsec('🎴', 'スカウト', `🪙 ${SCOUT_COST} で、新しい選手が1人チームに加わります。`,
      `<p>OVR の高い選手ほど出にくくなっています。</p>`)
    + hsec('🎁', 'ガチャ', '1日3回 無料。その後はコイン（1回 🪙100、10回 🪙900）。',
      `<ul><li>出やすさ：N 50%・R 30%・SR 15%・SSR 4.5%・UR 0.5%</li>
        <li>30回連続で SSR 以上が出なかった場合、次は必ず SSR 以上。</li></ul>`)
    + hsec('🎒', 'アイテムの装備', '選手の画面（チーム・育成 → 選手をタップ）で装備します。1人5つまで、同じ種類は1つ。',
      `<p>SSR・UR には「◆」の特別な効果が付いています（試合の大事な場面で強くなる、など）。</p>`)
    + hsec('⭐', 'アイテムの強化', '同じアイテムが出たら「×2」と貯まります。「アイテム」でカードを押すと強化（★5 まで）。',
      `<ul><li>使う数：★2 に1個、★3 に2個、★4 に3個、★5 に4個（合計10個）。</li>
        <li>★が上がるごとに効果が強くなります。SSR・UR を ★5 にすると、特別な効果も強くなります。</li>
        <li>★5 の分が貯まった後に同じアイテムが出たら、コインになります。</li></ul>`);
  const HELP_ETC = hsec('💾', 'バックアップ（重要）', '「設定」→「バックアップ」で<b>ファイルに保存</b>。アプリを入れ直す前や、スマホを変える前に。',
      `<ul><li>戻すときは「ファイルから戻す」（最初の画面にもあります）。</li>
        <li>アプリを消すと、記録・コイン・選手も消えます。定期的に保存しておきましょう。</li></ul>`)
    + hsec('💪', 'CPUの強さ', '勝てないとき・簡単すぎるときは「設定」→「CPUの強さ」で調節。')
    + hsec('🎵', '音とBGM', '「設定」で効果音・BGM のオン/オフ。<b>自分の曲</b>も選べます。',
      `<ul><li>「BGMの曲」で、スマホの中の曲をホーム・メニュー用、試合のオフェンス用・ディフェンス用に選べます。</li>
        <li>「1クォーターの長さ」も「設定」で変えられます。</li></ul>`)
    + hsec('🔄', 'アップデート', '新しい版が出ると［アップデート］が出ます。押すと最新に。',
      `<p>出ないときは「設定」→「アップデート」の「確認する」。</p>`);
  const HELP_TABS = [['match', '🏀 試合の操作', HELP_MATCH], ['grow', '📈 育成', HELP_GROW], ['etc', '⚙️ その他', HELP_ETC]];
  const HELP = `<div class="help">${HELP_MATCH}</div>`; // 試合中の「操作説明」は、試合のそうさだけ
  let helpTab = 'match';

  function renderHelp() {
    const t = HELP_TABS.find(x => x[0] === helpTab) || HELP_TABS[0];
    $app.innerHTML = `${header('遊び方')}
      <div class="help-tabs">${HELP_TABS.map(([id, name]) => `<button class="chip ${id === t[0] ? 'on' : ''}" data-htab="${id}">${name}</button>`).join('')}</div>
      <div class="help">${t[2]}</div>`;
    bind();
    $app.querySelectorAll('[data-htab]').forEach(b => b.onclick = () => { helpTab = b.dataset.htab; renderHelp(); window.scrollTo(0, 0); });
  }

  // ---------- 試合 ----------
  let match = null;

  function renderPre() {
    const free = String(viewArg).startsWith('free:');
    const opp = S.teamById[String(viewArg).replace('free:', '')];
    const me = sideOf(S.lineup(), myTeam(), true);
    const cpu = cpuSide(opp);
    const avgOvr = s => Math.round(s.players.reduce((a, p) => a + p.r.ovr, 0) / 5);
    $app.innerHTML = `
      ${header(free ? 'フリー対戦' : 'シーズン')}
      <div class="vs">
        <div class="vs-team" style="${teamStyle(myTeam())}">${logo(myTeam())}<b>${esc(myName())}</b><span>${avgOvr(me)}</span></div>
        <div class="vs-x">VS</div>
        <div class="vs-team" style="${teamStyle(opp)}">${logo(opp)}<b>${esc(opp.short)}</b><span>${avgOvr(cpu)}</span></div>
      </div>
      <div class="lineups">
        ${[me, cpu].map(s => `<div>${s.players.map((p, i) => `
          <div class="lrow">${photo(S.playerById[p.pid], 'sm')}<span class="pos">${SLOTS[i]}</span><span class="nm">${esc(p.name)}</span><b>${p.r.ovr}</b></div>`).join('')}</div>`).join('')}
      </div>
      <button class="big-btn" id="tip"><span>ティップオフ！</span></button>
      <p class="hint center">操作がわからないときは、ホームの「📖 遊び方」か、試合中の一時停止（Ⅱ）→「操作説明」を見てください。</p>`;
    bind();
    document.getElementById('tip').onclick = () => {
      if (S.data.suspended && !confirm('中断した試合があります。新しい試合を始めると消えますが、よろしいですか？')) return;
      delete S.data.suspended;
      Sound.unlock(); // スマホはボタンを押したときでないと音が出せない
      match = { st: Game.create(me, cpu, Math.min(S.data.quarterMin, 5)), free, opp };
      go('match');
    };
  }

  // 中断した試合のつづきから
  function resumeMatch() {
    const sv = S.data.suspended;
    const opp = S.teamById[sv.opp];
    const me = sideOf(sv.home.filter(id => S.data.owned[id]), myTeam(), true, true);
    const cpu = sideOf(sv.away, opp, false, true);
    if (me.players.length < 5) { alert('選手が揃わないため再開できません'); delete S.data.suspended; S.save(); return render(); }
    const st = Game.create(me, cpu, sv.qLen / 60);
    Object.assign(st, { score: sv.score, q: sv.q, clock: sv.clock, qScores: sv.qScores, poss: sv.poss });
    [0, 1].forEach(sd => Object.keys(sv.box[sd] || {}).forEach(pid => { st.box[sd][pid] = sv.box[sd][pid]; }));
    match = { st, free: sv.free, opp, resume: { firstPoss: sv.firstPoss, teamFouls: sv.teamFouls } };
    go('match');
  }

  async function renderMatch() {
    const m = match;
    $app.innerHTML = '<div class="m3d" id="m3d"><div class="m3d-loading">読み込み中…</div></div>';
    document.body.classList.add('playing');
    Sound.setMenu(false); // 試合中は試合の BGM だけ
    if (!window.Match3D) await new Promise(r => window.addEventListener('match3d-ready', r, { once: true }));
    if (match !== m) return;
    const end = () => { document.body.classList.remove('playing'); Sound.setMenu(true); };
    // ベンチの選手（交代用）：自分は持っている選手のうちコートにいない人、CPU はチームの上位10人のうちコートにいない人
    const onCourt = sd => m.st.sides[sd].players.map(p => p.pid);
    if (m.vs) {
      const net = m.vs.net;
      m.ctrl = await Match3D.start({
        el: document.getElementById('m3d'),
        st: m.st,
        bench: m.vs.bench,
        net,
        faceOf: pid => (S.playerById[pid] ? S.playerById[pid].photo : null),
        faceHiOf: pid => (S.playerById[pid] ? S.playerById[pid].face : null),
        helpHtml: HELP,
        onEnd: st => { end(); if (match === m) finishVs(st, m.vs.side); },
        onQuit: () => { end(); match = null; go('online'); },
        onSuspend: () => { end(); match = null; go('online'); },
      });
      if (match !== m && m.ctrl) m.ctrl.destroy();
      else if (m.ctrl) net.send({ ready: 1 });
      return;
    }
    const bench = [
      sideOf(S.ownedIds().filter(id => !onCourt(0).includes(id)), myTeam(), true, true).players,
      sideOf(m.opp.players.slice(0, 10).map(p => p.id).filter(id => !onCourt(1).includes(id)), m.opp, false, true).players,
    ];
    m.ctrl = await Match3D.start({
      el: document.getElementById('m3d'),
      st: m.st,
      bench,
      cpuLv: S.data.cpuLv,
      faceOf: pid => S.playerById[pid].photo,
      faceHiOf: pid => S.playerById[pid].face,
      helpHtml: HELP,
      resume: m.resume,
      onSave: snap => {
        S.data.suspended = {
          ...snap, opp: m.opp.id, free: m.free,
          home: m.st.sides[0].players.map(p => p.pid), away: m.st.sides[1].players.map(p => p.pid),
        };
        S.save();
      },
      onSuspend: () => { end(); match = null; toast('試合を中断しました。ホームから再開できます'); go('home'); },
      onEnd: () => { end(); if (match === m) finishMatch(); },
      onQuit: () => { end(); match = null; delete S.data.suspended; S.save(); go('home'); },
    });
  }

  function finishMatch() {
    const { st, free, opp } = match;
    delete S.data.suspended;
    const win = st.score[0] > st.score[1];
    const coins = (win ? 150 : 60) + (free ? 0 : 20);
    S.data.coins += coins;
    const box = st.box[0];
    const lvUps = [];
    const played = Object.keys(box); // 出場した選手（交代で入った選手も）
    Object.entries(box).forEach(([pid, b]) => {
      const xp = Math.round((25 + b.pts * 1.5 + b.reb + b.ast * 2 + b.stl * 2 + b.blk * 2) * (win ? 1.3 : 1));
      b.xp = xp;
      if (S.addXp(pid, xp)) lvUps.push(pid);
    });
    S.ownedIds().filter(id => !played.includes(id)).forEach(id => { if (S.addXp(id, 12)) lvUps.push(id); });
    if (!free) {
      const sea = S.data.season;
      record(S.data.fav, opp.id, st.score[0], st.score[1]);
      simRound(opp.id);
      sea.game++;
    }
    S.data.history.unshift({ opp: opp.id, s: [...st.score], free });
    S.data.history = S.data.history.slice(0, 30);
    S.save();

    const who = sd => Object.keys(st.box[sd]).map(pid => ({ pid, name: S.playerById[pid] ? S.playerById[pid].name : pid }));
    const all = [0, 1].flatMap(sd => who(sd).map(p => ({ p, b: st.box[sd][p.pid], sd })));
    const mvp = all.filter(x => x.sd === (win ? 0 : 1))
      .sort((a, b) => (b.b.pts + b.b.reb + b.b.ast * 1.5) - (a.b.pts + a.b.reb + a.b.ast * 1.5))[0];
    const tbl = sd => `<table class="box"><thead><tr><th>選手</th><th>PTS</th><th>RB</th><th>AST</th><th>STL</th><th>FG</th><th>3P</th>${sd === 0 ? '<th>XP</th>' : ''}</tr></thead>
      <tbody>${who(sd).map(p => { const b = st.box[sd][p.pid]; return `<tr><td>${esc(p.name)}</td><td><b>${b.pts}</b></td><td>${b.reb}</td><td>${b.ast}</td><td>${b.stl}</td><td>${b.fgm}/${b.fga}</td><td>${b.p3m}/${b.p3a}</td>${sd === 0 ? `<td>+${b.xp}</td>` : ''}</tr>`; }).join('')}</tbody></table>`;
    const qs = st.qScores.map((s, i) => [s[0] - (i ? st.qScores[i - 1][0] : 0), s[1] - (i ? st.qScores[i - 1][1] : 0)]);

    $app.innerHTML = `
      ${header(win ? '勝利！' : '敗戦…')}
      <section class="result ${win ? 'win' : 'lose'}">
        <div class="final"><span>${esc(myName())}</span><b>${st.score[0]} - ${st.score[1]}</b><span>${esc(opp.short)}</span></div>
        <div class="qs">${qs.map((s, i) => `<span>${i < 4 ? i + 1 + 'Q' : 'OT'} ${s[0]}-${s[1]}</span>`).join('')}</div>
        <div class="reward">🪙 +${coins}${lvUps.length ? ` ・ レベルアップ ${[...new Set(lvUps)].length}人！（育成ptで能力を上げましょう）` : ''}</div>
      </section>
      ${mvp ? `<div class="mvp">${photo(S.playerById[mvp.p.pid])}<div><small>MVP</small><b>${esc(mvp.p.name)}</b>
        <span>${mvp.b.pts}点 ${mvp.b.reb}RB ${mvp.b.ast}AST</span></div></div>` : ''}
      <h2 class="sec">${esc(myName())}</h2>${tbl(0)}
      <h2 class="sec">${esc(opp.short)}</h2>${tbl(1)}
      <div class="row2">
        <button class="btn" data-go="team">育成へ</button>
        <button class="btn primary" data-go="home">ホームへ</button>
      </div>`;
    match = null;
    bind();
  }

  // ---------- 共通 ----------
  function bind() {
    $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      if (view === 'match' && match && !confirm('試合を終了しますか？（記録されません）')) return;
      match = null;
      go(b.dataset.go, b.dataset.arg);
    });
    $app.querySelectorAll('[data-player]').forEach(b => b.onclick = () => openPlayer(b.dataset.player));
  }

  // あとから追加された推しチームのマスコット（控え）を、自分の選手に入れる
  if (S.data.fav && S.teamById[S.data.fav]) {
    let added = false;
    S.teamById[S.data.fav].players.filter(p => p.mascot).forEach(p => { if (S.own(p.id)) added = true; });
    if (added) { S.lineup(); S.save(); }
  }
  if (S.data.sound === undefined) S.data.sound = 1;
  if (S.data.bgm === undefined) S.data.bgm = 1;
  if (!(S.data.cpuLv >= 1 && S.data.cpuLv <= 10)) S.data.cpuLv = 4;
  Sound.setOn(!!S.data.sound);
  Sound.setBgmOn(!!S.data.bgm);
  loadMyBgm();
  // 試合以外の画面の BGM。起動したらすぐ鳴らす。
  // ブラウザが許可しない場合（ホーム画面に追加していないときなど）は、最初に画面に触れたときに鳴り始める
  Sound.setMenu(true);
  Sound.unlock();
  document.addEventListener('pointerdown', () => Sound.unlock(), true);
  document.addEventListener('keydown', () => Sound.unlock(), true);
  render();
  // 下から出る画面が開いた・閉じたときも履歴をそろえる
  new MutationObserver(() => syncHist()).observe(document.getElementById('dlg'), { attributes: true, attributeFilter: ['class'] });
  syncHist();
  if ('serviceWorker' in navigator && window.isSecureContext) startOffline();
})();
