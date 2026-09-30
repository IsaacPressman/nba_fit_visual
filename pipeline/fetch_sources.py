"""Fetch the three raw sources into data/. Run once; everything after is offline.

  1. Player game logs (2025-26 regular season)  -> data/nba_dailyleaders_2025_26.csv
  2. Dunks & Threes EPM (defensive EPM)         -> data/epm_2025_26.csv
  3. Basketball-Reference standings             -> data/standings_2025_26.csv
"""
import re
import sys
import pathlib
import requests
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

GAMELOG_URL = ("https://raw.githubusercontent.com/KhiProspere41/nba-analytics/"
               "main/data/nba_dailyleaders_2025_26.csv")
EPM_URL = "https://dunksandthrees.com/epm"
STANDINGS_URL = "https://www.basketball-reference.com/leagues/NBA_2026_standings.html"


def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=60, **kw)
    r.raise_for_status()
    return r


def fetch_gamelogs():
    out = DATA / "nba_dailyleaders_2025_26.csv"
    if out.exists():
        print(f"gamelogs: cached ({out.stat().st_size:,} bytes)")
        return
    out.write_bytes(get(GAMELOG_URL).content)
    print(f"gamelogs: {out.stat().st_size:,} bytes")


def parse_epm(html):
    """D&T renders its EPM table as JS object literals inside the page body.
    Returns (frame, snapshot date)."""
    objs = re.findall(r'\{season:\d{4},game_dt:"[^"]+",player_id:\d+,.*?\}', html)
    if not objs:
        sys.exit("EPM: page shape changed, no records found")

    def parse(o):
        pairs = re.findall(r'([a-z_0-9]+):(".*?"|-?\.?\d[\d.e-]*|null|true|false)', o)
        return {k: v.strip('"') for k, v in pairs}

    df = pd.DataFrame(parse(o) for o in objs)
    keep = ["player_id", "player_name", "team_alias", "position", "off", "def", "tot"]
    df = df[keep].rename(columns={"off": "oepm", "def": "depm", "tot": "epm"})
    for c in ("oepm", "depm", "epm"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df, re.search(r'game_dt:.(.*?).,', objs[0]).group(1)


def fetch_epm():
    df, snapshot = parse_epm(get(EPM_URL).text)
    df.to_csv(DATA / "epm_2025_26.csv", index=False)
    print(f"epm: {len(df)} players, snapshot {snapshot}")


def fetch_standings():
    html = get(STANDINGS_URL).text
    rows = re.findall(
        r'data-stat="team_name"\s*><a href="/teams/(\w+)/2026\.html">([^<]+)</a>.*?'
        r'data-stat="wins"\s*>(\d+).*?data-stat="losses"\s*>(\d+)',
        html, re.S)
    seen, out = set(), []
    for abbr, name, w, l in rows:
        if abbr in seen:
            continue
        seen.add(abbr)
        out.append({"bbref": abbr, "name": name.strip(), "wins": int(w), "losses": int(l)})
    if len(out) != 30:
        sys.exit(f"standings: expected 30 teams, parsed {len(out)}")
    pd.DataFrame(out).to_csv(DATA / "standings_2025_26.csv", index=False)
    print(f"standings: {len(out)} teams")


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    fetch_gamelogs()
    fetch_epm()
    fetch_standings()
