"""2026-27 rosters, scored on 2025-26 play  ->  public/league-2026-27.json

    python pipeline/project_season.py            fetch rosters (cached) and build
    python pipeline/project_season.py --refetch  fetch rosters again

A projection, and a plain one, so it can be stated in a sentence: every player
keeps his 2025-26 skills, usage and minutes per game, and plays them on the team
that rosters him for 2026-27. Each team's rotation is its eight rostered players
with the most 2025-26 minutes per game.

Injury-shortened seasons: a player with 250-499 minutes in 2025-26 is scored
too if he played 1,000+ minutes in 2024-25 — an established player whose last
season was cut short (Trae Young's 382 minutes, say), as opposed to a late-season
call-up with big minutes in a handful of games. 2024-25 only decides who is
eligible; his skills still come from 2025-26 alone, shrunk hard toward average
by the small sample, and he is flagged `smallSample` so the app can say so.

Lottery rookies (picks 1-14) have no NBA data, so they are not scored - but a
No. 1 pick is not a footnote either. Each one competes for a rotation seat on
the role a pick in his range typically plays as a rookie (median minutes per
game and usage for picks 1-3, 4-7 and 8-14 over the last three draft classes),
and if he wins a seat he takes it as a ghost: drawn on the board, sized by that
role, counted in no score. The board shows the missing piece instead of hiding
it.

What that cannot see: other rookies and anyone without enough 2025-26 minutes
have no skills to score, so they are listed per team rather than guessed at;
roles change with a new team (a sixth man who becomes a starter keeps his old
minutes here); and there are no records, lineups or shared minutes yet.

Rosters come from Basketball-Reference's 2027 team pages. Skills come from
build_data.prepare(), so percentiles are exactly the app's 2025-26 ones.
"""
import io
import json
import pathlib
import sys
import time
from datetime import date

import pandas as pd
import requests

from build_data import (OUT as CURRENT, POOL_MIN_MINUTES, ROTATION_SIZE, SHRINK_PRIOR,
                        norm_name, num, player_payload, prepare)
from teams import TEAMS

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
ROSTERS = DATA / "rosters_2026_27.csv"
OUT = ROOT / "public" / "league-2026-27.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
# Basketball-Reference allows about 20 requests a minute
PAUSE_S = 3.5
MIN_ROSTER = 12
# injury-shortened seasons: see the module docstring
SMALL_SAMPLE_MIN = 250
ESTABLISHED_MIN = 1000
PRIOR_SEASON = DATA / "seasons" / "2024-25" / "players.csv"
DRAFTS = DATA / "drafts.csv"
DRAFT_YEAR = 2026
# past classes and the season each spent as rookies, for sizing a rookie's role
ROOKIE_SEASONS = {2023: "2023-24", 2024: "2024-25", 2025: "2025-26"}
LOTTERY = 14
BUCKETS = [(1, 3), (4, 7), (8, 14)]
MIN_ROOKIE_GAMES = 20


def fetch_drafts(refetch):
    """Picks for DRAFT_YEAR and the past classes used to size rookie roles."""
    if DRAFTS.exists() and not refetch:
        return pd.read_csv(DRAFTS)
    rows = []
    years = sorted(set(ROOKIE_SEASONS) | {DRAFT_YEAR})
    for i, year in enumerate(years):
        url = f"https://www.basketball-reference.com/draft/NBA_{year}.html"
        html = requests.get(url, headers=UA, timeout=60).content.decode("utf-8")
        t = pd.read_html(io.StringIO(html), attrs={"id": "stats"})[0]
        t.columns = [c[-1] if isinstance(c, tuple) else c for c in t.columns]
        t = t[pd.to_numeric(t["Pk"], errors="coerce").notna()]
        if len(t) < 50:
            sys.exit(f"drafts: {year} lists only {len(t)} picks")
        for pk, name in zip(t["Pk"], t["Player"]):
            rows.append({"year": year, "pick": int(pk), "name": str(name)})
        print(f"  draft {year}: {len(t)} picks")
        if i < len(years) - 1:
            time.sleep(PAUSE_S)
    df = pd.DataFrame(rows)
    df.to_csv(DRAFTS, index=False)
    return df


def rookie_roles(drafts):
    """Median rookie-year minutes per game and usage for each lottery bucket,
    from past classes' rookie seasons (pbpstats player totals, the same usage
    formula as everywhere else). Rookies under MIN_ROOKIE_GAMES are left out, so
    an injured pick does not drag the typical role down."""
    samples = []
    for year, season in ROOKIE_SEASONS.items():
        path = DATA / "seasons" / season / "players.csv"
        if not path.exists():
            print(f"note: {path.relative_to(ROOT)} missing; {year} class not used for rookie roles")
            continue
        p = pd.read_csv(path).fillna(0)
        p["MIN"] = p["seconds"] / 60.0
        p["FGA"] = p["FG2A"] + p["FG3A"]
        t = p.groupby("team")[["FGA", "FTA", "TOV", "MIN"]].sum()
        rate = ((t["FGA"] + 0.44 * t["FTA"] + t["TOV"]) / t["MIN"]).to_dict()
        events = (p["FGA"] + 0.44 * p["FTA"] + p["TOV"]) / p["MIN"].where(p["MIN"] > 0)
        p["usg"] = 100.0 * events / (5.0 * p["team"].map(rate))
        p["key"] = p["name"].map(norm_name)
        per = p.sort_values("MIN", ascending=False).groupby("key").agg(
            MIN=("MIN", "sum"), G=("G", "sum"), usg=("usg", "first"))
        picks = drafts[(drafts["year"] == year) & (drafts["pick"] <= LOTTERY)]
        for pk, name in zip(picks["pick"], picks["name"]):
            k = norm_name(name)
            if k in per.index and per.loc[k, "G"] >= MIN_ROOKIE_GAMES:
                samples.append({"pick": pk, "mpg": per.loc[k, "MIN"] / per.loc[k, "G"],
                                "usg": per.loc[k, "usg"]})
    df = pd.DataFrame(samples)
    roles = {}
    for lo, hi in BUCKETS:
        b = df[(df["pick"] >= lo) & (df["pick"] <= hi)]
        if len(b) == 0:
            sys.exit(f"rookie roles: no rookies in picks {lo}-{hi} to size from")
        roles[(lo, hi)] = {"mpg": float(b["mpg"].median()), "usg": float(b["usg"].median()), "n": len(b)}
        print(f"  rookie role, picks {lo}-{hi}: {roles[(lo, hi)]['mpg']:.1f} mpg, "
              f"{roles[(lo, hi)]['usg']:.1f} usage (median of {len(b)} rookies)")
    return roles


def role_for(pick, roles):
    return next(((lo, hi), r) for (lo, hi), r in roles.items() if lo <= pick <= hi)


def established_last_year():
    """Name keys of players with ESTABLISHED_MIN+ minutes in 2024-25, from the
    lineup pipeline's player totals; empty (with a warning) if not fetched."""
    if not PRIOR_SEASON.exists():
        print(f"note: {PRIOR_SEASON.relative_to(ROOT)} missing, so no injury-shortened "
              "players are scored (python pipeline/season.py 2024-25)")
        return set()
    p = pd.read_csv(PRIOR_SEASON)
    minutes = (p.assign(key=p["name"].map(norm_name)).groupby("key")["seconds"].sum() / 60.0)
    return set(minutes[minutes >= ESTABLISHED_MIN].index)


def fetch_rosters(refetch):
    if ROSTERS.exists() and not refetch:
        print(f"rosters: cached ({ROSTERS.name}); --refetch to update")
        return pd.read_csv(ROSTERS)
    rows = []
    for i, (abbr, (_name, bbref, _c1, _c2)) in enumerate(TEAMS.items()):
        url = f"https://www.basketball-reference.com/teams/{bbref}/2027.html"
        html = requests.get(url, headers=UA, timeout=60).content.decode("utf-8")
        tables = pd.read_html(io.StringIO(html), attrs={"id": "roster"}) if 'id="roster"' in html else []
        if not tables or "Player" not in tables[0].columns:
            sys.exit(f"rosters: {abbr} has no roster table at {url}")
        players = tables[0]["Player"].dropna().astype(str)
        if len(players) < MIN_ROSTER:
            sys.exit(f"rosters: {abbr} lists only {len(players)} players")
        for name in players:
            two_way = "(TW)" in name
            rows.append({"team": abbr, "name": name.replace("(TW)", "").strip(), "two_way": two_way})
        print(f"  {abbr}: {len(players)} players")
        if i < len(TEAMS) - 1:
            time.sleep(PAUSE_S)
    df = pd.DataFrame(rows)
    df.to_csv(ROSTERS, index=False)
    print(f"rosters: {len(df)} players on 30 teams -> {ROSTERS.name}")
    return df


def main():
    rosters = fetch_rosters("--refetch" in sys.argv)
    rosters["key"] = rosters["name"].map(norm_name)
    drafts = fetch_drafts("--refetch" in sys.argv)
    roles = rookie_roles(drafts)
    this_year = drafts[(drafts["year"] == DRAFT_YEAR) & (drafts["pick"] <= LOTTERY)]
    lottery = {norm_name(n): int(pk) for n, pk in zip(this_year["name"], this_year["pick"])}

    stints, season, sk, reg = prepare()
    pool_keys = set(season.loc[season["MIN"] >= POOL_MIN_MINUTES, "key"])
    shortened = season[(season["MIN"] >= SMALL_SAMPLE_MIN) & (season["MIN"] < POOL_MIN_MINUTES)]
    small_sample = set(shortened["key"]) & established_last_year() & set(rosters["key"])
    scoreable = pool_keys | small_sample
    if small_sample:
        print("injury-shortened, scored on a small sample: "
              + ", ".join(sorted(season.set_index("key").loc[list(small_sample), "PLAYER"])))

    # A scored player on two rosters would be drawn twice; that must stop the
    # build. An unscored name on two rosters (a camp invite, or two people who
    # share a name) is never drawn, so it only warns.
    dupes = rosters[rosters.duplicated("key", keep=False)]
    scored_dupes = sorted(set(dupes.loc[dupes["key"].isin(pool_keys | set(season.loc[season["MIN"] >= SMALL_SAMPLE_MIN, "key"])), "name"]))
    if scored_dupes:
        sys.exit("rosters: scored players listed on two teams: " + ", ".join(scored_dupes))
    if len(dupes):
        print("rosters: note, unscored names on two teams: " + ", ".join(sorted(set(dupes["name"]))))
    # A player's 2025-26 line: his largest stint for usage, the whole season for
    # minutes per game (a traded player's two stints are one role, played twice)
    primary = stints.sort_values("MIN", ascending=False).drop_duplicates("key").set_index("key")
    whole = season.set_index("key")
    team_of = dict(zip(rosters["key"], rosters["team"]))
    current = json.loads(CURRENT.read_text(encoding="utf-8"))

    def payload(row):
        p = player_payload(row, sk.loc[row["key"]])
        if row["key"] in small_sample:
            p["smallSample"] = True
        return p

    def projected(key, team):
        row = primary.loc[key].copy()
        row["key"] = key  # the index, which .loc drops from the row
        row["TEAM"] = team
        row["mpg"] = whole.loc[key, "MIN"] / whole.loc[key, "G"]
        row["load"] = row["usg"] * row["mpg"] / 48.0
        return row

    teams = []
    for abbr in TEAMS:
        name, _bbref, c1, c2 = TEAMS[abbr]
        roster = rosters[rosters["team"] == abbr]
        scored = [k for k in roster["key"] if k in scoreable]
        # standard contracts first (draft picks, signings), two-way deals after
        missing = roster[~roster["key"].isin(scoreable)].sort_values("two_way", kind="stable")
        unscored = [n + (" (two-way)" if tw else "") for n, tw in zip(missing["name"], missing["two_way"])]
        rows = sorted((projected(k, abbr) for k in scored), key=lambda r: -r["mpg"])
        # lottery rookies on this roster, on the typical role for their pick
        rookies = []
        for _, r in roster[roster["key"].isin(lottery)].iterrows():
            (lo, hi), role = role_for(lottery[r["key"]], roles)
            rookies.append({"name": r["name"], "key": r["key"], "pick": lottery[r["key"]],
                            "mpg": round(role["mpg"], 1), "usg": round(role["usg"], 2),
                            "load": round(role["usg"] * role["mpg"] / 48.0, 4),
                            "range": f"{lo}-{hi}"})
        # everyone competes for the eight seats on minutes per game
        seats = sorted([("player", r) for r in rows] + [("rookie", g) for g in rookies],
                       key=lambda x: -x[1]["mpg"])[:ROTATION_SIZE]
        rotation = [r for kind, r in seats if kind == "player"]
        ghosts = [g for kind, g in seats if kind == "rookie"]
        if len(rotation) + len(ghosts) < ROTATION_SIZE:
            sys.exit(f"{abbr}: only {len(rotation)} rostered players have 2025-26 skills")
        players = [payload(r) for r in rotation]
        on_board = {g["key"] for g in ghosts}
        unscored = [n for n in unscored if norm_name(n.replace(" (two-way)", "")) not in on_board]
        load_sum = sum(p["load"] for p in players) or 1.0
        talent = sum(p["load"] * p["raw"]["epm"] for p in players) / load_sum
        teams.append({
            "abbr": abbr, "name": name,
            "talent": num(talent, 3),
            "wins": 0, "losses": 0,
            "colors": [c1, c2],
            "players": players,
            "ghosts": [{k: g[k] for k in ("name", "pick", "mpg", "usg", "load", "range")}
                       for g in ghosts],
            "unscored": unscored,
        })
        print(f"  {abbr}: rotation {', '.join(p['name'].split()[-1] for p in players)}"
              + (f"  | ghosts: {', '.join(g['name'] for g in ghosts)}" if ghosts else "")
              + (f"  | not scored: {len(unscored)}" if unscored else ""))

    # swap candidates: every pool player, on his 2026-27 team, or FA if unsigned
    league = [payload(projected(k, team_of.get(k, "FA"))) for k in scoreable]
    league.sort(key=lambda p: -p["min"])

    payload = {
        "season": "2026-27",
        "projected": True,
        "basedOn": "2025-26",
        "generated": date.today().isoformat(),
        "rotationSize": ROTATION_SIZE,
        "pool": {"minMinutes": POOL_MIN_MINUTES, "size": len(pool_keys), "shrinkPrior": SHRINK_PRIOR},
        "defenseRegression": current["defenseRegression"],
        "sources": {
            **current["sources"],
            "rosters": f"Basketball-Reference 2026-27 rosters (fetched {date.fromtimestamp(ROSTERS.stat().st_mtime).isoformat()})",
        },
        "teams": teams,
        "league": league,
    }
    for k in ("records", "lineups"):
        payload["sources"].pop(k, None)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
