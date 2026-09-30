"""Game logs + defensive EPM + standings  ->  public/league.json

Implements section 2 of the handoff: per-(player, team) aggregates for rotation,
minutes and usage; per-player season aggregates for skill rates and percentiles.
Traded players use per-team minutes for rotation selection and full-season rates
for skills.
"""
import json
import pathlib
import re
import unicodedata
from datetime import date

import numpy as np
import pandas as pd

from teams import TEAMS, BBREF_TO_ABBR

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "league.json"

POOL_MIN_MINUTES = 500      # percentile pool
SHRINK_PRIOR = 600          # per-36 rates regress toward pool mean: m / (m + 600)
ROTATION_SIZE = 8
THREE_PT_PRIOR_MADE = 0.355 * 60
THREE_PT_PRIOR_ATT = 60


def norm_name(s):
    """Match names across three sources: strip accents, punctuation and suffixes."""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s.lower())
    return re.sub(r"[^a-z]", "", s)


# --------------------------------------------------------------------------- #
# aggregates
# --------------------------------------------------------------------------- #
BOX = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV",
       "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA"]


def load_logs():
    df = pd.read_csv(DATA / "nba_dailyleaders_2025_26.csv")
    df["key"] = df["PLAYER"].map(norm_name)
    return df


def per_team(df):
    """One row per (player, team): the stint that decides rotation and piece size."""
    g = df.groupby(["key", "PLAYER", "TEAM"], as_index=False)[BOX].sum()
    g["G"] = df.groupby(["key", "PLAYER", "TEAM"]).size().values
    g["mpg"] = g["MIN"] / g["G"]
    return g


def per_season(df):
    """One row per player, all teams combined: the rates that become percentiles."""
    g = df.groupby(["key", "PLAYER"], as_index=False)[BOX].sum()
    g["G"] = df.groupby(["key", "PLAYER"]).size().values
    return g


def team_event_rate(df):
    """teamEventsPerPlayerMinute = (teamFGA + 0.44*teamFTA + teamTOV) / teamPlayerMinutes"""
    t = df.groupby("TEAM")[["FGA", "FTA", "TOV", "MIN"]].sum()
    return ((t["FGA"] + 0.44 * t["FTA"] + t["TOV"]) / t["MIN"]).to_dict()


def usage(row, rate):
    """usg = 100 * ((FGA + 0.44*FTA + TOV) / MIN) / (5 * teamEventsPerPlayerMinute)"""
    if row["MIN"] <= 0:
        return 0.0
    events = (row["FGA"] + 0.44 * row["FTA"] + row["TOV"]) / row["MIN"]
    return 100.0 * events / (5.0 * rate[row["TEAM"]])


# --------------------------------------------------------------------------- #
# skills
# --------------------------------------------------------------------------- #
def shrink(rate, minutes, pool_mean):
    """Regress a per-36 rate toward the pool mean; weight m / (m + 600)."""
    w = minutes / (minutes + SHRINK_PRIOR)
    return w * rate + (1 - w) * pool_mean


def build_skills(season, depm_by_key):
    s = season.copy()
    m36 = s["MIN"].replace(0, np.nan) / 36.0
    for stat in ("FG3A", "REB", "BLK", "AST", "STL"):
        s[stat + "36"] = s[stat] / m36

    s["shrunk3P"] = ((s["FG3M"] + THREE_PT_PRIOR_MADE) /
                     (s["FG3A"] + THREE_PT_PRIOR_ATT))
    denom = s["FGA"] + 0.44 * s["FTA"] + s["TOV"] + s["AST"]
    s["astRatio"] = np.where(denom > 0, s["AST"] / denom, 0.0)

    pool = s["MIN"] >= POOL_MIN_MINUTES
    p = s[pool]

    # minutes-weighted league rate is the prior every per-36 rate regresses toward
    for stat in ("FG3A", "REB", "BLK", "AST", "STL"):
        col = stat + "36"
        prior = float(p[stat].sum() / (p["MIN"].sum() / 36.0))
        s[col] = shrink(s[col].fillna(prior), s["MIN"], prior)

    prior_ratio = float(np.average(p["astRatio"], weights=p["MIN"]))
    s["astRatio"] = shrink(s["astRatio"], s["MIN"], prior_ratio)

    def z(col):
        ref = s.loc[pool, col]
        mu, sd = ref.mean(), ref.std(ddof=0)
        return (s[col] - mu) / (sd if sd else 1.0)

    s["shootingScore"] = 0.55 * z("FG3A36") + 0.45 * z("shrunk3P")
    s["interiorScore"] = 0.55 * z("REB36") + 0.45 * z("BLK36")
    s["playmakingScore"] = 0.5 * z("AST36") + 0.5 * z("astRatio")

    s["dpm"] = s["key"].map(depm_by_key)
    missing = s.loc[pool & s["dpm"].isna(), "PLAYER"].tolist()
    if missing:
        raise SystemExit("defensive metric missing for pool players: " + ", ".join(missing))
    # Fairness rule: one source for everyone. Below-pool players without a rating
    # sit at the pool's minutes-weighted mean rather than getting an estimate.
    pool_dpm_mean = float(np.average(s.loc[pool, "dpm"], weights=s.loc[pool, "MIN"]))
    s["dpm"] = s["dpm"].fillna(pool_dpm_mean)

    # strip the rim-protection credit a big earns inside his DPM
    fit = np.polyfit(s.loc[pool, "interiorScore"], s.loc[pool, "dpm"], 1)
    b, a = float(fit[0]), float(fit[1])
    s["perimeterDScore"] = s["dpm"] - (a + b * s["interiorScore"]) + 0.15 * z("STL36")

    for skill in ("shooting", "interior", "playmaking", "perimeterD"):
        col = skill + "Score"
        ref = np.sort(s.loc[pool, col].to_numpy())
        s[skill + "Pct"] = np.searchsorted(ref, s[col].to_numpy(), "left") / len(ref) * 100.0

    return s, {"interceptA": a, "slopeB": b, "poolSize": int(pool.sum()),
               "poolDpmMean": pool_dpm_mean}


# --------------------------------------------------------------------------- #
# shared minutes
# --------------------------------------------------------------------------- #
SEASON_DIR = DATA / "seasons" / "2025-26"


TOP_LINEUPS = 6


def season_lineups():
    """(lineups frame, (team, pid) -> name key), or None if not fetched."""
    lu_path, pl_path = SEASON_DIR / "lineups.csv", SEASON_DIR / "players.csv"
    if not (lu_path.exists() and pl_path.exists()):
        return None
    players = pd.read_csv(pl_path)
    key_of = {(r.team, str(r.pid)): norm_name(r.name) for r in players.itertuples()}
    return pd.read_csv(lu_path), key_of


def top_lineups(pool_keys):
    """Each team's most-used five-man lineups whose five are all in the pool,
    so every one of them can be drawn: name keys and minutes."""
    loaded = season_lineups()
    if loaded is None:
        return None
    lineups, key_of = loaded
    out = {}
    for r in lineups.sort_values("seconds", ascending=False).itertuples():
        keys = [key_of.get((r.team, pid)) for pid in str(r.lineup_id).split("-")]
        if len(keys) != 5 or not all(k in pool_keys for k in keys):
            continue
        rows = out.setdefault(r.team, [])
        if len(rows) < TOP_LINEUPS:
            rows.append({"keys": keys, "minutes": round(r.seconds / 60.0)})
    return out


def shared_minutes():
    """Minutes each pair of teammates shared the floor, per team, from the
    five-man lineup totals (pipeline/season.py). Keyed by player name key.
    Returns None when the lineup data has not been fetched: the board then
    paints notches with pooled shares, as it did before."""
    loaded = season_lineups()
    if loaded is None:
        return None
    lineups, key_of = loaded
    out = {}
    for r in lineups.itertuples():
        mins = (0 if pd.isna(r.seconds) else r.seconds) / 60.0
        keys = [key_of.get((r.team, pid)) for pid in str(r.lineup_id).split("-")]
        keys = [k for k in keys if k]
        team = out.setdefault(r.team, {})
        for a in keys:
            row = team.setdefault(a, {})
            for b in keys:
                row[b] = row.get(b, 0.0) + mins
    return out


# --------------------------------------------------------------------------- #
# assembly
# --------------------------------------------------------------------------- #
def num(v, n=2):
    if v is None:
        return None
    v = float(v)
    return None if np.isnan(v) else round(v, n)


def player_payload(stint, sk):
    return {
        "id": stint["key"] + "|" + stint["TEAM"],
        "key": stint["key"],
        "name": stint["PLAYER"],
        "team": stint["TEAM"],
        "games": int(stint["G"]),
        "min": int(stint["MIN"]),
        "mpg": num(stint["mpg"], 1),
        "usg": num(stint["usg"]),
        "load": num(stint["load"], 4),
        "pct": {
            "shooting": num(sk["shootingPct"], 1),
            "interior": num(sk["interiorPct"], 1),
            "playmaking": num(sk["playmakingPct"], 1),
            "perimeterD": num(sk["perimeterDPct"], 1),
        },
        "raw": {
            "fg3aPer36": num(sk["FG3A36"], 1),
            "fg3Pct": num(sk["shrunk3P"] * 100, 1),
            "rebPer36": num(sk["REB36"], 1),
            "blkPer36": num(sk["BLK36"], 2),
            "astPer36": num(sk["AST36"], 1),
            "astRatio": num(sk["astRatio"] * 100, 1),
            "stlPer36": num(sk["STL36"], 2),
            "dpm": num(sk["dpm"]),
            "epm": num(sk["epm"]),
            "seasonMin": int(sk["MIN"]),
        },
    }


def main():
    logs = load_logs()
    epm = pd.read_csv(DATA / "epm_2025_26.csv")
    epm["key"] = epm["player_name"].map(norm_name)
    epm_u = epm.drop_duplicates("key").set_index("key")
    depm = epm_u["depm"].to_dict()
    tepm = epm_u["epm"].to_dict()

    stints = per_team(logs)
    rate = team_event_rate(logs)
    stints["usg"] = stints.apply(lambda r: usage(r, rate), axis=1)
    stints["load"] = stints["usg"] * stints["mpg"] / 48.0

    season = per_season(logs)
    skills, reg = build_skills(season, depm)
    skills["epm"] = skills["key"].map(tepm).fillna(0.0)
    sk = skills.set_index("key")

    standings = pd.read_csv(DATA / "standings_2025_26.csv")
    standings["abbr"] = standings["bbref"].map(BBREF_TO_ABBR)
    rec = standings.set_index("abbr")[["wins", "losses"]].to_dict("index")

    overlap = shared_minutes()
    pool_keys = set(season.loc[season["MIN"] >= POOL_MIN_MINUTES, "key"])
    common = top_lineups(pool_keys)
    teams = []
    for abbr in TEAMS:
        name, _bbref, c1, c2 = TEAMS[abbr]
        roster = (stints[stints["TEAM"] == abbr]
                  .sort_values("MIN", ascending=False)
                  .head(ROTATION_SIZE))
        players = [player_payload(r, sk.loc[r["key"]]) for _, r in roster.iterrows()]
        load_sum = sum(p["load"] for p in players) or 1.0
        talent = sum(p["load"] * p["raw"]["epm"] for p in players) / load_sum
        team = {
            "abbr": abbr, "name": name,
            "talent": num(talent, 3),
            "wins": int(rec[abbr]["wins"]), "losses": int(rec[abbr]["losses"]),
            "colors": [c1, c2],
            "players": players,
        }
        if overlap is not None:
            # rotation x rotation, by player id; the diagonal is his own floor time
            shared = overlap.get(abbr, {})
            team["overlap"] = {
                a["id"]: {b["id"]: num(shared.get(a["key"], {}).get(b["key"], 0.0), 1)
                          for b in players}
                for a in players
            }
        if common is not None:
            team["lineups"] = common.get(abbr, [])
        teams.append(team)

    # every pool player, as a drag-to-swap candidate, using his largest stint
    primary = stints.sort_values("MIN", ascending=False).drop_duplicates("key")
    league = [player_payload(r, sk.loc[r["key"]])
              for _, r in primary.iterrows() if r["key"] in pool_keys]
    league.sort(key=lambda p: -p["min"])

    payload = {
        "season": "2025-26",
        "generated": date.today().isoformat(),
        "rotationSize": ROTATION_SIZE,
        "pool": {"minMinutes": POOL_MIN_MINUTES, "size": reg["poolSize"],
                 "shrinkPrior": SHRINK_PRIOR},
        "defenseRegression": {"a": num(reg["interceptA"], 4), "b": num(reg["slopeB"], 4)},
        "sources": {
            "box": "NBA box scores, 2025-26 regular season (82 games x 30 teams)",
            "defense": "Defensive EPM, Dunks & Threes (snapshot 2026-06-13)",
            "records": "Basketball-Reference standings",
            **({"lineups": "pbpstats.com five-man lineup totals (shared minutes)"}
               if overlap is not None else {}),
        },
        "teams": teams,
        "league": league,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print("wrote %s  %.0f KB  %d teams, %d league players, pool %d"
          % (OUT.relative_to(ROOT), kb, len(teams), len(league), reg["poolSize"]))
    print("defense regression: dpm ~ %+.3f %+.3f * interior" % (reg["interceptA"], reg["slopeB"]))


if __name__ == "__main__":
    main()
