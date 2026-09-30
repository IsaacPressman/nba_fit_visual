/**
 * Drag to swap, section 5.3.
 *
 * Drag any league player onto a piece or a roster row to replace the man there.
 * Dragging is the nice way to do it; picking a player and then a seat is the
 * way that works on a phone and from a keyboard, so both are wired to the same
 * handler. The readout shows the before and after side by side, and lists only
 * the breakdown rows that actually moved.
 *
 * With the search empty the list is a suggestion: everyone in the league,
 * ordered by how much exposure he would close in his best seat here — or in
 * the one seat being replaced, if a seat is chosen. The model loves rim
 * protection, so left alone it would hand every team a center for its worst
 * player; choosing the seat, and keeping to players with similar minutes and
 * usage, keeps the suggestions to swaps a front office might actually make.
 */
import { useMemo, useState } from 'react'
import { channel, wastePoints } from '../fit/model'
import { surname } from '../fit/palette'
import { CHANNELS, type Channel, type Player, type TeamFit } from '../fit/types'

/** A candidate's best seat on this roster, and what it does to exposure. */
export interface Fix {
  seat: Player
  delta: number
}

/** Within this many minutes per game and usage points counts as a similar role. */
export const SIMILAR = { mpg: 6, usg: 4 }

export const similarRole = (a: Player, b: Player) =>
  Math.abs(a.mpg - b.mpg) <= SIMILAR.mpg && Math.abs(a.usg - b.usg) <= SIMILAR.usg

const NAME: Record<Channel, string> = {
  shooting: 'Shooting',
  interior: 'Interior',
  perimeterD: 'Perimeter D',
  ballDominance: 'Ball dominance',
  noCreator: 'Nobody creating',
}

export function CandidateList({
  league,
  rosterKeys,
  picked,
  fixes,
  seats,
  seat,
  similar,
  onSeat,
  onSimilar,
  onPick,
  onDragPlayer,
  onApply,
}: {
  league: Player[]
  rosterKeys: Set<string>
  picked: Player | null
  /** best seat per eligible candidate id */
  fixes: Map<string, Fix>
  /** the rotation as built, for the seat picker */
  seats: Player[]
  seat: string | null
  similar: boolean
  onSeat: (id: string | null) => void
  onSimilar: (on: boolean) => void
  onPick: (p: Player | null) => void
  onDragPlayer: (p: Player | null) => void
  onApply: (p: Player, seat: Player) => void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = league.filter((p) => !rosterKeys.has(p.key))
    // a search finds anyone; the suggestion list shows only eligible players
    const hits = q
      ? pool.filter(
          (p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q,
        )
      : pool.filter((p) => fixes.has(p.id))
    const gain = (p: Player) => fixes.get(p.id)?.delta ?? Infinity
    return [...hits].sort((a, b) => gain(a) - gain(b)).slice(0, 60)
  }, [league, rosterKeys, query, fixes])

  return (
    <div>
      <div className="swap-controls">
        <label>
          Replace{' '}
          <select
            className="picker"
            value={seat ?? ''}
            onChange={(e) => onSeat(e.target.value || null)}
          >
            <option value="">anyone</option>
            {seats.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={similar}
            onChange={(e) => onSimilar(e.target.checked)}
          />
          Similar minutes and usage
        </label>
      </div>
      <label htmlFor="swap-search" className="visually-hidden">
        Search the league
      </label>
      <input
        id="swap-search"
        className="search"
        type="search"
        placeholder="Name, or a team like MIL"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length === 0 ? (
        <p className="pooled-note">
          {query.trim()
            ? 'Nobody in the pool matches that. Try a surname, or a three-letter team code.'
            : 'Nobody in the league plays a similar role to that seat. Untick the filter to see everyone.'}
        </p>
      ) : (
        <ul className="candidates">
          {matches.map((p) => {
            const fix = fixes.get(p.id)
            const helps = fix && fix.delta <= -0.05
            return (
              <li key={p.id} className="candidate-row">
                <button
                  type="button"
                  className="candidate"
                  data-selected={picked?.id === p.id}
                  draggable
                  onDragStart={() => onDragPlayer(p)}
                  onDragEnd={() => onDragPlayer(null)}
                  onClick={() => onPick(picked?.id === p.id ? null : p)}
                >
                  <span className="who">{p.name}</span>
                  <span className="where">
                    {p.team} · {p.mpg.toFixed(1)} mpg · {p.usg.toFixed(1)} usg
                  </span>
                </button>
                {helps && (
                  <button
                    type="button"
                    className="fix"
                    title={`Seat ${p.name} for ${fix.seat.name}`}
                    onClick={() => onApply(p, fix.seat)}
                  >
                    {fix.delta.toFixed(1)} for {surname(fix.seat.name)}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="pooled-note">
        {picked
          ? `${picked.name} is ready. Click a piece or a roster row to put him in that seat.`
          : `Sorted by the exposure each would close ${
              seat ? 'in that seat' : 'in his best seat'
            }; click the figure to try it. Or drag any name onto a piece.`}
      </p>
    </div>
  )
}

export function SwapReadout({
  before,
  after,
  swap,
  onRevert,
}: {
  before: TeamFit
  after: TeamFit
  swap: { out: Player; in: Player }
  onRevert: () => void
}) {
  const delta = after.wastedFitPct - before.wastedFitPct
  const moved = CHANNELS.map((c) => ({
    c,
    from: wastePoints(before, c),
    to: wastePoints(after, c),
    fillFrom: channel(before, c).fill,
    fillTo: channel(after, c).fill,
  })).filter((m) => Math.abs(m.to - m.from) >= 0.05)

  return (
    <div>
      <div className="ba">
        <span className="side">
          <span className="label">Before</span>
          <span className="value">{before.wastedFitPct.toFixed(1)}%</span>
        </span>
        <span className="side">
          <span className="label">
            With {surname(swap.in.name)} for {surname(swap.out.name)}
          </span>
          <span className="value">{after.wastedFitPct.toFixed(1)}%</span>
        </span>
      </div>

      <p className="delta" style={{ marginTop: 'calc(var(--step) * 3)' }}>
        {Math.abs(delta) < 0.05 ? (
          <span>No change worth reading.</span>
        ) : (
          <span style={{ color: delta < 0 ? 'var(--good)' : 'var(--ink)' }}>
            {delta < 0 ? 'Closes' : 'Opens'} {Math.abs(delta).toFixed(1)} points of exposure.
          </span>
        )}
      </p>

      {moved.length > 0 && (
        <ul className="moved">
          {moved.map((m) => (
            <li key={m.c}>
              <span>
                {NAME[m.c]} {Math.round(m.fillFrom * 100)}% → {Math.round(m.fillTo * 100)}%
                covered
              </span>
              <span>
                {m.from.toFixed(1)} → {m.to.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="ghost"
        style={{ marginTop: 'calc(var(--step) * 4)', borderColor: 'var(--rule)' }}
        onClick={onRevert}
      >
        Put {surname(swap.out.name)} back
      </button>
    </div>
  )
}
