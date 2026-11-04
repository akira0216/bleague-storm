// 横浜エクセレンスのマスコット「ピック＆ロール」を、控えの選手として追加する
// （tools/fetch_data.py で選手データを取り直しても消えないように、別のファイルにしている）
// プロフィール：横浜エクセレンスの発表資料（PR TIMES）より。能力値はプロフィールから決めた、このアプリ独自のもの
(() => {
  const t = window.BP_DATA && window.BP_DATA.teams.find(x => x.id === '714');
  if (!t || t.players.some(p => p.mascot)) return;
  t.players.push(
    {
      id: 'm45', name: 'ピック', pos: 'PG', no: '45', ht: 170, wt: 100, mascot: 'pick',
      photo: "photos/m45.webp", face: null, st: null,
      note: 'マスコット。ボケて場をもり上げる、ちょっとドジな人気者。バスケとダンスはキレキレ。ロットネスト島出身。',
      r: { three: 55, mid: 62, drive: 82, pass: 80, reb: 48, def: 58, ovr: 66 },
    },
    {
      id: 'm80', name: 'ロール', pos: 'SF', no: '80', ht: 190, wt: 60, mascot: 'roll',
      photo: "photos/m80.webp", face: null, st: null,
      note: 'マスコット。ピックのボケにすばやくツッコむ。頭の回転が速く、運動神経ばつぐんでシュートが得意。ロットネスト島出身。',
      r: { three: 84, mid: 78, drive: 72, pass: 62, reb: 55, def: 63, ovr: 72 },
    },
  );
})();
