/**
 * The team's most-used five-man lineups, each as its own small board.
 *
 * The main board pools eight players across the season, but fit happens five
 * at a time. Each lineup here is scored on its own — all five on the floor
 * together, so every one plays the full 48 minutes and usage sets his weight —
 * which is the same way the lineup validation scores them. Rotation players
 * keep their colors from the main board; anyone outside the top eight is drawn
 * in the neutral tone, which is itself worth seeing: a lineup the coach leaned
 * on that the season-minutes rotation does not contain.
 */
import { useMemo } from 'react'
import { focusOf } from '../fit/highlight'
import { scoreRotation } from '../fit/model'
import type { Mode, SlotMap } from '../fit/palette'
import type { Player, Rules, Team, TeamFit } from '../fit/types'
import { Board } from './Board'

export function Lineups({
  team,
  pool,
  rules,
  slots,
  mode,
}: {
  team: Team
  pool: Player[]
  rules: Rules
  slots: SlotMap
  mode: Mode
}) {
  const boards = useMemo(() => {
    const byKey = new Map<string, Player>()
    for (const p of pool) if (!byKey.has(p.key)) byKey.set(p.key, p)
    // a rotation player is drawn as himself, with this team's usage and his seat color
    for (const p of team.players) byKey.set(p.key, p)

    return (team.lineups ?? []).flatMap((l) => {
      const five = l.keys.map((k) => byKey.get(k))
      if (five.some((p) => !p)) return []
      const players = (five as Player[]).map((p) => ({ ...p, mpg: 48, load: p.usg }))
      const fit: TeamFit = scoreRotation(team, players, rules)
      const outside = (five as Player[]).filter((p) => !slots.has(p.id))
      return [{ minutes: l.minutes, fit, outside }]
    })
  }, [team, pool, rules, slots])

  if (boards.length === 0) return null

  return (
    <section className="lineups">
      <h3>
        Most-used lineups
        <span className="hint">
          fit happens five at a time; each scored as if its five share the floor
        </span>
      </h3>
      <ol className="lineup-row">
        {boards.map((b, i) => (
          <li key={i} className="lineup-card">
            <div className="lineup-mat">
              <Board
                fit={b.fit}
                rules={rules}
                slots={slots}
                mode={mode}
                assembly="assembled"
                focus={focusOf(b.fit, null)}
                layout="wide"
              />
            </div>
            <div className="lineup-meta">
              <span>{b.minutes} min together</span>
              <span className="lineup-exposure">{b.fit.wastedFitPct.toFixed(1)}% exposed</span>
            </div>
            {b.outside.length > 0 && (
              <div className="lineup-note">
                {/* full names: a surname alone can collide with a rotation player's */}
                With {b.outside.map((p) => p.name).join(', ')}, outside the top eight
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
