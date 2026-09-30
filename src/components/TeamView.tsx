/**
 * The team view, section 4.4.
 *
 * The first screen says one thing: here are your pieces, here is how well they
 * fit. The board leads, the number sits beside it, and percentile cutoffs,
 * supply and demand, the rules and the methodology all wait behind disclosures
 * for someone who wants them.
 *
 * The view is keyed on the team, so every team arrives fresh: exploded first,
 * then assembling, with no state carried over from the board before it.
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { SLOT_LABEL, SLOT_LETTER } from '../fit/geometry'
import { CHANNEL_SLOT, focusOf, type Highlight } from '../fit/highlight'
import { channel, rankLabel, scoreRotation, wastePoints } from '../fit/model'
import { SlotMap, surname, type Mode } from '../fit/palette'
import type { Channel, League, Player, Rules, Team, TeamFit } from '../fit/types'
import { Board, type Assembly } from './Board'
import { Breakdown } from './Breakdown'
import { ExposureStrip } from './ExposureStrip'
import { Lineups } from './Lineups'
import { Key, Methodology } from './Methodology'
import { PlayerPanel } from './PlayerPanel'
import { Roster, RosterTable } from './Roster'
import { RulesPanel } from './RulesPanel'
import { CandidateList, similarRole, SwapReadout, type Fix } from './SwapPanel'
import { tooltip } from './Tooltip'

const SEEN_KEY = 'csp-seen-intro'

const ordinal = (label: string) => {
  const tied = label.startsWith('T-')
  const n = Number(tied ? label.slice(2) : label)
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  const o = n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
  return tied ? `tied ${o}` : o
}

/**
 * The blind spot the score cannot see. `load` is usg x minutes per *game*, so a
 * star who played half a season draws the same piece as one who played all of
 * it, and dividing by total load normalises the missing share away. That is
 * health rather than construction, so it is reported here instead of charged.
 */
/**
 * A projected season scores only players with last season's data. Rookies and
 * anyone under the minutes pool are on the roster but not on the board, and
 * saying so is better than a board that quietly leaves out a top-three pick.
 */
function Unscored({ fit, names }: { fit: TeamFit; names: string[] }) {
  const shown = names.slice(0, 6)
  return (
    <p className="pooled-note" style={{ marginTop: 'calc(var(--step) * 3)' }}>
      Projected from 2025-26: each of these eight keeps last season's skills, usage and minutes
      per game on his new team, and together they carry {fit.totalLoad.toFixed(1)}% of
      possessions.{' '}
      {names.length === 0
        ? 'Everyone on the roster has 2025-26 data.'
        : `Not scored, with no 2025-26 data to go on (rookies, or under 500 minutes): ${shown.join(', ')}${
            names.length > shown.length ? ` and ${names.length - shown.length} more` : ''
          }.`}
    </p>
  )
}

function Availability({ fit }: { fit: TeamFit }) {
  const missed = fit.shapes
    .map((s) => s.player)
    .filter((p) => p.games < 60)
    .sort((a, b) => a.games - b.games)

  return (
    <p className="pooled-note" style={{ marginTop: 'calc(var(--step) * 3)' }}>
      These eight carry {fit.totalLoad.toFixed(1)}% of the team's possessions.{' '}
      {missed.length === 0
        ? 'All eight played at least 60 games.'
        : `${missed
            .map((p) => `${surname(p.name)} played ${p.games}`)
            .join(', ')} — the score reads their per-game minutes, so it cannot see the games they missed.`}
    </p>
  )
}

/**
 * For every player outside the rotation, the seat where he would close the
 * most exposure and by how much — within one chosen seat if there is one, and
 * only among similar roles if asked. Scored against the team's real rotation,
 * so the suggestions do not shift under you while a swap is being tried.
 */
function bestFixes(
  team: Team,
  league: Player[],
  rules: Rules,
  opts: { seat: string | null; similar: boolean },
): Map<string, Fix> {
  const base = scoreRotation(team, team.players, rules).wastedFitPct
  const inRotation = new Set(team.players.map((p) => p.key))
  const seats = opts.seat ? team.players.filter((p) => p.id === opts.seat) : team.players
  const out = new Map<string, Fix>()
  for (const candidate of league) {
    if (inRotation.has(candidate.key)) continue
    let best: Fix | null = null
    for (const seat of seats) {
      if (opts.similar && !similarRole(candidate, seat)) continue
      const roster = team.players.map((p) => (p.id === seat.id ? candidate : p))
      const delta = scoreRotation(team, roster, rules).wastedFitPct - base
      if (!best || delta < best.delta) best = { seat, delta }
    }
    if (best) out.set(candidate.id, best)
  }
  return out
}

function useFirstVisit(): [boolean, () => void] {
  const [fresh, setFresh] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === null
    } catch {
      return false
    }
  })
  const dismiss = () => {
    setFresh(false)
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // storage blocked: the caption simply returns next visit
    }
  }
  return [fresh, dismiss]
}

export function TeamView({
  data,
  team,
  fits,
  ranks,
  rules,
  customRules,
  mode,
  textured,
  swap,
  projected = false,
  onSwap,
  onRules,
}: {
  data: League
  team: Team
  fits: TeamFit[]
  ranks: Map<string, number>
  rules: Rules
  customRules: boolean
  mode: Mode
  textured: boolean
  swap: { out: Player; in: Player } | null
  /** a projected season: no record, no lineups, and unscored players named */
  projected?: boolean
  onSwap: (s: { out: Player; in: Player } | null) => void
  onRules: (r: Rules) => void
}) {
  const [assembly, setAssembly] = useState<Assembly>('exploded')
  const [highlight, setHighlight] = useState<Highlight>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [picked, setPicked] = useState<Player | null>(null)
  const [dragging, setDragging] = useState<Player | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [swapSeat, setSwapSeat] = useState<string | null>(null)
  const [similar, setSimilar] = useState(true)
  const [fresh, dismissIntro] = useFirstVisit()

  // what the pointer is on right now, so a pointermove only moves the readout
  const hovering = useRef<string | null>(null)

  // the one orchestrated moment: the board assembles itself on arrival
  useEffect(() => {
    const id = window.setTimeout(() => setAssembly('assembled'), fresh ? 1400 : 420)
    return () => window.clearTimeout(id)
    // only on arrival; the caption being dismissed must not re-run it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roster = useMemo(
    () =>
      swap ? team.players.map((p) => (p.id === swap.out.id ? swap.in : p)) : team.players,
    [team, swap],
  )

  const slots = useMemo(() => {
    const map = new SlotMap([...team.players].sort((a, b) => b.load - a.load).map((p) => p.id))
    if (swap) map.replace(swap.out.id, swap.in.id)
    return map
  }, [team, swap])

  // Shared floor time, for painting each notch by who actually plays beside
  // him. A swapped-in player takes over the minutes of the seat he fills.
  const overlap = useMemo(() => {
    if (!team.overlap) return undefined
    const seatOf = (id: string) => (swap && id === swap.in.id ? swap.out.id : id)
    const table = team.overlap
    return (a: string, b: string) => table[seatOf(a)]?.[seatOf(b)]
  }, [team, swap])

  const baseline = useMemo(() => scoreRotation(team, team.players, rules), [team, rules])
  const fit = useMemo(() => scoreRotation(team, roster, rules), [team, roster, rules])
  const focus = useMemo(() => focusOf(fit, highlight), [fit, highlight])
  // about 3,000 rotations to score; deferred so a rules slider never waits on it
  const lazyRules = useDeferredValue(rules)
  const fixes = useMemo(
    () => bestFixes(team, data.league, lazyRules, { seat: swapSeat, similar }),
    [team, data.league, lazyRules, swapSeat, similar],
  )

  const rosterKeys = useMemo(() => new Set(roster.map((p) => p.key)), [roster])
  const chosen = selected ? fit.shapes.find((s) => s.player.id === selected) ?? null : null

  const seat = (seatId: string) => {
    const incoming = dragging ?? picked
    if (!incoming) return
    const out = roster.find((p) => p.id === seatId)
    if (!out || out.key === incoming.key) return
    onSwap({ out: team.players.find((p) => p.id === seatId) ?? out, in: incoming })
    setSelected(null)
    setPicked(null)
    setDragging(null)
    setDropTarget(null)
  }

  const clearHover = () => {
    hovering.current = null
    setHighlight(null)
    tooltip.hide()
  }

  const hoverPlayer = (id: string | null, at?: { x: number; y: number }) => {
    if (dragging) {
      setDropTarget(id)
      return
    }
    if (!id) return clearHover()
    if (hovering.current === `p:${id}`) {
      if (at) tooltip.move(at)
      return
    }
    hovering.current = `p:${id}`
    setHighlight({ kind: 'player', id })
    const shape = fit.shapes.find((s) => s.player.id === id)
    if (!shape) return
    const supplies = (
      ['shooting', 'interior', 'perimeterD', 'ballDominance', 'noCreator'] as Channel[]
    ).flatMap((c) => {
      const r = channel(fit, c)
      const found = r.suppliers.find((s) => s.id === id)
      // supplying a channel nobody needs repairs nothing
      return found && r.demand > 1e-9 ? [{ c, share: found.share }] : []
    })
    tooltip.show(
      <>
        <div className="tip-title">{shape.player.name}</div>
        <dl>
          <dt>Possessions</dt>
          <dd>{shape.player.load.toFixed(1)}%</dd>
          <dt>Shooting</dt>
          <dd>{Math.round(shape.player.pct.shooting)}</dd>
          <dt>Interior</dt>
          <dd>{Math.round(shape.player.pct.interior)}</dd>
          <dt>Perimeter D</dt>
          <dd>{Math.round(shape.player.pct.perimeterD)}</dd>
        </dl>
        {supplies.length > 0 && (
          <div style={{ marginTop: 'calc(var(--step) * 1.5)' }}>
            Repairs{' '}
            {supplies
              .map((s) => `${SLOT_LABEL[CHANNEL_SLOT[s.c]]} ${Math.round(s.share * 100)}%`)
              .join(', ')}
          </div>
        )}
        <div style={{ marginTop: 'calc(var(--step) * 1.5)', color: 'var(--ink-3)' }}>
          Click for the full profile
        </div>
      </>,
      at,
    )
  }

  const hoverChannel = (c: Channel | null, at?: { x: number; y: number }) => {
    if (dragging) return
    if (!c) return clearHover()
    if (hovering.current === `c:${c}`) {
      if (at) tooltip.move(at)
      return
    }
    hovering.current = `c:${c}`
    setHighlight({ kind: 'channel', channel: c })
    const r = channel(fit, c)
    tooltip.show(
      <>
        <div className="tip-title">
          {SLOT_LABEL[CHANNEL_SLOT[c]]} · {Math.round(r.fill * 100)}% covered
        </div>
        {r.suppliers.length === 0 ? (
          <div>Nobody on the roster supplies this.</div>
        ) : (
          r.suppliers.slice(0, 6).map((s) => {
            const who = fit.shapes.find((x) => x.player.id === s.id)
            return (
              <div className="tip-row" key={s.id}>
                <span className="key" style={{ background: slots.color(s.id, mode) }} />
                <span>{who ? surname(who.player.name) : s.id}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 500 }}>
                  {Math.round(s.share * 100)}%
                </span>
              </div>
            )
          })
        )}
        {r.presence < 1 && (
          <div style={{ marginTop: 'calc(var(--step) * 1.5)' }}>
            Suppliers on the floor {Math.round(r.presence * 100)}% of the game, so coverage
            stops at {Math.round(r.fill * 100)}% of the {Math.round(r.capacity * 100)}% they
            could reach.
          </div>
        )}
        <div style={{ marginTop: 'calc(var(--step) * 1.5)', color: 'var(--ink-3)' }}>
          {wastePoints(fit, c).toFixed(1)} points of exposure
        </div>
      </>,
      at,
    )
  }

  const pick = (id: string) => {
    if (picked) return seat(id)
    setSelected((cur) => (cur === id ? null : id))
  }

  const label = rankLabel(ranks, team.abbr)

  return (
    <>
      <div className="team-head">
        <h1>{team.name}</h1>
        <span className="record">
          {projected ? `${data.season} projected` : `${team.wins}-${team.losses}`}
        </span>
      </div>

      {fresh && (
        <div className="intro" role="note">
          <p>
            Each piece is one player, sized by his share of possessions. His weaknesses cut
            notches; teammates' strengths fill them in their colors.{' '}
            <b>Whatever nobody covers stays striped</b> — that striped share is the team's
            exposure.
          </p>
          <button type="button" className="ghost" onClick={dismissIntro}>
            Got it
          </button>
        </div>
      )}

      {/* Row one: the picture and its number, sized to sit side by side. */}
      <div className="team-layout">
        <div>
          <div
            className="mat"
            onDragLeave={() => setDropTarget(null)}
            onDragOver={(e) => e.preventDefault()}
          >
            <Board
              fit={fit}
              rules={rules}
              slots={slots}
              mode={mode}
              assembly={assembly}
              focus={focus}
              textured={textured}
              dropTarget={dropTarget}
              selected={selected}
              overlap={overlap}
              onHoverPlayer={hoverPlayer}
              onHoverChannel={hoverChannel}
              onPickPlayer={pick}
              onDropOnPlayer={seat}
            />
          </div>

          <div className="board-tools">
            <div className="tabs" role="group" aria-label="Board state">
              <button
                type="button"
                aria-current={assembly === 'exploded' ? 'page' : undefined}
                onClick={() => setAssembly('exploded')}
              >
                Exploded
              </button>
              <button
                type="button"
                aria-current={assembly === 'assembled' ? 'page' : undefined}
                onClick={() => setAssembly('assembled')}
              >
                Assembled
              </button>
            </div>
            <span className="legend">
              <span>
                <svg className="stripe-key" viewBox="0 0 16 16" aria-hidden="true">
                  <rect width="16" height="16" fill="var(--void)" />
                  <rect width="16" height="16" fill="url(#waste-hatch)" />
                </svg>
                Nobody covers it
              </span>
              <span>
                <svg className="stripe-key" viewBox="0 0 16 16" aria-hidden="true">
                  <rect width="16" height="16" fill="var(--void)" />
                  <rect width="16" height="16" fill="url(#credit-dots)" />
                </svg>
                Paid back by spacing
              </span>
              {(['shooting', 'interior', 'perimeterD', 'noCreator', 'ball'] as const).map((s) => (
                <span key={s}>
                  <span className="letter-key" aria-hidden="true">
                    {SLOT_LETTER[s]}
                  </span>
                  {SLOT_LABEL[s]}
                </span>
              ))}
            </span>
          </div>

          <p className="pooled-note">
            {team.overlap
              ? 'Each notch is painted by the teammates who share the floor with that player, weighted by their minutes together; how full it is comes from the whole rotation. Every notch is drawn to scale, so the stripes add up to the exposure figure. Point at a player to see only his share.'
              : 'Coverage is pooled across the rotation, so the painted colors show who supplies the skill, not a one-to-one assignment. Every notch is drawn to scale, so the stripes add up to the exposure figure. Point at a player to see only his share.'}
          </p>
        </div>

        <div className="rail">
          <div className="hero">
            <span className="figure">{fit.wastedFitPct.toFixed(1)}%</span>
            <span className="figure-label">exposure{swap ? ' with the swap' : ''}</span>
            <span className="figure-rank">
              {swap
                ? `${baseline.wastedFitPct.toFixed(1)}% as built, ${ordinal(label)} of 30`
                : `${ordinal(label)} of 30${customRules ? ' on your rules' : ''}`}
            </span>
            <ExposureStrip fits={fits} abbr={team.abbr} value={fit.wastedFitPct} />
          </div>

          <section>
            <h3>What is covered</h3>
            <Breakdown fit={fit} highlight={highlight} onHighlight={setHighlight} />
            {projected ? (
              <Unscored fit={fit} names={team.unscored ?? []} />
            ) : (
              <Availability fit={fit} />
            )}
          </section>
        </div>
      </div>

      {/* Row two: the working surface. Who is on the board, who you are
          looking at, and who could replace him, all in view at once rather
          than stacked a screen below the picture. */}
      <div className="team-work">
        <section>
          <h3>Rotation</h3>
          <Roster
            fit={fit}
            slots={slots}
            mode={mode}
            highlight={highlight}
            selected={selected}
            onHighlight={(h) => (dragging ? undefined : setHighlight(h))}
            onSelect={pick}
            onDropOnPlayer={seat}
            dropTarget={dropTarget}
          />
        </section>

        <section className="chosen">
          {chosen ? (
            <>
              <h3>
                <span>{chosen.player.name}</span>
                <button
                  type="button"
                  className="close"
                  aria-label={`Close ${chosen.player.name}'s profile`}
                  onClick={() => setSelected(null)}
                >
                  ×
                </button>
              </h3>
              <PlayerPanel fit={fit} shape={chosen} rules={rules} />
            </>
          ) : (
            <>
              <h3>Player</h3>
              <p className="pooled-note" style={{ marginTop: 0 }}>
                Click a piece or a name for the full profile: usage, the skill percentiles
                behind each notch, and who covers for him.
              </p>
            </>
          )}
        </section>

        <section>
          <h3>Swap a player</h3>
          {swap && (
            <SwapReadout
              before={baseline}
              after={fit}
              swap={swap}
              onRevert={() => onSwap(null)}
            />
          )}
          <CandidateList
            league={data.league}
            rosterKeys={rosterKeys}
            picked={picked}
            fixes={fixes}
            seats={[...team.players].sort((a, b) => b.load - a.load)}
            seat={swapSeat}
            similar={similar}
            onSeat={setSwapSeat}
            onSimilar={setSimilar}
            onPick={setPicked}
            onDragPlayer={setDragging}
            onApply={(p, seatPlayer) => onSwap({ out: seatPlayer, in: p })}
          />
        </section>
      </div>

      <Lineups
        team={team}
        pool={data.league}
        rules={rules}
        slots={slots}
        mode={mode}
      />

      <div className="folds">
        <details>
          <summary>
            How to read a piece <span className="hint">the key</span>
          </summary>
          <div className="fold-body">
            <Key />
          </div>
        </details>

        <details>
          <summary>
            Every number on this board <span className="hint">table view</span>
          </summary>
          <div className="fold-body">
            <RosterTable fit={fit} />
          </div>
        </details>

        <details>
          <summary>
            Fit rules <span className="hint">the constants, live</span>
          </summary>
          <div className="fold-body">
            <RulesPanel rules={rules} onChange={onRules} />
          </div>
        </details>

        <details>
          <summary>
            Method, and what is still wrong with it
            <span className="hint">sources and open problems</span>
          </summary>
          <div className="fold-body">
            <Methodology data={data} />
          </div>
        </details>
      </div>
    </>
  )
}
