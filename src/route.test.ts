import { describe, expect, it } from 'vitest'
import { rankLabel } from './fit/model'
import { DEFAULT_RULES } from './fit/types'
import { formatRoute, parseRoute } from './route'

describe('route', () => {
  it('lands on the league grid on an empty hash', () => {
    expect(parseRoute('', 'OKC')).toEqual({
      view: 'league',
      team: 'OKC',
      swap: null,
      rules: DEFAULT_RULES,
    })
  })

  it('adds nothing to the URL for untouched rules', () => {
    expect(formatRoute({ view: 'team', team: 'BOS', swap: null, rules: DEFAULT_RULES })).toBe(
      '#/team/BOS',
    )
    expect(formatRoute({ view: 'chart', team: 'BOS', swap: null, rules: DEFAULT_RULES })).toBe(
      '#/chart',
    )
  })

  it('round-trips a swap and moved rules', () => {
    const route = {
      view: 'team' as const,
      team: 'BOS',
      swap: { out: 'jaylenbrown|BOS', in: 'amenthompson|HOU' },
      rules: {
        ...DEFAULT_RULES,
        needPivot: 45,
        coverage: { ...DEFAULT_RULES.coverage, weakestLinkD: 0.8 },
      },
    }
    const hash = formatRoute(route)
    expect(hash).toContain('swap=jaylenbrown|BOS~amenthompson|HOU')
    expect(parseRoute(hash, 'OKC')).toEqual(route)
  })

  it('ignores a malformed rules payload and unknown keys', () => {
    expect(parseRoute('#/team/MIA?rules=%%%', 'OKC').rules).toEqual(DEFAULT_RULES)
    const sneaky = btoa(JSON.stringify({ needPivot: 'x', bogus: 3, depth: { shooting: 0.5 } }))
    const rules = parseRoute(`#/team/MIA?rules=${sneaky}`, 'OKC').rules
    expect(rules.needPivot).toBe(DEFAULT_RULES.needPivot)
    expect(rules.depth.shooting).toBe(0.5)
    expect('bogus' in rules).toBe(false)
  })

  it('drops a swap outside the team view', () => {
    expect(parseRoute('#/league?swap=a~b', 'OKC').swap).toBeNull()
  })
})

describe('rankLabel', () => {
  it('prefixes shared ranks only', () => {
    const ranks = new Map([
      ['MIN', 1],
      ['OKC', 1],
      ['LAC', 3],
    ])
    expect(rankLabel(ranks, 'MIN')).toBe('T-1')
    expect(rankLabel(ranks, 'LAC')).toBe('3')
    expect(rankLabel(ranks, 'XXX')).toBe('—')
  })
})
