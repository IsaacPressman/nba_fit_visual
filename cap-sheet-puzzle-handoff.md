# Cap Sheet Puzzle: Build Handoff

A small web app that shows how well every NBA team's core rotation fits together. Each player is a puzzle piece. Weaknesses cut notches, teammates' strengths fill those notches in their own colors, and whatever nobody covers stays striped. The striped share is the team's **wasted fit**.

The goal is a visualization first and a number second. The picture should tell you who covers for whom without reading anything.

**Keep the first screen clean.** It should say one thing: here are your pieces, here's how well they fit. Percentile cutoffs, supply and demand, compounding, reach multipliers and controls all exist underneath, revealed by curiosity rather than shown up front.

A working prototype exists as a single HTML page (Cap Sheet Puzzle v11). This document describes what to rebuild, including the fixes found while reviewing that prototype.

---

## 1. Core concept

- **Scope:** all 30 teams, 2025-26 regular season.
- **Roster:** each team's top 8 players by total regular-season minutes for that team.
- **Piece size:** the player's share of team possessions, `usage rate × minutes per game / 48`. Big pieces carry the offense.
- **Piece shape:** a square. Weaknesses cut notches into it. The only thing that sticks out is a ball-dominance tab.
- **Fit is scored for the whole rotation at once.** Where a piece is drawn never changes the score.
- **Talent is not fit.** A team of flawed players whose flaws cancel out should score well; a stacked but redundant team should score badly.

---

## 2. Data

### 2.1 Sources

| Data | Source | Status |
|---|---|---|
| Per-game box scores (MIN, PTS, REB, AST, STL, BLK, TOV, FGM, FGA, 3PM, 3PA, FTM, FTA) with team per game | Official NBA box scores via `nba_api` LeagueGameLog. The prototype used the bundled CSV at `github.com/KhiProspere41/nba-analytics/data/nba_dailyleaders_2025_26.csv` | Done, verified against Basketball-Reference and Land of Basketball |
| Team records | Any standings source | Done |
| Defensive impact metric | **Not solved.** Preferred: defensive EPM (Dunks & Threes) or defensive DARKO. Next: CraftedDPM. Last resort: DBPM | Open, see section 7 |

Aggregate game logs per (player, team) for rotation, minutes and usage, and per player (all teams combined) for skill rates and percentiles. Traded players use their per-team minutes for rotation selection and their full-season rates for skills.

### 2.2 Derived player fields

| Field | Definition |
|---|---|
| `mpg` | minutes / games for that team |
| `usg` | `100 × ((FGA + 0.44·FTA + TOV) / MIN) / (5 × teamEventsPerPlayerMinute)` where `teamEventsPerPlayerMinute = (teamFGA + 0.44·teamFTA + teamTOV) / teamPlayerMinutes` |
| `load` | `usg × mpg / 48` (share of team possessions, piece area) |
| Percentile pool | every player with 500+ season minutes |

### 2.3 Skill scores (each converted to a 0–100 percentile across the pool)

| Skill | Score |
|---|---|
| Shooting | `0.55·z(3PA per 36) + 0.45·z(shrunk 3P%)`, shrunk 3P% = `(3PM + 0.355·60) / (3PA + 60)` |
| Interior | `0.55·z(REB per 36) + 0.45·z(BLK per 36)` |
| Playmaking | `0.5·z(AST per 36) + 0.5·z(AST / (FGA + 0.44·FTA + TOV + AST))` |
| Perimeter D | `DPM − (a + b·interiorScore) + 0.15·z(STL per 36)`, where `a, b` come from regressing DPM on the interior score across the pool. This removes credit a big gets for rim protection. |

Recommended improvement over the prototype: regress per-36 rates toward the pool mean for low-minute players, weight `minutes / (minutes + 600)`.

**Fairness rule:** every player must use the same defensive source. Do not mix real ratings for some teams with estimates for others.

---

## 3. Fit model

All constants below are the prototype defaults and should be exposed as tunable settings.

### 3.1 Per player

```
clamp01(v) = max(0, min(1, v))

for skill k in {shooting, interior, perimeterD}:
  need[k]     = clamp01((50 − pct[k]) / 50) ^ 0.6        // notch below 50th percentile
  strength[k] = clamp01((pct[k] − 65) / 35)               // strength above 65th

compound = 1 + 0.6 × (sum(need) − max(need))            // several weaknesses compound
notch[k] = min(0.46, depth[k] × need[k] × compound)      // depth: sho 0.38, int 0.34, per 0.36

rawBall  = clamp01((usg − 20) / 14)
ball     = rawBall × (1 − 0.6 × playmakingPct / 100)     // playmakers share the ball
tab      = 0.34 × ball

lowNeed  = clamp01((17 − usg) / 8) ^ 0.6
lowNotch = min(0.46, 0.26 × lowNeed)                     // "needs a creator"
```

Notch depths and tab length are fractions of the piece's side. Slot width is 0.34 of the side.

Strengths in shooting, interior and perimeter D **never grow tabs**. A strength helps any lineup, so it only adds to the team's supply.

### 3.2 Per team

```
SLOT = 0.34
reach = { shooting: 1.3, interior: 3.0, perimeterD: 1.6 }   // one rim protector covers the floor

for each skill k:
  demand[k] = Σ load × SLOT × notch[k]
  supply[k] = Σ load × SLOT × depth[k] × strength[k] × reach[k]
  fill[k]   = demand[k] > 0 ? min(1, supply[k] / demand[k]) : 1
  waste[k]  = demand[k] × (1 − fill[k])
  suppliers[k] = players with strength[k] > 0, share ∝ load × strength[k]

ball dominance:
  T = Σ load × SLOT × tab          // usage that needs room
  A = Σ load × SLOT × lowNotch     // room low-usage players offer
  matched = min(T, A)
  surplus = T − matched            // too many creators
  starved = A − matched            // nobody creating for low-usage players
  creators = players with tab > 0, share ∝ load × tab

wastedFit% = (Σ waste[k] + surplus + starved) / Σ load × 100
```

The team view also shows a breakdown row for each of: Shooting, Interior, Perimeter D, Ball dominance, Nobody creating (covered % and points of waste).

---

## 4. Visual design

### 4.1 Piece anatomy

- Square, area proportional to `load`, team-assigned color.
- **Top edge:** shooting notch (left slot), interior notch (right slot).
- **Left edge:** needs-a-creator notch (upper slot), perimeter D notch (lower slot).
- **Right edge:** ball-dominance tab (upper slot).
- **Notch fill:** the covered part is painted from the edge inward in the colors of the supplying teammates, split by their share. The uncovered remainder is striped in the waste color. A low-usage notch is painted in the creators' colors.
- **No permanent strength bands.** Strengths never appear on the piece that has them. A strength is not something a player sticks out; it is something that repairs teammates, so it shows up inside their notches and on hover. Bands would only add noise.
- **Notch labels.** A small icon or letter inside each notch on the team view (for example S, I, D, C), so pieces can be read without memorizing the key.

### 4.2 Layout (fixes a prototype fault)

The prototype packed pieces into a compact square with a random-order search. That caused three problems: readers assume neighbors matter, notches get painted in the color of a player on the far side of the board, and white packing gaps look like waste.

Replace it with a **fixed, deterministic layout**:
- Order pieces by `load`, largest always in the same corner, so every team reads the same way.
- Use a squarified treemap (cells as close to square as possible) or a fixed skyline layout on a neutral background. No white gaps that could be read as waste.
- Only stripes mean waste. Nothing else on the board should look like empty space.
- Add one line of copy: coverage is pooled across the rotation, so the painted colors show who supplies the skill, not a one-to-one assignment.

### 4.3 League grid

- 30 small team tiles, sortable by best fit or by record.
- **Common scale across all tiles.** The prototype zoomed each tile to fit, so a team using 80% of possessions looked the same size as one using 95%.
- **Simplified rendering at tile size.** Drop notch outlines, supplier splits and small labels. Keep piece size, striped waste and the ball tab. Full detail lives in the team view.
- Treat wasted-fit differences under 1 point as ties in ranking and labels.
- Each tile: team name, record, wasted fit %.

### 4.4 Team view

- Big board, wasted fit %, breakdown rows, key, player panel, roster list, fit-rule controls, methodology note.
- Player panel: possession share, usage, minutes, games, then bars for usage, playmaking, shooting, interior and perimeter D with the underlying stats and a notch / strength / flat tag, plus a compounding note when it applies.
- Roster list: tags for ball-dominant, each notch, each strength, needs a creator.

### 4.5 Theming and accessibility

- Light and dark themes. Piece labels must switch color in dark mode (hard-coded dark text in the prototype).
- Color cannot be the only channel: linked highlighting (below) and notch labels carry the same information.
- The ball tab needs a minimum rendered size so it reads on small tiles.

---

## 5. Interactions

**5.1 Linked highlighting (priority).**
- Hover or tap a player, on the board or in the roster: dim everything except his piece and every notch he helps fill, and show what he supplies (for example "Shooting 92 · Interior 97 · Perimeter D 74").
- Hover or tap a notch: highlight the players covering it and show their shares.
- This is the payoff for keeping pieces clean, and it fixes the colorblind problem, since coverage no longer depends on telling pastels apart.

**5.2 Exploded ↔ assembled.**
- **Exploded:** the eight pieces laid out separately, each inspectable on its own, notches open and unfilled. This is the natural place to study a single player's shape.
- **Assembled:** pieces animate into the team board, notches fill with teammates' colors, and the striped remainder appears.
- The transition explains the whole premise without a paragraph of methodology, and it is the best thing to lead with on a first visit or in a shared link.

**5.3 Drag to swap (the defining interaction).**
- Drag any league player onto a rotation player to replace him. Pulling a piece out should feel physical; the board recomputes, some stripes close and new ones open.
- Show before and after wasted fit side by side, with the breakdown rows that moved.

**5.4 Fit vs record chart.**
- Scatter of all 30 teams: wasted fit on one axis, wins on the other, one dot per team, with a fitted line and the correlation shown (currently about −0.37).
- Clicking a dot opens that team's board; hovering previews its puzzle.
- This keeps outliers interesting rather than looking like errors: a strong team with poor fit (Celtics) or a weak team with clean fit (Wizards) becomes the thing worth arguing about, and it shows honestly how much the score explains.

**5.5 Secondary.**
- Tap a team tile to open its team view.
- Fit rules panel with the constants from section 3; changes recompute all 30 teams and the chart.

---

## 6. Prototype results for reference

- Across 30 teams, wasted fit correlates with wins at about −0.37: a real but modest signal.
- Thunder ranked 2nd best fit, Spurs 10th. Notable misfits: Celtics (56-26) ranked 29th, Wizards (17-65) ranked 9th. Some of this is likely the defense proxy.
- The three-team version (Warriors, Spurs, Thunder with CraftedDPM) ordered teams by record: Thunder 0.7%, Spurs 5.3%, Warriors 7.9%.

---

## 7. Known issues and open questions

1. **Defense data (biggest issue).** The prototype uses a box-score estimate for everyone (steals, blocks, rebounds, weighted to match CraftedDPM on 55 players). It misses defenders who don't get steals; Draymond Green shows a perimeter notch. Get a full league-wide defensive metric before trusting rankings. Longer term, tracking-based perimeter grades (matchup difficulty, opponent shooting) would be best.
2. **Validation.** Parameters were tuned by eye on three teams. Check whether wasted fit predicts net rating beyond talent (for example, summed CraftedPM or EPM). If it adds nothing, it isn't measuring construction yet. Test how stable the rankings are when constants move slightly.
3. **Rotation noise.** Regular-season minutes include injuries and partial seasons (Butler, Curry, Jalen Williams). Consider a healthy-rotation or playoff-rotation option.
4. **Usage counts twice.** It sets size and drives the tab. Probably right, but worth testing with the tab turned off.
5. **Perfect scores should be rare.** Some teams land near 0%. Coverage may need to be harder to reach.
6. **Untested archetypes.** Confirm a high-usage, low-playmaking, poor-defense scorer (a Cam Thomas type) comes out clearly jagged, and a 3-and-D wing comes out a clean square.

---

## 8. Suggested build order

1. Data pipeline: game logs → per-player and per-team aggregates → percentiles → JSON for all 30 teams.
2. Fit model as a pure, tested module (section 3), independent of rendering.
3. Deterministic layout and piece renderer (team view first).
4. Exploded ↔ assembled transition.
5. League grid with common scale and simplified tiles.
6. Linked highlighting.
7. Fit vs record chart.
8. Drag-to-swap with a before/after readout.
9. Fit rules panel.
10. Swap in a real league-wide defensive metric and run the validation checks.
