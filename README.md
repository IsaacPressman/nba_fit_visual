# Missing Pieces

How well every NBA rotation fits together, 2025-26. Each player is a puzzle
piece sized by his share of team possessions; his weaknesses cut notches into
it, teammates' strengths fill those notches in their own colours, and whatever
nobody covers stays striped. The striped share is the team's **exposure** — and
it is drawn to scale: every notch's area is exactly what the model charges for
that player and skill, so the striped share of a board *is* the number beside
it (a test holds the two within 0.01 points on all 30 boards).

The colors inside a notch are the teammates who share the floor with that
player, weighted by the minutes they actually play together, so the same notch
is painted differently on a starter and a reserve. Under each board sit the
team's most-used five-man lineups, each drawn as its own small board, because
fit happens five players at a time.

Coverage is capped by how much of the game a supplier is actually on the floor,
because fit happens five players at a time — a rim protector who plays 24
minutes cannot cover the other 24.

Built from `cap-sheet-puzzle-handoff.md`.

## Running it

```bash
npm install
npm run dev          # the bundle in public/ is committed, so this just works
```

`npm test` runs the model, geometry and live-data suites. `npm run build`
type-checks and produces `dist/`.

## 2026-27, projected

The season switch in the header opens a projected 2026-27: next season's
rosters (Basketball-Reference's 2027 team pages) scored on 2025-26 play. Every
player keeps his 2025-26 skills, usage and minutes per game on the team that
rosters him now, and each rotation is the eight rostered players with the most
2025-26 minutes per game.

```bash
npm run project     # fetches rosters (cached) -> public/league-2026-27.json
```

What it cannot see: rookies and anyone under the 500-minute pool have nothing to
score, so each team page names them instead; roles that change with a new team;
and records, lineups and shared minutes, which do not exist yet — so in the
projected season the chart, the lineups row and the shared-minutes notch colors
step aside. Re-run it as rosters change; `--refetch` pulls them again.

## Links

Everything worth sharing is in the URL hash, so any board can be linked
exactly as you see it: `#/team/BOS`, `#/league`, `#/chart`, and
`?season=2026-27` for the projection. A swap rides along
as `?swap=<out id>~<in id>`, and rules moved off their defaults as a compact
`rules=` diff — an untouched rules panel adds nothing. `src/route.ts` owns the
format and `src/route.test.ts` pins it.

The league grid is the front door: an empty hash lands there.

## Deploying

The site is static — serve `dist/`. Link previews need the share image at an
absolute URL, so build with the address it will live at:

```bash
SITE_URL=https://your-domain.example npm run build
```

Without `SITE_URL` the preview tags stay relative, which is fine locally and
means most sites will show the link without an image.

## Rebuilding the data

```bash
npm run data
```

That fetches the three sources and rewrites `public/league.json`:

| Data | Source |
|---|---|
| Player game logs, 82 games x 30 teams | the bundled `nba_dailyleaders_2025_26.csv` |
| Defensive EPM, every player in the pool | Dunks & Threes (snapshot 2026-06-13) |
| Records | Basketball-Reference standings |
| Shared minutes and top lineups (optional) | `data/seasons/2025-26/`, from `npm run lineups` |

Both scrapers assert on their input shape and exit loudly if a page changes,
rather than writing a half-empty bundle.

## Layout

```
pipeline/     fetch_sources.py, build_data.py, teams.py  ->  public/league.json
src/fit/      the model, pure and tested: no DOM, no rendering
  types.ts      shapes, and every constant from section 3 as tunable Rules
  model.ts      shapeOf (per player) and scoreRotation (per team)
  geometry.ts   a cell in, an outline path and one rect per notch out
  layout.ts     deterministic squarified treemap, and the exploded grid
  palette.ts    colour slots pinned to players, not to load rank
  highlight.ts  what stays lit when you point at a player or a notch
src/components/  board, tiles, chart, panels
```

The score never depends on where a piece is drawn: `scoreRotation` takes a
roster and returns the same number whatever order it arrives in, and there is a
test for that.

## Two things worth knowing before you trust a ranking

**The defence problem from section 7.1 is closed.** Every player in the pool has
a real defensive EPM — no box-score estimate standing in for anyone, so the
fairness rule holds. The prototype's proxy put a perimeter notch on Draymond
Green; this does not.

**Most of the win correlation is talent, not construction.** Exposure moves
with wins at r = -0.77, much stronger than the prototype's -0.37. But
possession-weighted EPM alone predicts wins at r = +0.90, and better teams also
have fewer holes to cover (exposure vs talent: r = -0.77). Hold talent still
and the construction signal is **r = -0.20** — correctly signed and modest (it
was -0.27 before the interior spacing credit below; that credit was chosen on
lineup evidence, not on this number). Team records are the weak test; the
lineup test below is the strong one. `npm test` prints both.

## Lineup validation

Thirty team records cannot tell a modest effect from noise (the talent-controlled
team signal above has p ~ 0.16). Five-man lineups can:

```bash
npm run lineups      # three seasons of pbpstats.com lineups -> data/seasons/
npm test             # src/fit/lineups.test.ts prints the readout
```

`pipeline/season.py` builds any season: pbpstats.com player and lineup totals
(stats.nba.com blocks scripted clients) plus a player rating, run through the
app's own `build_skills`, so percentiles are computed exactly as the app does —
the 2025-26 build reproduces the app's percentiles at r = 1.000. About 78% of
each season's possessions are scoreable; the rest involve a player under 500
minutes.

The rating is **Box Plus-Minus** for every season: Dunks & Threes paywalls past
seasons' EPM, and one metric across seasons keeps them comparable. 2025-26 is
also run on EPM to show what the metric alone does.

Each lineup is scored with all five on the floor, weighted by usage. Its net
rating is regressed on the sum of the five ratings (talent) and exposure,
weighted by possessions, with team fixed effects so lineups are only compared
with their own team's other lineups. **Fit is not success**: every number here
is fit *beyond* the talent on the floor.

2023-24 and 2024-25 were not looked at before the interior finding below was
written down on 2025-26, so they are the held-out test.

| Season, 10+ possessions | Lineups | Interior charged in full | Current model (spacing credit 0.9) |
|---|---|---|---|
| 2023-24, held out | 3,644 | -0.60 (t -3.9) | -0.77 (t -4.4) |
| 2024-25, held out | 4,028 | -0.23 (t -1.6) | -0.31 (t -1.9) |
| 2025-26, BPM | 4,282 | -0.07 (t -0.5) | -0.13 (t -0.9) |
| 2025-26, EPM | 4,282 | -0.24 (t -1.7) | -0.40 (t -2.4) |
| **Held out, pooled** | **7,672** | **-0.40 (t -3.8)** | **-0.52 (t -4.4)** |

Numbers are net rating per 100 possessions per point of exposure.

What it says:

- **Fit is real at the lineup level.** Out of sample, a point of exposure costs
  about half a point of net rating per 100 possessions, and it varies a lot by
  season.
- **Talent still matters more, and fit adds to it rather than multiplying it.**
  One standard deviation of talent is worth about 4.4 net; one of exposure about
  3.0. The talent-by-exposure interaction is zero (t 1.0): fit costs the same
  whether the lineup is stacked or thin. A talented lineup that fits badly is
  still good, and a thin one that fits well is still bad — fit moves each of
  them a few points from where its talent puts it.
- **Ball dominance is the strongest channel, on the right side of the ball**:
  too many creators costs points scored (t -4.3).
- **Interior is a trade, not a hole.** Lineups short of rebounding and rim
  protection allow more (t 3.6, the direction the model expects) but also score
  more (t 3.4) — small-ball spacing — so it nets to nearly nothing. The model now
  credits it: 0.43 / 0.48, about 0.9 of an uncovered interior hole, is paid back
  on offense (`interiorSpacing`, a slider). The board still cuts the notch, so
  the weakness stays visible, and draws the paid-back part dotted rather than
  striped.
- **Shooting barely registers** on points scored (t -0.9), and **perimeter D**
  cannot be judged with BPM, whose defense is its weak part: on EPM in 2025-26
  it was one of the stronger channels.

Caveats: lineups share players, so the t-statistics are somewhat optimistic; and
the talent control is only as good as the rating, which is why BPM and EPM give
different answers for the same season.

## How coverage is scored

Two rules do the work beyond the handoff's supply-and-demand, both measured
against the talent-controlled signal above rather than adopted on taste:

**Coverage has to be on the floor.** For each skill,
`presence = 1 - Π(1 - minutesShare x strength)` across the rotation, and
coverage is capped at it. This is the model's biggest single improvement
(-0.198 to -0.242 on its own) and it carries two others with it: no team scores
near zero any more, and because coverage is a product rather than a sum, the
fifth shooter automatically adds less than the second. No separate
diminishing-returns curve.

**Interior holes are mostly paid back.** From the lineup test above, 0.9 of an
uncovered interior hole is credited back as offensive spacing. At 0 it is
charged in full, as before.

**Shooting pools; defence mostly does not.** Perimeter-defence demand is charged
half against the pool and half against the worst defender on the roster, since
opponents hunt the weakest man on the floor rather than averaging him against
his better teammates. Together with the rule above this reaches **-0.270**; a
pure weakest-link rule reaches -0.289 with a weaker raw correlation, and the
blend is a slider.

All three sliders sit in the fit rules panel. Setting them to 0 returns the
original pooled model exactly, which is asserted by a test.

Worth knowing: the obvious alternative weakest-link formulation — raising notch
depth to a power inside demand — was tried and makes things *worse* (-0.194).
The formulation is doing the work, not the idea, so do not substitute one for
the other.

## Where this departs from the handoff, and why

- **Ball dominance is a notch, not a tab.** A tab that sticks out cannot hold
  an area to scale without crossing into the piece beside it, and ball
  dominance is the strongest channel in the lineup test, so it became a
  right-edge cut like the others: usage that needs the ball, filled by
  teammates happy to play off it, striped where there are too many creators.
- **Notches are drawn to scale.** Each notch's area is the model's charge for
  that player and channel, so stripes add up to exposure. The weakest-link part
  of perimeter D is charged, by construction, as if every possession had the
  worst defender's hole — so it is drawn on every piece's D notch, not on his
  alone (where it could be larger than the piece). Where a side notch would run
  into a top notch in a corner it drops below it; nothing overlaps (tested).
- **Notch colors follow shared minutes**, from five-man lineup data, rather than
  pooled shares. How full a notch is stays pooled; whose colors fill it is who
  actually plays beside him. Without lineup data the pooled shares stand.
- **Eight distinguishable colours on one board cannot pass the all-pairs
  colourblind gate** — no eight-hue set can. The palette clears every adjacent
  gate in both themes, and section 4.5's redundant channels carry the rest:
  notch letters, on-piece names, roster swatches, hover readouts that name the
  supplier and his share, table views, and an opt-in texture fill (Patterns).
- **The "Nobody creating" row never charges anything.** Among top-8 rotations
  the creators' side always binds first, on all 30 teams, so `starved` is zero
  everywhere. The row is kept because it is specified, and the methodology note
  says it is inert.
- **Shot-profile congestion was tried and dropped.** Rim and three-point
  frequency are already in the Dunks & Threes page (no play-by-play needed,
  100% coverage of rotation players), so it was cheap to test — and it took the
  talent-controlled signal from -0.270 to -0.209. Dropped on evidence, not cost.
  A positional floor-spot dimension is left out for the same reason: congestion
  is its closest testable proxy and it failed.

## Still open

Perimeter defence would be better from tracking data than from a single rating
with the interior part regressed out, and switchability is a fit property this
cannot see at all. Piece area uses minutes per game, so a star who played half a
season draws a full-size piece: Curry played 43 games and is still Golden
State's largest piece at 21.1%. That is health rather than construction, so each
team view names anyone under 60 games instead of charging for it. Usage counts
twice, setting piece size and cutting the ball-dominance notch. Scheme is out of reach entirely —
the same five players fit differently under a drop-coverage coach than a
switch-everything one, which is the honest limit of any roster-only model.

Secondary creation ("nobody can run the offence when the star sits") is a real
gap with a small verified gain (-0.270 to -0.280). It is cheap to add on top of
the presence machinery, using playmaking as the skill, and was left out only to
keep this change to two ideas.

Every constant is in the fit rules panel; `npm test` reports how far the ranking
moves when they do — currently 0.2 to 0.5 places on average for a 10% shift,
down from 1.1 to 1.3 in the first version.
