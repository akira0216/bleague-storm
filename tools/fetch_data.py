"""B.LEAGUE公式サイトから 2026-27 のロスターと個人スタッツを取得し、data/players.js を作る。

使い方:  python tools/fetch_data.py
  - B.PREMIER 全クラブ ＋ B.ONE の横浜エクセレンス（推しチーム）
  - 身長・体重は選手の詳細ページから取る（tools/profile_cache.json に保存し、取得済みはとばす）
  - 顔写真は公式の画像を縮小して photos/{選手ID}.webp に保存する（3Dの顔に貼るため。取得済みはとばす）
  - 能力値（OVR など）はスタッツから計算する。スタッツがない選手はポジションからの推定値
"""
import html
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

YEAR = 2026
BASE = "https://www.bleague.jp"
UA = {"User-Agent": "Mozilla/5.0 (personal fan app data fetch)"}
OUT = Path(__file__).resolve().parent.parent / "data" / "players.js"
RAW = Path(__file__).resolve().parent / "raw.json"
PHOTOS = Path(__file__).resolve().parent.parent / "photos"
PROFILE_CACHE = Path(__file__).resolve().parent / "profile_cache.json"
LOGOS = Path(__file__).resolve().parent.parent / "logos"
FACES = Path(__file__).resolve().parent.parent / "faces"

EXTRA_CLUBS = {"714": 2}  # 横浜エクセレンス（B.ONE タブ）


def get(url, params=None, xhr=False):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = dict(UA)
    if xhr:
        headers["X-Requested-With"] = "XMLHttpRequest"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", errors="replace")
    time.sleep(0.6)  # 公式サイトに負荷をかけないよう間隔をあける
    return body


def text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


# ---------- クラブ一覧 ----------
def club_options(tab):
    h = get(f"{BASE}/roster/", {"year": YEAR, "tab": tab})
    m = re.search(r'<select[^>]*name="club"[^>]*>(.*?)</select>', h, re.S)
    return [(v, text(n)) for v, n in re.findall(r'<option[^>]*value="(\d+)"[^>]*>([^<]*)', m.group(1))]


# ---------- ロスター ----------
CARD = re.compile(
    r'href="https://www\.bleague\.jp/roster_detail/\?PlayerID=(\d+)">.*?'
    r'background-img"\s*src="([^"]*)".*?'
    r'data-src="([^"]*)".*?'
    r'playerInfo-player-name">(.*?)</div>.*?'
    r'ポジション：<span>(.*?)</span>',
    re.S,
)


def roster(club_id, tab):
    players, page = [], 1
    while True:
        params = {"year": YEAR, "club": club_id, "p": "", "c": "", "o": "sort", "e": "在籍中", "tab": tab}
        if page > 1:
            params["pageID"] = page
        h = get(f"{BASE}/roster/", params)
        found = CARD.findall(h)
        for pid, logo, photo, name, posnum in found:
            posnum = text(posnum)
            num = re.search(r"#(\S+)", posnum)
            players.append({
                "id": pid,
                "name": text(name),
                "pos": posnum.split("#")[0].strip(),
                "no": num.group(1) if num else "",
                "photo": photo,
                "logo": logo,
            })
        if len(found) < 50 or f"pageID={page + 1}" not in h:
            break
        page += 1
    return players


# ---------- スタッツ ----------
def stats(tab, target):
    rows, index = {}, 0
    while True:
        params = {"data_format": "json", "year": YEAR, "tab": tab, "target": target,
                  "value": "AveragePoints", "o": "desc", "dt": "avg", "index": index}
        d = json.loads(get(f"{BASE}/stats/", params, xhr=True))
        for tr in d["topics"]:
            pid = re.search(r"PlayerID=(\d+)", tr).group(1)
            tds = [text(t) for t in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            # 0順位 1選手 2クラブ 3G 4GS 5MIN 6MINPG 7PPG 8FGM 9FGA 10FG% 11 2PM 12 2PA 13 2P%
            # 14 3PM 15 3PA 16 3P% 17FTM 18FTA 19FT% 20OR 21DR 22RPG 23APG 24TO 25STL 26BLK 27BLKA 28PF 29PFD 30EFF 31+/-
            def f(i):
                v = tds[i].replace("%", "") if i < len(tds) else ""
                try:
                    return float(v)
                except ValueError:
                    return 0.0
            rows[pid] = {
                "g": int(f(3)), "min": tds[6], "ppg": f(7), "fgp": f(10), "fga": f(9), "p2p": f(13), "p2a": f(12),
                "p3m": f(14), "p3a": f(15), "p3p": f(16), "ftp": f(19), "fta": f(18),
                "orb": f(20), "drb": f(21), "rpg": f(22), "apg": f(23), "tov": f(24),
                "stl": f(25), "blk": f(26), "eff": f(30),
            }
        if not d.get("index") or not d["topics"]:
            break
        index = d["index"]
    return rows


# ---------- 身長・体重 ----------
def load_profiles():
    if PROFILE_CACHE.exists():
        return json.loads(PROFILE_CACHE.read_text(encoding="utf-8"))
    return {}


def profile(pid, cache):
    """選手の詳細ページから (身長cm, 体重kg) を取る"""
    if pid in cache:
        return cache[pid]
    try:
        h = get(f"{BASE}/roster_detail/", {"PlayerID": pid})
        m = re.search(r"(\d{3})cm\s*[／/]\s*(\d{2,3})kg", h)
        cache[pid] = [int(m.group(1)), int(m.group(2))] if m else [0, 0]
    except Exception as e:
        print(f"  profile skip {pid}: {e}", file=sys.stderr)
        return [0, 0]
    PROFILE_CACHE.write_text(json.dumps(cache), encoding="utf-8")
    return cache[pid]


# ---------- 顔写真 ----------
def save_photo(pid, url):
    """縮小した写真と、顔だけの高画質な切りぬきを保存して、アプリから見たパスを返す（取れなければ空文字）"""
    out = PHOTOS / f"{pid}.webp"
    face = FACES / f"{pid}.webp"
    if not out.exists() or not face.exists():
        from PIL import Image  # pip install pillow
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGBA")
            time.sleep(0.2)
        except Exception as e:  # 写真がない選手もいる
            print(f"  photo skip {pid}: {e}", file=sys.stderr)
            return ""
        # 顔（髪の生えぎわ〜あご）を元の大きさのまま切りぬく：3Dの顔に貼る（目やしわが見えるように）
        w, h = im.size
        size = w * 0.44
        box = (int(w * 0.5 - size / 2), int(h * 0.045), int(w * 0.5 + size / 2), int(h * 0.045 + size))
        FACES.mkdir(exist_ok=True)
        im.crop(box).resize((256, 256), Image.LANCZOS).save(face, "WEBP", quality=90)
        im.thumbnail((200, 250))
        PHOTOS.mkdir(exist_ok=True)
        im.save(out, "WEBP", quality=80)
    return f"photos/{pid}.webp"


# ---------- クラブのロゴ（コートのセンターに描くので保存する） ----------
def save_logo(code, url):
    out = LOGOS / f"{code}.png"
    if not out.exists():
        from PIL import Image
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGBA")
            time.sleep(0.2)
        except Exception as e:
            print(f"  logo skip {code}: {e}", file=sys.stderr)
            return ""
        im.thumbnail((256, 256))
        LOGOS.mkdir(exist_ok=True)
        im.save(out, "PNG", optimize=True)
    return f"logos/{code}.png"


# ---------- チームカラー ----------
def logo_color(url):
    """ロゴのいちばん多い「色らしい色」（白・黒・灰色はのぞく）を #rrggbb で返す"""
    import colorsys
    from PIL import Image
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            im = Image.open(io.BytesIO(r.read())).convert("RGBA")
        time.sleep(0.2)
    except Exception:
        return ""
    im.thumbnail((64, 64))
    counts = {}
    for r, g, b, a in im.getdata():
        if a < 200:
            continue
        h, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if sat < 0.35 or l < 0.12 or l > 0.88:
            continue
        key = (r // 24, g // 24, b // 24)
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return ""
    r, g, b = max(counts, key=counts.get)
    return "#%02x%02x%02x" % (r * 24 + 12, g * 24 + 12, b * 24 + 12)


# ---------- 能力値 ----------
def clamp(v, lo=40, hi=99):
    return int(max(lo, min(hi, round(v))))


def minutes(s):
    m = re.match(r"(\d+):(\d+)", s or "")
    return int(m.group(1)) + int(m.group(2)) / 60 if m else 0.0


POS_BASE = {  # スタッツがない選手用（シュート3P, ミドル, 突破, パス, リバウンド, 守備）
    "PG": (58, 56, 60, 64, 45, 56), "SG": (61, 58, 58, 54, 46, 55),
    "SF": (57, 57, 57, 52, 52, 56), "PF": (50, 56, 54, 48, 60, 57), "C": (44, 55, 52, 46, 63, 58),
}


def ratings(p, s):
    pos = p["pos"].split("/")[0] or "SF"
    if not s or s["g"] == 0 or minutes(s["min"]) < 3:
        b = POS_BASE.get(pos, POS_BASE["SF"])
        r = dict(zip(["three", "mid", "drive", "pass", "reb", "def"], b))
    else:
        mpg = max(minutes(s["min"]), 5)
        k = min(30 / mpg, 2.5)  # 30分あたりに換算（出場時間が短い選手は割り引く）
        trust = min(1.0, mpg / 18) * min(1.0, s["g"] / 5)
        def adj(v, base):
            return base + (v - base) * trust
        if s["p3a"] >= 0.8:
            three = 30 + s["p3p"] * 0.8 + min(s["p3m"] * k, 4) * 4
        else:
            three = 38 + s["ftp"] * 0.12  # ほぼ3Pを打たない選手
        p2 = s["p2p"] if s["p2a"] >= 1 else 45
        r = {
            "three": adj(three, POS_BASE.get(pos, POS_BASE["SF"])[0]),
            "mid": adj(28 + p2 * 0.45 + s["ftp"] * 0.1 + min(s["ppg"] * k, 30) * 0.55, 55),
            "drive": adj(42 + min(s["ppg"] * k, 30) * 1.1 + min(s["fta"] * k, 8) * 2.2, 54),
            "pass": adj(42 + min(s["apg"] * k, 9) * 5.5 - s["tov"] * k * 1.5, 52),
            "reb": adj(40 + min(s["rpg"] * k, 13) * 4.2, 52),
            "def": adj(44 + min(s["stl"] * k, 2.5) * 9 + min(s["blk"] * k, 2.5) * 8 + min(s["drb"] * k, 9) * 1.2, 54),
        }
    r = {key: clamp(v) for key, v in r.items()}
    w = {"PG": (1.0, .8, 1.1, 1.4, .5, 1.0), "SG": (1.4, 1.0, 1.0, .8, .5, 1.0),
         "SF": (1.0, 1.0, 1.0, .8, .8, 1.1), "PF": (.7, 1.0, .9, .6, 1.3, 1.2),
         "C": (.4, 1.0, .9, .5, 1.5, 1.3)}.get(pos, (1, 1, 1, 1, 1, 1))
    vals = [r[k] for k in ["three", "mid", "drive", "pass", "reb", "def"]]
    ovr = sum(v * x for v, x in zip(vals, w)) / sum(w)
    if s and s["g"]:
        ovr += min(max(s["eff"], 0), 30) * 0.35 * min(1.0, minutes(s["min"]) / 18)
    r["ovr"] = clamp(ovr + 4, 45, 99)
    return r


def main():
    clubs = [(cid, name, 1, "B.PREMIER") for cid, name in club_options(1)]
    one = dict(club_options(2))
    for cid, tab in EXTRA_CLUBS.items():
        clubs.append((cid, one.get(cid, cid), tab, "B.ONE"))
    print(f"clubs: {len(clubs)}", file=sys.stderr)

    st = {**stats(1, "player-b1"), **stats(2, "player-b2")}
    print(f"stats rows: {len(st)}", file=sys.stderr)

    profiles = load_profiles()
    teams = []
    for cid, name, tab, league in clubs:
        ps = roster(cid, tab)
        logo = ps[0]["logo"] if ps else ""
        code = re.search(r"/m/(\w+)\.png", logo)
        players = []
        for p in ps:
            s = st.get(p["id"])
            ht, wt = profile(p["id"], profiles)
            players.append({
                "id": p["id"], "name": p["name"], "pos": p["pos"], "no": p["no"], "ht": ht, "wt": wt,
                "photo": save_photo(p["id"], p["photo"]), "r": ratings(p, s),
                "face": f"faces/{p['id']}.webp" if (FACES / f"{p['id']}.webp").exists() else "",
                "st": {k: s[k] for k in ("g", "ppg", "rpg", "apg", "p3p", "fgp", "eff")} if s else None,
            })
        players.sort(key=lambda x: -x["r"]["ovr"])
        teams.append({"id": cid, "short": name, "code": code.group(1) if code else cid,
                      "league": league, "logo": (code and save_logo(code.group(1), logo)) or logo,
                      "color": logo_color(logo) if logo else "", "players": players})
        print(f"  {name}: {len(players)}", file=sys.stderr)

    RAW.write_text(json.dumps({"stats": st}, ensure_ascii=False), encoding="utf-8")
    OUT.parent.mkdir(exist_ok=True)
    stamp = time.strftime("%Y-%m-%d")
    OUT.write_text(
        f"// 自動生成: tools/fetch_data.py（{stamp} 取得 / B.LEAGUE 公式サイト）\n"
        f"window.BP_DATA = {json.dumps({'season': '2026-27', 'updated': stamp, 'teams': teams}, ensure_ascii=False)};\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
