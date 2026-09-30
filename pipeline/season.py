"""One season's lineup validation data -> data/seasons/<season>.<rating>.json

    python pipeline/season.py 2024-25                 BPM, fetch (cached) and build
    python pipeline/season.py 2025-26 --rating epm    EPM instead
    python pipeline/season.py 2024-25 --refetch       fetch again

The lineup test needs, for any season: every player's skill percentiles, usage
and EPM, and every five-man lineup's possessions and points. The app's own
bundle only covers 2025-26, from game logs; this builds any season from one
source so that seasons are directly comparable, including 2025-26 itself, which
doubles as the check that this route reproduces the app's percentiles.

Sources, cached under data/seasons/<season>/:
  players.csv  pbpstats.com player totals, per team (30 requests)
  lineups.csv  pbpstats.com five-man lineup totals, per team (30 requests)
  bpm.csv      Basketball-Reference Box Plus-Minus (OBPM, DBPM, BPM)
  epm.csv      Dunks & Threes EPM, end-of-season snapshot

The player rating does two jobs: the talent control (sum of five) and the
defensive input to the perimeter-D skill. The app uses EPM, but Dunks & Threes
only publishes the current season free — past seasons are paywalled — so the
cross-season test runs on BPM, which Basketball-Reference publishes for every
season. BPM is box-score based and weaker on defense, so 2025-26 is built both
ways and the test reports how much the metric alone moves the answer.

pbpstats rather than stats.nba.com, which blocks scripted clients. Lineups and
players both carry pbpstats player ids, so they join exactly; names are only
used to attach EPM. Skills come from build_data.build_skills unchanged, so the
percentile method is the app's, not a re-implementation of it.
"""
import io
import json
import pathlib
import sys
import time

import numpy as np
import pandas as pd
import requests

from build_data import POOL_MIN_MINUTES, build_skills, norm_name
from fetch_sources import parse_epm

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEASONS = ROOT / "data" / "seasons"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
API = "https://api.pbpstats.com"
PAUSE_S = 2.0
# a team's lineups should account for nearly all of its 82 x 48 minutes
MIN_COVERAGE = 0.85
# Same player, different name on the rating site (after norm_name). The build
# stops and names anyone unmatched, so an entry here is only ever added on
# evidence.
ALIASES = {
    "ronholland": "ronaldholland",  # Basketball-Reference: "Ron Holland"
}


def get_json(path, **params):
    for attempt in range(3):
        try:
            r = requests.get(f"{API}{path}", params=params, headers=UA, timeout=90)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 2:
                sys.exit(f"{path} failed after 3 tries: {e}")
            time.sleep(5 * (attempt + 1))


# --------------------------------------------------------------------------- #
# fetch
# --------------------------------------------------------------------------- #
def fetch_per_team(season, kind, fields, check):
    teams = get_json("/get-teams/nba")["teams"]
    if len(teams) != 30:
        sys.exit(f"{kind}: expected 30 teams, got {len(teams)}")
    frames = []
    for i, team in enumerate(sorted(teams, key=lambda t: t["text"])):
        rows = get_json("/get-totals/nba", Season=season, SeasonType="Regular Season",
                        Type=kind, TeamId=team["id"])["multi_row_table_data"]
        if not rows:
            sys.exit(f"{kind}: {season} {team['text']} returned nothing")
        # pbpstats omits a stat entirely when it is zero, so absent means 0
        df = pd.DataFrame(rows).reindex(columns=list(fields)).rename(columns=fields)
        df.insert(0, "team", team["text"])
        check(team["text"], df)
        frames.append(df)
        if i < len(teams) - 1:
            time.sleep(PAUSE_S)
    return pd.concat(frames, ignore_index=True)


PLAYER_FIELDS = {
    "EntityId": "pid", "Name": "name", "GamesPlayed": "G", "SecondsPlayed": "seconds",
    "FG2A": "FG2A", "FG2M": "FG2M", "FG3A": "FG3A", "FG3M": "FG3M", "FTA": "FTA",
    "Turnovers": "TOV", "Rebounds": "REB", "Assists": "AST", "Steals": "STL",
    "Blocks": "BLK", "Points": "PTS",
}
LINEUP_FIELDS = {
    "EntityId": "lineup_id", "SecondsPlayed": "seconds", "OffPoss": "off_poss",
    "DefPoss": "def_poss", "Points": "points", "OpponentPoints": "opp_points",
}


def check_players(team, df):
    if df["pid"].isna().any() or df["seconds"].isna().all():
        sys.exit(f"players: {team} response changed shape")


def check_lineups(team, df):
    coverage = df["seconds"].fillna(0).sum() / (82 * 48 * 60)
    print(f"  {team}: {len(df)} lineups, {coverage:.0%} of team minutes")
    if coverage < MIN_COVERAGE:
        sys.exit(f"lineups: {team} covers only {coverage:.0%} of its minutes")


def fetch(season, folder, refetch):
    folder.mkdir(parents=True, exist_ok=True)
    players, lineups = folder / "players.csv", folder / "lineups.csv"

    if refetch or not players.exists():
        print(f"{season}: fetching player totals")
        fetch_per_team(season, "Player", PLAYER_FIELDS, check_players).to_csv(players, index=False)
    if refetch or not lineups.exists():
        print(f"{season}: fetching lineups")
        fetch_per_team(season, "Lineup", LINEUP_FIELDS, check_lineups).to_csv(lineups, index=False)
    return pd.read_csv(players), pd.read_csv(lineups)


def fetch_rating(season, folder, rating, refetch):
    """A frame with player_name, oepm, depm, epm — whichever metric fills them."""
    out = folder / f"{rating}.csv"
    if out.exists() and not refetch:
        return pd.read_csv(out)
    # both sites label a season by the year it ends: 2024-25 is 2025
    end_year = int(season[:4]) + 1
    if rating == "epm":
        html = requests.get(f"https://dunksandthrees.com/epm?season={end_year}",
                            headers=UA, timeout=60).text
        df, snapshot = parse_epm(html)
        locked = (df["player_name"] == "Locked Player").mean()
        if locked > 0.5:
            sys.exit(f"{season}: Dunks & Threes shows {locked:.0%} of players as 'Locked Player' — "
                     "past seasons are paywalled. Use --rating bpm.")
        print(f"{season}: EPM, {len(df)} players, snapshot {snapshot}")
    else:
        url = f"https://www.basketball-reference.com/leagues/NBA_{end_year}_advanced.html"
        # the page is UTF-8 but does not say so; left to guess, requests reads
        # it as Latin-1 and every accented name (Doncic, Jokic, Sengun) breaks
        html = requests.get(url, headers=UA, timeout=60).content.decode("utf-8")
        tables = pd.read_html(io.StringIO(html), attrs={"id": "advanced"})
        if not tables or not {"Player", "OBPM", "DBPM", "BPM", "MP"} <= set(tables[0].columns):
            sys.exit(f"{season}: Basketball-Reference advanced table changed shape")
        t = tables[0]
        t = t[t["Player"].notna() & (t["Player"] != "League Average") & (t["Player"] != "Player")]
        # a traded player's combined 2TM/3TM row comes first: that is his season
        t = t.drop_duplicates("Player", keep="first")
        df = pd.DataFrame({
            "player_name": t["Player"].str.replace("*", "", regex=False),
            "oepm": pd.to_numeric(t["OBPM"], errors="coerce"),
            "depm": pd.to_numeric(t["DBPM"], errors="coerce"),
            "epm": pd.to_numeric(t["BPM"], errors="coerce"),
        })
        print(f"{season}: BPM, {len(df)} players")
    df.to_csv(out, index=False)
    return df


# --------------------------------------------------------------------------- #
# build
# --------------------------------------------------------------------------- #
def build(season, rating, players, lineups, epm):
    p = players.copy()
    num_cols = [c for c in PLAYER_FIELDS.values() if c not in ("pid", "name")]
    p[num_cols] = p[num_cols].fillna(0)
    p["pid"] = p["pid"].astype(str)
    p["key"] = p["name"].map(norm_name)
    p["MIN"] = p["seconds"] / 60.0
    p["FGA"] = p["FG2A"] + p["FG3A"]
    p["FGM"] = p["FG2M"] + p["FG3M"]
    p["PLAYER"] = p["name"]
    p["TEAM"] = p["team"]

    # usage per stint, against that team's own event rate (build_data.usage)
    t = p.groupby("TEAM")[["FGA", "FTA", "TOV", "MIN"]].sum()
    rate = ((t["FGA"] + 0.44 * t["FTA"] + t["TOV"]) / t["MIN"]).to_dict()
    events = (p["FGA"] + 0.44 * p["FTA"] + p["TOV"]) / p["MIN"].replace(0, np.nan)
    p["usg"] = (100.0 * events / (5.0 * p["TEAM"].map(rate))).fillna(0.0)
    p["mpg"] = p["MIN"] / p["G"].replace(0, np.nan)

    box = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "FGM", "FGA", "FG3M", "FG3A", "FTA"]
    whole = p.groupby(["pid", "key", "PLAYER"], as_index=False)[box + ["G"]].sum()

    e = epm.copy()
    e["key"] = e["player_name"].map(norm_name).replace(ALIASES)
    e = e.drop_duplicates("key").set_index("key")
    # build_skills keys its defensive lookup by name key; ids stay the join for lineups
    skills, reg = build_skills(whole, e["depm"].to_dict())
    for col in ("epm", "oepm", "depm"):
        skills[col] = skills["key"].map(e[col].to_dict())
    pool = skills[skills["MIN"] >= POOL_MIN_MINUTES].copy()
    no_epm = pool[pool["epm"].isna()]
    if len(no_epm):
        sys.exit(f"{season}: {rating.upper()} missing for pool players: {', '.join(no_epm['PLAYER'])}")

    stints = {f"{r.pid}|{r.TEAM}": {"usg": round(float(r.usg), 2), "mpg": round(float(r.mpg), 1)}
              for r in p.itertuples() if r.pid in set(pool["pid"])}

    lu = lineups.copy()
    for c in ("seconds", "off_poss", "def_poss", "points", "opp_points"):
        lu[c] = lu[c].fillna(0)
    lu["pids"] = lu["lineup_id"].astype(str).str.split("-")
    bad = lu[lu["pids"].map(len) != 5]
    if len(bad):
        sys.exit(f"{season}: {len(bad)} lineup ids do not split into five players")
    lu["poss"] = (lu["off_poss"] + lu["def_poss"]) / 2
    pool_ids = set(pool["pid"])
    keep = lu["pids"].map(lambda ids: all(i in pool_ids for i in ids))
    kept = lu[keep]
    print(f"{season}: pool {len(pool)} players; {keep.sum():,} of {len(lu):,} lineups scoreable, "
          f"{kept['poss'].sum() / lu['poss'].sum():.0%} of possessions")

    payload = {
        "season": season,
        "rating": rating,
        "sources": {"box": "pbpstats.com player totals", "lineups": "pbpstats.com lineup totals",
                    "rating": {"epm": "Dunks & Threes EPM, end of season",
                               "bpm": "Basketball-Reference Box Plus-Minus"}[rating]},
        "defenseRegression": {"a": round(reg["interceptA"], 4), "b": round(reg["slopeB"], 4)},
        "players": {
            r.pid: {
                "key": r.key, "name": r.PLAYER, "min": round(float(r.MIN)),
                "pct": {k: round(float(getattr(r, k + "Pct")), 1)
                        for k in ("shooting", "interior", "playmaking", "perimeterD")},
                # the rating, whichever metric it is: overall, offense, defense
                "rating": round(float(r.epm), 2),
                "oRating": round(float(r.oepm), 2),
                "dRating": round(float(r.depm), 2),
            }
            for r in pool.itertuples()
        },
        "stints": stints,
        "lineups": [
            {"team": r.team, "pids": r.pids, "offPoss": int(r.off_poss), "defPoss": int(r.def_poss),
             "points": int(r.points), "oppPoints": int(r.opp_points)}
            for r in kept.itertuples()
        ],
    }
    out = SEASONS / f"{season}.{rating}.json"
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"{season}: wrote {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)")


def main():
    argv = sys.argv[1:]
    rating = "bpm"
    if "--rating" in argv:
        i = argv.index("--rating")
        rating = argv[i + 1] if i + 1 < len(argv) else ""
        del argv[i:i + 2]
    refetch = "--refetch" in argv
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1 or len(args[0]) != 7 or args[0][4] != "-" or rating not in ("bpm", "epm"):
        sys.exit("usage: python pipeline/season.py 2024-25 [--rating bpm|epm] [--refetch]")
    season = args[0]
    folder = SEASONS / season
    players, lineups = fetch(season, folder, refetch)
    build(season, rating, players, lineups, fetch_rating(season, folder, rating, refetch))


if __name__ == "__main__":
    main()
