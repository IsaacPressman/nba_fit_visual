/**
 * The 2026-27 projection: next season's rosters, scored on 2025-26 play. The
 * promise is narrow — every player is exactly his 2025-26 self on a new team —
 * so that is what is checked. Skipped if the projection has not been built.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoreLeague } from './model'
import type { League } from './types'

const PROJECTED = resolve(__dirname, '../../public/league-2026-27.json')
const have = existsSync(PROJECTED)
const next = have ? (JSON.parse(readFileSync(PROJECTED, 'utf8')) as League) : null
const now = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/league.json'), 'utf8'),
) as League

describe.skipIf(!have)('2026-27 projection', () => {
  const league = next!

  it('is marked as a projection of 2025-26, with a full rotation for all 30 teams', () => {
    expect(league.season).toBe('2026-27')
    expect(league.projected).toBe(true)
    expect(league.basedOn).toBe(now.season)
    expect(league.teams).toHaveLength(30)
    for (const t of league.teams) {
      expect(t.players).toHaveLength(league.rotationSize)
      expect(t.wins + t.losses).toBe(0)
    }
  })

  it('puts every rotation player on the team that rosters him, and on no other', () => {
    const seen = new Map<string, string>()
    for (const t of league.teams) {
      for (const p of t.players) {
        expect(p.team).toBe(t.abbr)
        expect(p.id).toBe(`${p.key}|${t.abbr}`)
        expect(seen.has(p.key)).toBe(false)
        seen.set(p.key, t.abbr)
      }
    }
  })

  it('carries each player’s 2025-26 skills over unchanged', () => {
    const before = new Map(now.league.map((p) => [p.key, p]))
    for (const t of league.teams) {
      for (const p of t.players) {
        const old = before.get(p.key)
        if (p.smallSample) {
          // below the 2025-26 pool, so there is no pool entry to compare with
          expect(old).toBeUndefined()
          continue
        }
        expect(old, `${p.name} should be in the 2025-26 pool`).toBeDefined()
        expect(p.pct).toEqual(old!.pct)
        expect(p.raw.epm).toBe(old!.raw.epm)
        expect(p.usg).toBe(old!.usg)
      }
    }
  })

  it('scores injury-shortened veterans only on a real, if small, 2025-26 sample', () => {
    const small = league.teams.flatMap((t) => t.players).filter((p) => p.smallSample)
    for (const p of small) {
      expect(p.raw.seasonMin).toBeGreaterThanOrEqual(250)
      expect(p.raw.seasonMin).toBeLessThan(now.pool.minMinutes)
    }
    const was = league.teams.find((t) => t.abbr === 'WAS')!
    expect(was.players.some((p) => p.key === 'traeyoung' && p.smallSample)).toBe(true)
  })

  it('picks each rotation by 2025-26 minutes per game', () => {
    for (const t of league.teams) {
      const mpg = t.players.map((p) => p.mpg)
      expect([...mpg].sort((a, b) => b - a)).toEqual(mpg)
    }
  })

  it('names the rostered players it could not score instead of dropping them silently', () => {
    const total = league.teams.reduce((n, t) => n + (t.unscored?.length ?? 0), 0)
    expect(total).toBeGreaterThan(0)
    for (const t of league.teams) expect(Array.isArray(t.unscored)).toBe(true)
  })

  it('scores like any other season', () => {
    for (const f of scoreLeague(league.teams)) {
      expect(Number.isFinite(f.wastedFitPct)).toBe(true)
      expect(f.wastedFitPct).toBeGreaterThan(0)
    }
  })
})
