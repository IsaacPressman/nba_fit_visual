/**
 * The roster list, section 4.4. It doubles as the board's legend: a color
 * swatch beside every name is the dependable identity channel that hue alone
 * cannot be, and the tags say in words what the piece says in shape.
 */
import { channelDepth, type Highlight } from '../fit/highlight'
import type { SlotMap } from '../fit/palette'
import { surname } from '../fit/palette'
import type { Mode } from '../fit/palette'
import { SKILLS, type Shape, type Skill, type TeamFit } from '../fit/types'

const SKILL_NAME: Record<Skill, string> = {
  shooting: 'shooting',
  interior: 'interior',
  perimeterD: 'perimeter D',
}

interface Tag {
  text: string
  kind: 'notch' | 'strength' | 'ball'
}

export function tagsFor(shape: Shape): Tag[] {
  const tags: Tag[] = []
  if (shape.tab > 0) tags.push({ text: 'ball-dominant', kind: 'ball' })
  for (const k of SKILLS) {
    if (shape.notch[k] > 0) tags.push({ text: `no ${SKILL_NAME[k]}`, kind: 'notch' })
  }
  for (const k of SKILLS) {
    if (shape.strength[k] > 0) tags.push({ text: SKILL_NAME[k], kind: 'strength' })
  }
  if (shape.lowNotch > 0) tags.push({ text: 'needs a creator', kind: 'notch' })
  return tags
}

export function Roster({
  fit,
  slots,
  mode,
  highlight,
  selected,
  onHighlight,
  onSelect,
  onDropOnPlayer,
  dropTarget,
}: {
  fit: TeamFit
  slots: SlotMap
  mode: Mode
  highlight: Highlight
  selected: string | null
  onHighlight: (h: Highlight) => void
  onSelect: (id: string) => void
  onDropOnPlayer?: (id: string) => void
  dropTarget?: string | null
}) {
  const ordered = [...fit.shapes].sort((a, b) => b.player.load - a.player.load)

  return (
    <ul className="roster">
      {ordered.map((shape) => {
        const id = shape.player.id
        const active =
          selected === id ||
          (highlight?.kind === 'player' && highlight.id === id) ||
          dropTarget === id
        return (
          <li key={id}>
            <button
              type="button"
              className="roster-row"
              data-active={active}
              onPointerEnter={() => onHighlight({ kind: 'player', id })}
              onPointerLeave={() => onHighlight(null)}
              onFocus={() => onHighlight({ kind: 'player', id })}
              onBlur={() => onHighlight(null)}
              onClick={() => onSelect(id)}
              onDragOver={
                onDropOnPlayer
                  ? (e) => {
                      e.preventDefault()
                      onHighlight({ kind: 'player', id })
                    }
                  : undefined
              }
              onDrop={
                onDropOnPlayer
                  ? (e) => {
                      e.preventDefault()
                      onDropOnPlayer(id)
                    }
                  : undefined
              }
            >
              <span
                className="chip"
                style={{ background: slots.color(id, mode) }}
                aria-hidden="true"
              />
              <span className="roster-name">
                <span className="who">{shape.player.name}</span>
                <span className="tags">
                  {tagsFor(shape).map((t) => (
                    <span className="tag" data-kind={t.kind} key={t.text}>
                      {t.text}
                    </span>
                  ))}
                </span>
              </span>
              <span className="roster-load">{shape.player.load.toFixed(1)}%</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The table view of the board: every number without hovering for it. */
export function RosterTable({ fit }: { fit: TeamFit }) {
  const ordered = [...fit.shapes].sort((a, b) => b.player.load - a.player.load)
  return (
    <div className="scroll-x">
      <table className="data-table">
        <caption>
          Percentiles run against every player with 500 or more minutes. Notch
          depths are fractions of the piece's side.
        </caption>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Load</th>
            <th scope="col">Usg</th>
            <th scope="col">MPG</th>
            <th scope="col">Sho</th>
            <th scope="col">Int</th>
            <th scope="col">Play</th>
            <th scope="col">Per D</th>
            <th scope="col">Notch S</th>
            <th scope="col">Notch I</th>
            <th scope="col">Notch D</th>
            <th scope="col">Notch C</th>
            <th scope="col">Notch B</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.player.id}>
              <td>{surname(s.player.name)}</td>
              <td>{s.player.load.toFixed(1)}</td>
              <td>{s.player.usg.toFixed(1)}</td>
              <td>{s.player.mpg.toFixed(1)}</td>
              <td>{Math.round(s.player.pct.shooting)}</td>
              <td>{Math.round(s.player.pct.interior)}</td>
              <td>{Math.round(s.player.pct.playmaking)}</td>
              <td>{Math.round(s.player.pct.perimeterD)}</td>
              <td>{s.notch.shooting.toFixed(2)}</td>
              <td>{s.notch.interior.toFixed(2)}</td>
              <td>{s.notch.perimeterD.toFixed(2)}</td>
              <td>{s.lowNotch.toFixed(2)}</td>
              <td>{s.tab.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { channelDepth }
