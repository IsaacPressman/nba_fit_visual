/**
 * The five breakdown rows, section 3.2: covered share and points of waste for
 * Shooting, Interior, Perimeter D, Ball dominance and Nobody creating.
 *
 * Hovering a row highlights the notches it cuts and the players filling them,
 * which is the same link the board offers in the other direction.
 *
 * Nobody creating is only shown when it charges something. On the default
 * rules the creators' side always binds first, so it reads 0 for all thirty
 * teams; the methodology says so, and a row that never moves is just noise.
 * Moving the rules can wake it, and then it comes back.
 */
import { SLOT_LETTER } from '../fit/geometry'
import { CHANNEL_SLOT, type Highlight } from '../fit/highlight'
import { channel, wastePoints } from '../fit/model'
import { CHANNELS, type Channel, type TeamFit } from '../fit/types'

const NAME: Record<Channel, string> = {
  shooting: 'Shooting',
  interior: 'Interior',
  perimeterD: 'Perimeter D',
  ballDominance: 'Ball dominance',
  noCreator: 'Nobody creating',
}

const WHAT: Record<Channel, string> = {
  shooting: 'notches from poor shooters, filled by teammates who shoot',
  interior: 'notches from poor rebounding and rim protection',
  perimeterD: 'notches from poor perimeter defenders',
  ballDominance: 'usage that needs the ball, against the room on offer',
  noCreator: 'low-usage players waiting for someone to create',
}

export function Breakdown({
  fit,
  highlight,
  onHighlight,
}: {
  fit: TeamFit
  highlight: Highlight
  onHighlight: (h: Highlight) => void
}) {
  return (
    <>
      <table className="breakdown">
        <caption className="visually-hidden">Exposure by channel</caption>
        <thead>
          <tr>
            <th scope="col">Channel</th>
            <th scope="col" style={{ width: '26%' }}>
              Covered
            </th>
            <th scope="col" className="num">
              %
            </th>
            <th scope="col" className="num" title="Share of the game a supplier of this skill is on the floor">
              Floor
            </th>
            <th scope="col" className="num">
              Exposure
            </th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.filter((c) => c !== 'noCreator' || wastePoints(fit, c) >= 0.05).map((c) => {
            const r = channel(fit, c)
            const pts = wastePoints(fit, c)
            const active =
              highlight?.kind === 'channel' && highlight.channel === c
            const inert = r.demand <= 1e-9
            return (
              <tr
                key={c}
                data-active={active}
                onPointerEnter={() => onHighlight({ kind: 'channel', channel: c })}
                onPointerLeave={() => onHighlight(null)}
                onFocus={() => onHighlight({ kind: 'channel', channel: c })}
                onBlur={() => onHighlight(null)}
                tabIndex={0}
                title={
                  r.presence < 1 && !inert
                    ? `${WHAT[c]}. Suppliers on the floor ${Math.round(r.presence * 100)}% of the game.`
                    : WHAT[c]
                }
              >
                <td>
                  <span className="channel">
                    <span className="letter-key" aria-hidden="true">
                      {SLOT_LETTER[CHANNEL_SLOT[c]]}
                    </span>
                    {NAME[c]}
                  </span>
                </td>
                <td>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${(inert ? 1 : r.fill) * 100}%` }} />
                    {/* where coverage would sit if the suppliers never came off:
                        the gap back to the fill is the minutes problem */}
                    {!inert && r.capacity - r.fill > 0.02 && (
                      <b style={{ left: `${r.capacity * 100}%` }} />
                    )}
                  </span>
                </td>
                <td className="num">{inert ? '—' : `${Math.round(r.fill * 100)}%`}</td>
                <td className="num" style={{ color: 'var(--ink-3)' }}>
                  {inert || r.presence >= 1 ? '—' : `${Math.round(r.presence * 100)}%`}
                </td>
                <td className="num">{pts < 0.05 ? '0' : pts.toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ fontWeight: 500 }}>
              Exposure
            </td>
            <td className="num" style={{ fontWeight: 600 }}>
              {fit.wastedFitPct.toFixed(1)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="table-note">
        <b>Floor</b> is how much of the game at least one supplier of that skill is playing.
        Coverage cannot go past it; the tick on a bar marks where coverage would reach if the
        suppliers never sat.
      </p>
    </>
  )
}
