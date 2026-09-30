import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scoreRotation } from '../fit/model'
import type { League } from '../fit/types'
import { notchSuppliers } from './Board'

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/league.json'), 'utf8'),
) as League

describe('notchSuppliers: who paints one player’s notch', () => {
  const team = data.teams.find((t) => t.abbr === 'OKC')!
  const fit = scoreRotation(team)
  // a channel and a player whose notch on it has more than one supplier
  const [c, piece] = (['shooting', 'interior', 'perimeterD', 'noCreator'] as const)
    .flatMap((ch) =>
      fit.shapes
        .filter((s) => (fit.charges[s.player.id][ch] ?? 0) > 0)
        .map((s) => [ch, s.player.id] as const),
    )
    .find(([ch, id]) => notchSuppliers(fit, ch, id).length > 1)!

  it('falls back to the pooled shares without overlap data', () => {
    const pooled = notchSuppliers(fit, c, piece)
    expect(pooled.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 8)
    expect(pooled.some((s) => s.id === piece)).toBe(false)
  })

  it('shifts paint toward the teammates who share the floor with him', () => {
    const pooled = notchSuppliers(fit, c, piece)
    const favourite = pooled[pooled.length - 1].id
    // pretend he only ever plays beside the smallest pooled supplier
    const onlyOne = (a: string, b: string) => (a === piece && b === favourite ? 1000 : 1)
    const shifted = notchSuppliers(fit, c, piece, onlyOne)
    expect(shifted[0].id).toBe(favourite)
    expect(shifted.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 8)
  })

  it('keeps the pooled shares when a pairing is missing from the data', () => {
    const gappy = () => undefined
    expect(notchSuppliers(fit, c, piece, gappy)).toEqual(notchSuppliers(fit, c, piece))
  })

  it('reads real shared minutes from the bundle when they are there', () => {
    if (!team.overlap) return
    const real = (a: string, b: string) => team.overlap![a]?.[b]
    const shares = notchSuppliers(fit, c, piece, real)
    expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 8)
  })
})
