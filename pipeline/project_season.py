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

What that cannot see: rookies and anyone else without enough 2025-26 minutes
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
        rotation = rows[:ROTATION_SIZE]
        if len(rotation) < ROTATION_SIZE:
            sys.exit(f"{abbr}: only {len(rotation)} rostered players have 2025-26 skills")
        players = [payload(r) for r in rotation]
        load_sum = sum(p["load"] for p in players) or 1.0
        talent = sum(p["load"] * p["raw"]["epm"] for p in players) / load_sum
        teams.append({
            "abbr": abbr, "name": name,
            "talent": num(talent, 3),
            "wins": 0, "losses": 0,
            "colors": [c1, c2],
            "players": players,
            "unscored": unscored,
        })
        print(f"  {abbr}: rotation {', '.join(p['name'].split()[-1] for p in players)}"
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
