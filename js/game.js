// 試合の自動シミュレーション（CPUどうしの試合と、試合の記録の入れもの）
window.Game = (() => {
  const rand = Math.random;
  const pick = (arr, wfn) => {
    const ws = arr.map(wfn);
    let x = rand() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < arr.length; i++) { x -= ws[i]; if (x <= 0) return i; }
    return arr.length - 1;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- 試合の状態 ----------
  // side: { team, players: [{pid,name,no,photo,pos,r}], tactic }
  function create(home, away, quarterMin) {
    const box = side => Object.fromEntries(side.players.map(p => [p.pid,
      { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0 }]));
    return {
      sides: [home, away], score: [0, 0], q: 1, qLen: quarterMin * 60, clock: quarterMin * 60,
      poss: rand() < .5 ? 0 : 1, box: [box(home), box(away)], over: false, qScores: [[0, 0]],
    };
  }

  const aceIdx = side => side.players.reduce((b, p, i, a) => (p.r.ovr > a[b].r.ovr ? i : b), 0);

  // オート（CPU）の作戦えらび
  function aiPlan(st, off) {
    const side = st.sides[off];
    const def = st.sides[1 - off];
    const shooter = pick(side.players, p => Math.pow(p.r.ovr, 4) * (p.r.three + p.r.mid + p.r.drive));
    if (rand() < .2) return { mode: 'pass', shooter };
    const r = side.players[shooter].r;
    const zone = def.tactic === 'zone';
    const opts = ['three', 'mid', 'drive'];
    const score = { three: r.three + (zone ? 6 : 0), mid: r.mid, drive: r.drive - (zone ? 8 : 0) };
    const mode = opts[pick(opts, k => Math.pow(Math.max(score[k] - 35, 1), 2.2))];
    return { mode, shooter };
  }

  // ---------- 1回の攻撃 ----------
  // 返り値はアニメーション用のイベント列
  function play(st, plan, cpuBoost = [0, 0]) {
    const off = st.poss;
    const dfn = 1 - off;
    const O = st.sides[off];
    const D = st.sides[dfn];
    const boxO = st.box[off];
    const boxD = st.box[dfn];
    const ev = [];
    const boost = cpuBoost[off] - cpuBoost[dfn];
    const tac = D.tactic;
    let time = 9 + rand() * 12;
    let holder = 0;
    let shooter = plan.shooter;
    let mode = plan.mode;
    let bonus = boost * 0.004;

    if (mode === 'pass') {
      // ボールを回して、いちばん空いた選手に打たせる
      time += 5;
      const n = 2 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const to = pick(O.players, (p, j) => (j === holder ? 0 : 1));
        ev.push({ t: 'pass', from: holder, to });
        holder = to;
      }
      shooter = pick(O.players, p => Math.pow(p.r.ovr, 3));
      const r = O.players[shooter].r;
      mode = r.three >= r.mid && r.three >= r.drive ? 'three' : (r.drive > r.mid ? 'drive' : 'mid');
      bonus += 0.06 + (avg(O.players, 'pass') - 55) * 0.0015;
    }

    const s = O.players[shooter];
    const d = D.players[shooter];
    const passer = holder !== shooter ? holder : null;

    // ターンオーバー
    let tov = 0.07 + (d.r.def - s.r.pass) * 0.0008 - boost * 0.002 + (plan.mode === 'pass' ? 0.03 : 0);
    if (tac === 'press') tov += 0.06;
    if (rand() < clamp(tov, 0.03, 0.25)) {
      if (holder !== shooter) ev.push({ t: 'pass', from: holder, to: shooter });
      const stealer = pick(D.players, p => Math.pow(p.r.def, 3));
      const isSteal = rand() < 0.65;
      if (isSteal) boxD[D.players[stealer].pid].stl++;
      ev.push({ t: 'tov', who: shooter, stealer: isSteal ? stealer : null });
      return finish(st, ev, time);
    }

    if (holder !== shooter) ev.push({ t: 'pass', from: holder, to: shooter });
    return shoot(st, ev, time, shooter, mode, bonus, passer, 0);
  }

  function shoot(st, ev, time, shooter, mode, bonus, passer, chain) {
    const off = st.poss;
    const O = st.sides[off];
    const D = st.sides[1 - off];
    const s = O.players[shooter];
    const p = chance(st, off, shooter, mode, bonus);
    const foul = mode === 'drive' ? 0.10 + s.r.drive * 0.001 : 0;

    const bs = st.box[off][s.pid];
    ev.push({ t: 'move', who: shooter, spot: mode });

    // シュートファウル
    if (rand() < foul) {
      const ft = 0.6 + s.r.mid * 0.002;
      const made = (rand() < ft) + (rand() < ft);
      bs.pts += made;
      st.score[off] += made;
      ev.push({ t: 'ft', who: shooter, made });
      return finish(st, ev, time);
    }

    bs.fga++;
    if (mode === 'three') bs.p3a++;
    if (rand() < p) {
      const pts = mode === 'three' ? 3 : 2;
      bs.fgm++;
      if (pts === 3) bs.p3m++;
      bs.pts += pts;
      st.score[off] += pts;
      let ast = null;
      if (passer !== null && rand() < .8) ast = passer;
      else if (rand() < .45) ast = pick(O.players, (q, j) => (j === shooter ? 0 : q.r.pass ** 2));
      if (ast !== null) st.box[off][O.players[ast].pid].ast++;
      ev.push({ t: 'shot', who: shooter, mode, made: true, pts, ast });
      return finish(st, ev, time);
    }

    let blocker = null;
    if (mode !== 'three' && rand() < 0.14) {
      blocker = pick(D.players, q => (q.r.def + q.r.reb) ** 3);
      st.box[1 - off][D.players[blocker].pid].blk++;
    }
    ev.push({ t: 'shot', who: shooter, mode, made: false, blocker });

    // リバウンド
    const orb = clamp(0.24 + (avg(O.players, 'reb') - avg(D.players, 'reb')) * 0.006, 0.12, 0.4);
    if (chain < 2 && rand() < orb) {
      const who = pick(O.players, q => q.r.reb ** 3);
      st.box[off][O.players[who].pid].reb++;
      ev.push({ t: 'reb', side: off, who });
      return shoot(st, ev, time + 4, who, 'mid', 0.05, null, chain + 1);
    }
    const who = pick(D.players, q => q.r.reb ** 3);
    st.box[1 - off][D.players[who].pid].reb++;
    ev.push({ t: 'reb', side: 1 - off, who });
    return finish(st, ev, time);
  }

  // シュートが入る確率
  function chance(st, off, shooter, mode, bonus = 0) {
    const O = st.sides[off];
    const D = st.sides[1 - off];
    const s = O.players[shooter];
    const d = D.players[shooter];
    const tac = D.tactic;
    let p;
    if (mode === 'three') p = 0.05 + s.r.three * 0.0043 - (d.r.def - 60) * 0.0022 + (tac === 'zone' ? 0.04 : 0);
    else if (mode === 'mid') p = 0.13 + s.r.mid * 0.0052 - (d.r.def - 60) * 0.003;
    else p = 0.12 + s.r.drive * 0.0056 - (d.r.def - 60) * 0.0034 - (tac === 'zone' ? 0.07 : 0);
    if (tac === 'press') p += 0.04;
    if (tac === 'ace') p += aceIdx(O) === shooter ? -0.11 : 0.035;
    return clamp(p + bonus, 0.12, 0.78);
  }

  function avg(ps, k) { return ps.reduce((a, p) => a + p.r[k], 0) / ps.length; }

  function finish(st, ev, time) {
    st.clock = Math.max(0, st.clock - time);
    st.poss = 1 - st.poss;
    st.qScores[st.q - 1] = [...st.score];
    if (st.clock <= 0) {
      if (st.q >= 4 && st.score[0] !== st.score[1]) st.over = true;
      else {
        st.q++;
        st.clock = st.q > 4 ? 120 : st.qLen; // 同点なら2分の延長
        st.qScores.push([...st.score]);
        ev.push({ t: 'quarter', q: st.q });
      }
    }
    return ev;
  }

  // アニメーションなしで最後まで進める（他チームどうしの試合など）
  function simulate(st, cpuBoost) {
    let guard = 0;
    while (!st.over && guard++ < 2000) play(st, aiPlan(st, st.poss), cpuBoost);
    return st;
  }

  return { create, simulate };
})();
