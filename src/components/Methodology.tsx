/**
 * The methodology note. Section 7 lists what is still open; saying so here is
 * cheaper than having a reader discover it and stop trusting the whole thing.
 */
import type { League } from '../fit/types'

export function Key() {
  const rows: Array<[string, string]> = [
    ['S', 'Shooting, top edge. Cut when a player shoots below the pivot.'],
    ['I', 'Interior, top edge. Rebounding and rim protection; the dotted part is paid back by the spacing a small lineup gets.'],
    ['C', 'Needs a creator, left edge. Cut by low usage, filled by the creators.'],
    ['D', 'Perimeter D, left edge. Includes a share of the worst defender’s hole, since opponents hunt him on every possession.'],
    ['B', 'Ball dominance, right edge. Usage that needs the ball, filled by teammates happy to play off it; striped when there are too many creators.'],
  ]
  return (
    <div className="prose">
      <p>
        A piece is one player, its area his share of team possessions. Weaknesses cut notches;
        the colors inside a notch are the teammates repairing it, split by their share. Stripes
        are what nobody covers.
      </p>
      <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
        {rows.map(([letter, text]) => (
          <li key={letter} style={{ display: 'flex', gap: 'calc(var(--step) * 2)' }}>
            <span className="letter-key" aria-hidden="true">
              {letter}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <p>
        Strengths never appear on the piece that has them. A strength is not something a player
        sticks out; it is something that repairs teammates, so it shows up inside their notches.
      </p>
    </div>
  )
}

export function Methodology({ data }: { data: League }) {
  return (
    <div className="prose">
      {data.projected && (
        <p>
          <b>This season is a projection.</b> The {data.season} rosters come from
          Basketball-Reference; everything about the players comes from {data.basedOn}. Each
          player keeps his {data.basedOn} skills, usage and minutes per game and plays them on
          the team that rosters him now, and each rotation is the eight rostered players with the
          most {data.basedOn} minutes per game. It cannot see roles changing with a new team — a
          sixth man who becomes a starter keeps his old minutes here — and rookies or anyone
          without enough {data.basedOn} minutes are named on the team page rather than scored.
          There are no records, lineups or shared minutes yet, so the chart, the lineups row and
          the shared-minutes notch colors wait for games to be played.
        </p>
      )}
      <p>
        <b>Scope.</b> All 30 teams, {data.season} regular season, each team's top{' '}
        {data.rotationSize} players by total minutes for that team. Piece area is usage rate ×
        minutes per game ÷ 48. Percentiles run against the {data.pool.size} players with{' '}
        {data.pool.minMinutes} or more season minutes; per-36 rates regress toward the league
        rate with weight minutes ÷ (minutes + {data.pool.shrinkPrior}), so a 600-minute sample
        counts half. Traded players use per-team minutes to decide the rotation and full-season
        rates for skills.
      </p>

      <p>
        <b>Defense.</b> Defensive EPM, one source for every player in the pool, with no
        box-score estimate standing in for anyone. Perimeter defense is that rating minus what
        the interior score predicts ({data.defenseRegression.a.toFixed(2)} +{' '}
        {data.defenseRegression.b.toFixed(2)} × interior, fitted across the pool), plus a small
        steals term — so a big does not collect credit for rim protection twice. This is the
        prototype's largest open problem closed: its estimate missed defenders who do not
        generate steals and put a perimeter notch on Draymond Green, which this does not.
      </p>

      <p>
        <b>Coverage has to be on the floor.</b> Fit happens five players at a time, so a
        strength only helps while its owner is playing. For each skill the model works out how
        much of the game at least one supplier is out there — one minus the product of
        (1 − minutes share × strength) across the rotation — and caps coverage at that. A rim
        protector who plays 24 minutes cannot cover the other 24. Two half-game rim protectors
        reach 75%, not 100%, which is also where diminishing returns come from: because
        coverage is a product rather than a sum, the fifth shooter adds less than the second
        without needing a curve of its own. Minutes are treated as independent, which is wrong
        in detail — coaches stagger on purpose — but it is the closest approximation minutes
        alone support, and far closer than assuming a strength covers the whole game. The
        <b> Floor</b> column shows the figure per channel.
      </p>

      <p>
        <b>Shooting pools; defence mostly does not.</b> Good shooting genuinely spreads across
        a lineup, so shooting and interior coverage are pooled. Perimeter defence is charged
        half against the pool and half against the worst defender on the roster, because
        opponents hunt the weakest man on the floor every possession rather than averaging him
        against his better teammates. The blend is a slider in the fit rules; at 1 it becomes a
        pure weakest-link rule, the playoff view.
      </p>

      <p>
        <b>What the score is worth.</b> Exposure moves with wins at about r = −0.77, but most
        of that is talent rather than construction: hold possession-weighted EPM still and the
        signal drops to about r = −0.20 — correctly signed and modest, from only thirty
        teams. The stronger test is five-man lineups: across 7,672 of them in two seasons the
        model was not tuned on, each point of exposure cost about half a point of net rating
        per 100 possessions beyond the talent on the floor. Fit adds to talent rather than
        replacing it, so a talented team that fits badly is still good.
      </p>

      <p>
        <b>Reading the board.</b> Coverage is pooled across the rotation rather than assigned
        man to man, so a notch is filled to the same depth on every piece that has it, and the
        colors inside each notch are the teammates who share the floor with that player,
        weighted by the minutes they play together — so the same notch is painted differently on
        a starter and on a reserve. Every notch is drawn at exactly its share of the piece, which
        makes the striped share of the board the exposure figure, to scale. Position on the
        board never affects the score: the layout is a fixed squarified treemap, ordered by
        possession share with the largest piece always in the same corner, so neighbours carry
        no meaning.
      </p>

      <p>
        <b>Still open.</b> Perimeter defense would be better from tracking data — matchup
        difficulty and opponent shooting — than from a single-number rating with the interior
        part subtracted, and switchability is a fit property this cannot see at all. Piece area
        uses minutes per game, so a star who played half a season draws a full-size piece and
        the score cannot see the games he missed; each team view names anyone under 60 games.
        Usage counts twice, setting piece size and cutting the ball-dominance notch. Shot-profile congestion —
        three drivers crowding the rim the way two ball-handlers crowd the ball — was tried and
        made the signal measurably worse, so it is not in the model. Nor is scheme: the same
        five players fit differently under a drop-coverage coach than a switch-everything one,
        which is the honest limit of any roster-only model. And the Nobody-creating channel
        never charges anything on the default rules: among top-8 rotations the creators' side
        always binds first, on all 30 teams, so its breakdown row is hidden until moving the
        rules wakes it. The C notches still fill in the creators' colors. Every constant is in the fit rules panel
        if you want to see how much of the ranking survives moving them.
      </p>

      <p>
        <b>Sources.</b> {Object.values(data.sources).join('. ')}. Built {data.generated}.
      </p>
    </div>
  )
}
