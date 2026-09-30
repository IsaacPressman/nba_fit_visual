import { describe, expect, it } from 'vitest'
import {
  clamp01,
  fitWinCorrelation,
  fitWinLine,
  rankByFit,
  scoreRotation,
  shapeOf,
  wastePoints,
} from './model'
import { DEFAULT_RULES, type Player, type Rules, type Team, type TeamFit } from './types'

const R = DEFAULT_RULES

function player(over: Partial<Player> & { id: string }): Player {
  return {
    key: over.id,
    name: over.id,
    team: 'TST',
    games: 82,
    min: 2400,
    mpg: 30,
    usg: 20,
    load: 12,
    pct: { shooting: 50, interior: 50, playmaking: 50, perimeterD: 50 },
    raw: {
      fg3aPer36: 5,
      fg3Pct: 35,
      rebPer36: 5,
      blkPer36: 0.5,
      astPer36: 4,
      astRatio: 20,
      stlPer36: 1,
      dpm: 0,
      epm: 0,
      seasonMin: 2400,
    },
    ...over,
  }
}

const team = (players: Player[]): Team => ({
  abbr: 'TST',
  name: 'Test',
  wins: 41,
  losses: 41,
  talent: 0,
  colors: ['#000000', '#ffffff'],
  players,
})

const pct = (o: Partial<Player['pct']>) => ({
  shooting: 50,
  interior: 50,
  playmaking: 50,
  perimeterD: 50,
  ...o,
})

// --------------------------------------------------------------------------- //
describe('clamp01', () => {
  it('clamps both ends and passes the middle through', () => {
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(0.4)).toBe(0.4)
    expect(clamp01(9)).toBe(1)
  })
})

describe('shapeOf: notches', () => {
  it('cuts nothing at or above the 50th percentile', () => {
    const s = shapeOf(player({ id: 'a', pct: pct({ shooting: 50, interior: 80 }) }))
    expect(s.notch.shooting).toBe(0)
    expect(s.notch.interior).toBe(0)
  })

  it('cuts deeper the further below the pivot a skill sits', () => {
    const mild = shapeOf(player({ id: 'a', pct: pct({ shooting: 40 }) }))
    const bad = shapeOf(player({ id: 'b', pct: pct({ shooting: 10 }) }))
    expect(bad.notch.shooting).toBeGreaterThan(mild.notch.shooting)
  })

  it('reaches full depth at the 0th percentile, before compounding', () => {
    const s = shapeOf(player({ id: 'a', pct: pct({ shooting: 0 }) }))
    expect(s.need.shooting).toBeCloseTo(1, 10)
    expect(s.notch.shooting).toBeCloseTo(R.depth.shooting, 10)
  })

  it('never cuts past the cap', () => {
    const s = shapeOf(
      player({ id: 'a', pct: pct({ shooting: 0, interior: 0, perimeterD: 0 }) }),
    )
    for (const k of ['shooting', 'interior', 'perimeterD'] as const) {
      expect(s.notch[k]).toBeLessThanOrEqual(R.notchCap)
    }
    expect(s.notch.shooting).toBe(R.notchCap)
  })
})

describe('shapeOf: compounding', () => {
  it('leaves a single weakness uncompounded', () => {
    const s = shapeOf(player({ id: 'a', pct: pct({ shooting: 20 }) }))
    expect(s.compound).toBe(1)
    expect(s.compounding).toBe(false)
  })

  it('deepens a weakness when another one is present', () => {
    const alone = shapeOf(player({ id: 'a', pct: pct({ shooting: 20 }) }))
    const paired = shapeOf(player({ id: 'b', pct: pct({ shooting: 20, interior: 20 }) }))
    expect(paired.compound).toBeGreaterThan(1)
    expect(paired.notch.shooting).toBeGreaterThan(alone.notch.shooting)
    expect(paired.compounding).toBe(true)
  })

  it('gives the deepest weakness away free: compound = 1 + f*(sum - max)', () => {
    const s = shapeOf(player({ id: 'a', pct: pct({ shooting: 0, interior: 0 }) }))
    // both needs are 1, so sum - max = 1
    expect(s.compound).toBeCloseTo(1 + R.compoundFactor, 10)
  })
})

describe('shapeOf: strengths', () => {
  it('starts at the strength floor and reaches 1 at the 100th percentile', () => {
    expect(shapeOf(player({ id: 'a', pct: pct({ shooting: 65 }) })).strength.shooting).toBe(0)
    expect(shapeOf(player({ id: 'b', pct: pct({ shooting: 100 }) })).strength.shooting).toBe(1)
    expect(
      shapeOf(player({ id: 'c', pct: pct({ shooting: 82.5 }) })).strength.shooting,
    ).toBeCloseTo(0.5, 10)
  })

  it('never grows a tab: only ball dominance sticks out', () => {
    const s = shapeOf(
      player({
        id: 'a',
        usg: 12,
        pct: pct({ shooting: 100, interior: 100, perimeterD: 100 }),
      }),
    )
    expect(s.tab).toBe(0)
  })
})

describe('shapeOf: ball dominance', () => {
  it('stays flat at or below the usage floor', () => {
    expect(shapeOf(player({ id: 'a', usg: 20 })).tab).toBe(0)
    expect(shapeOf(player({ id: 'b', usg: 8 })).tab).toBe(0)
  })

  it('grows with usage and tops out at the tab length', () => {
    const mid = shapeOf(player({ id: 'a', usg: 27, pct: pct({ playmaking: 0 }) }))
    const high = shapeOf(player({ id: 'b', usg: 34, pct: pct({ playmaking: 0 }) }))
    expect(high.tab).toBeGreaterThan(mid.tab)
    expect(high.tab).toBeCloseTo(R.ball.tabLength, 10)
    expect(shapeOf(player({ id: 'c', usg: 40, pct: pct({ playmaking: 0 }) })).tab).toBeCloseTo(
      R.ball.tabLength,
      10,
    )
  })

  it('shrinks the tab for a playmaker who shares the ball', () => {
    const hog = shapeOf(player({ id: 'a', usg: 34, pct: pct({ playmaking: 0 }) }))
    const passer = shapeOf(player({ id: 'b', usg: 34, pct: pct({ playmaking: 100 }) }))
    expect(passer.tab).toBeCloseTo(hog.tab * (1 - R.ball.playmakerRelief), 10)
  })
})

describe('shapeOf: needs a creator', () => {
  it('opens below the usage ceiling only', () => {
    expect(shapeOf(player({ id: 'a', usg: 17 })).lowNotch).toBe(0)
    expect(shapeOf(player({ id: 'b', usg: 25 })).lowNotch).toBe(0)
    expect(shapeOf(player({ id: 'c', usg: 12 })).lowNotch).toBeGreaterThan(0)
  })

  it('reaches full depth at the bottom of the range', () => {
    const s = shapeOf(player({ id: 'a', usg: 9 }))
    expect(s.lowNotch).toBeCloseTo(R.lowUsage.depth, 10)
  })
})

describe('scoreRotation: pooled coverage', () => {
  it('scores a rotation with no weaknesses at zero waste', () => {
    const roster = [0, 1, 2, 3].map((i) =>
      player({ id: `p${i}`, usg: 18.5, pct: pct({ shooting: 60, interior: 60, perimeterD: 60 }) }),
    )
    const fit = scoreRotation(team(roster))
    expect(fit.wastedFitPct).toBeCloseTo(0, 10)
  })

  it('leaves a weakness nobody covers fully wasted', () => {
    const roster = [
      player({ id: 'weak', usg: 18.5, pct: pct({ shooting: 0 }) }),
      player({ id: 'mate', usg: 18.5, pct: pct({}) }),
    ]
    const fit = scoreRotation(team(roster))
    expect(fit.skills.shooting.fill).toBe(0)
    expect(fit.skills.shooting.suppliers).toEqual([])
    expect(fit.skills.shooting.waste).toBeCloseTo(fit.skills.shooting.demand, 10)
    expect(fit.wastedFitPct).toBeGreaterThan(0)
  })

  it('lets a teammate strength close another player’s notch', () => {
    const weak = player({ id: 'weak', usg: 18.5, pct: pct({ shooting: 0 }) })
    const alone = scoreRotation(team([weak, player({ id: 'mate', usg: 18.5 })]))
    const helped = scoreRotation(
      team([weak, player({ id: 'sniper', usg: 18.5, pct: pct({ shooting: 100 }) })]),
    )
    expect(helped.skills.shooting.fill).toBeGreaterThan(alone.skills.shooting.fill)
    expect(helped.wastedFitPct).toBeLessThan(alone.wastedFitPct)
    expect(helped.skills.shooting.suppliers.map((s) => s.id)).toEqual(['sniper'])
  })

  it('flaws that cancel out beat a stacked redundant rotation', () => {
    // each covers what the other lacks
    const complementary = team([
      player({ id: 'a', usg: 18.5, pct: pct({ shooting: 100, interior: 20 }) }),
      player({ id: 'b', usg: 18.5, pct: pct({ shooting: 20, interior: 100 }) }),
    ])
    // both good at the same thing, both bad at the same thing
    const redundant = team([
      player({ id: 'c', usg: 18.5, pct: pct({ shooting: 100, interior: 20 }) }),
      player({ id: 'd', usg: 18.5, pct: pct({ shooting: 100, interior: 20 }) }),
    ])
    // This tests the pooling, so the interior spacing credit is switched off:
    // with it on, a shared interior hole mostly nets out by design, which is a
    // statement about interior, not about redundancy.
    const pooling: Rules = { ...R, coverage: { ...R.coverage, interiorSpacing: 0 } }
    expect(scoreRotation(complementary, undefined, pooling).wastedFitPct).toBeLessThan(
      scoreRotation(redundant, undefined, pooling).wastedFitPct,
    )
  })

  it('gives one rim protector more reach than one shooter', () => {
    // a modest supplier, so neither channel clamps at fill = 1 and reach shows
    const interior = scoreRotation(
      team([
        player({ id: 'a', usg: 18.5, pct: pct({ interior: 0 }) }),
        player({ id: 'b', usg: 18.5, pct: pct({ interior: 70 }) }),
      ]),
    )
    const shooting = scoreRotation(
      team([
        player({ id: 'a', usg: 18.5, pct: pct({ shooting: 0 }) }),
        player({ id: 'b', usg: 18.5, pct: pct({ shooting: 70 }) }),
      ]),
    )
    expect(interior.skills.interior.fill).toBeLessThan(1)
    expect(shooting.skills.shooting.fill).toBeLessThan(1)
    expect(interior.skills.interior.fill).toBeGreaterThan(shooting.skills.shooting.fill)
    // the ratio is exactly the ratio of the two reach multipliers
    expect(interior.skills.interior.fill / shooting.skills.shooting.fill).toBeCloseTo(
      R.reach.interior / R.reach.shooting,
      10,
    )
  })

  it('splits supplier shares by load x strength', () => {
    const fit = scoreRotation(
      team([
        player({ id: 'weak', usg: 18.5, pct: pct({ shooting: 0 }) }),
        player({ id: 'big', load: 20, usg: 18.5, pct: pct({ shooting: 100 }) }),
        player({ id: 'small', load: 10, usg: 18.5, pct: pct({ shooting: 100 }) }),
      ]),
    )
    const s = fit.skills.shooting.suppliers
    expect(s.map((x) => x.id)).toEqual(['big', 'small'])
    expect(s[0].share).toBeCloseTo(2 / 3, 10)
    expect(s[1].share).toBeCloseTo(1 / 3, 10)
  })

  it('pools coverage across the rotation rather than pairing players up', () => {
    // one sniper, two identical non-shooters: both notches fill to the same depth
    const fit = scoreRotation(
      team([
        player({ id: 'w1', usg: 18.5, pct: pct({ shooting: 10 }) }),
        player({ id: 'w2', usg: 18.5, pct: pct({ shooting: 10 }) }),
        player({ id: 'sniper', usg: 18.5, pct: pct({ shooting: 100 }) }),
      ]),
    )
    expect(fit.skills.shooting.fill).toBeGreaterThan(0)
    expect(fit.skills.shooting.fill).toBeLessThan(1)
  })
})

describe('scoreRotation: coverage has to be on the floor', () => {
  const sniper = (id: string, mpg: number) =>
    player({ id, mpg, usg: 18.5, pct: pct({ shooting: 100 }) })
  const weak = player({ id: 'weak', mpg: 30, usg: 18.5, pct: pct({ shooting: 0 }) })

  it('counts a supplier who never leaves the floor in full', () => {
    const fit = scoreRotation(team([weak, sniper('all-game', 48)]))
    expect(fit.skills.shooting.presence).toBeCloseTo(1, 10)
  })

  it('caps coverage at the share of the game the supplier plays', () => {
    const fit = scoreRotation(team([weak, sniper('half-game', 24)]))
    expect(fit.skills.shooting.presence).toBeCloseTo(0.5, 10)
    // capacity is unaffected: he is just as good, he is simply not out there
    expect(fit.skills.shooting.capacity).toBe(1)
    expect(fit.skills.shooting.fill).toBeCloseTo(0.5, 10)
  })

  it('gives two half-game suppliers 0.75, not 1: the fifth shooter adds least', () => {
    const one = scoreRotation(team([weak, sniper('a', 24)]))
    const two = scoreRotation(team([weak, sniper('a', 24), sniper('b', 24)]))
    const three = scoreRotation(team([weak, sniper('a', 24), sniper('b', 24), sniper('c', 24)]))
    expect(one.skills.shooting.presence).toBeCloseTo(0.5, 10)
    expect(two.skills.shooting.presence).toBeCloseTo(0.75, 10)
    expect(three.skills.shooting.presence).toBeCloseTo(0.875, 10)
    // each extra supplier buys less presence than the one before
    const first = two.skills.shooting.presence - one.skills.shooting.presence
    const second = three.skills.shooting.presence - two.skills.shooting.presence
    expect(second).toBeLessThan(first)
  })

  it('weights presence by how good the supplier is, not just his minutes', () => {
    const elite = scoreRotation(team([weak, player({ id: 'e', mpg: 48, usg: 18.5, pct: pct({ shooting: 100 }) })]))
    const modest = scoreRotation(team([weak, player({ id: 'm', mpg: 48, usg: 18.5, pct: pct({ shooting: 75 }) })]))
    expect(elite.skills.shooting.presence).toBeGreaterThan(modest.skills.shooting.presence)
  })

  it('leaves a skill nobody supplies at no presence and no coverage', () => {
    const fit = scoreRotation(team([weak, player({ id: 'mate', mpg: 30, usg: 18.5 })]))
    expect(fit.skills.shooting.presence).toBe(0)
    expect(fit.skills.shooting.fill).toBe(0)
    expect(fit.skills.shooting.waste).toBeCloseTo(fit.skills.shooting.demand, 10)
  })

  it('punishes bench coverage relative to the same skill in the starting five', () => {
    const starter = scoreRotation(team([weak, sniper('starter', 36)]))
    const reserve = scoreRotation(team([weak, sniper('reserve', 16)]))
    expect(reserve.wastedFitPct).toBeGreaterThan(starter.wastedFitPct)
  })

  it('reproduces the pooled model exactly when on-floor is switched off', () => {
    const pooled: Rules = {
      ...R,
      coverage: { onFloor: 0, weakestLinkD: 0, interiorSpacing: 0 },
    }
    const roster = [weak, sniper('half-game', 24)]
    const fit = scoreRotation(team(roster), roster, pooled)
    // the old formula was fill = min(1, supply / demand), with no presence term
    expect(fit.skills.shooting.fill).toBe(fit.skills.shooting.capacity)
    expect(fit.skills.shooting.fill).toBeCloseTo(
      Math.min(1, fit.skills.shooting.supply / fit.skills.shooting.demand),
      10,
    )
  })
})

describe('scoreRotation: weakest-link defence', () => {
  const pooledD: Rules = { ...R, coverage: { ...R.coverage, weakestLinkD: 0 } }
  const huntedD: Rules = { ...R, coverage: { ...R.coverage, weakestLinkD: 1 } }

  it('charges the worst defender against every possession', () => {
    const roster = [
      player({ id: 'sieve', usg: 18.5, pct: pct({ perimeterD: 0 }) }),
      player({ id: 'fine1', usg: 18.5, pct: pct({ perimeterD: 60 }) }),
      player({ id: 'fine2', usg: 18.5, pct: pct({ perimeterD: 60 }) }),
    ]
    const pooled = scoreRotation(team(roster), roster, pooledD)
    const hunted = scoreRotation(team(roster), roster, huntedD)
    expect(hunted.skills.perimeterD.demand).toBeGreaterThan(pooled.skills.perimeterD.demand)
    expect(hunted.wastedFitPct).toBeGreaterThan(pooled.wastedFitPct)
  })

  it('changes nothing when the whole rotation is equally weak', () => {
    // pooled demand and worst-times-everyone agree exactly here, which is the
    // sign the blend is redistributing rather than inflating
    const roster = [0, 1, 2].map((i) =>
      player({ id: `p${i}`, usg: 18.5, pct: pct({ perimeterD: 20 }) }),
    )
    const pooled = scoreRotation(team(roster), roster, pooledD)
    const hunted = scoreRotation(team(roster), roster, huntedD)
    expect(hunted.skills.perimeterD.demand).toBeCloseTo(pooled.skills.perimeterD.demand, 10)
  })

  it('prefers one bad defender spread into two mediocre ones', () => {
    const concentrated = [
      player({ id: 'sieve', usg: 18.5, pct: pct({ perimeterD: 0 }) }),
      player({ id: 'ok', usg: 18.5, pct: pct({ perimeterD: 55 }) }),
    ]
    const spread = [
      player({ id: 'mid1', usg: 18.5, pct: pct({ perimeterD: 30 }) }),
      player({ id: 'mid2', usg: 18.5, pct: pct({ perimeterD: 30 }) }),
    ]
    const a = scoreRotation(team(concentrated), concentrated, huntedD)
    const b = scoreRotation(team(spread), spread, huntedD)
    expect(a.skills.perimeterD.demand).toBeGreaterThan(b.skills.perimeterD.demand)
  })

  it('leaves shooting and interior pooled', () => {
    const roster = [
      player({ id: 'a', usg: 18.5, pct: pct({ shooting: 0, interior: 0, perimeterD: 0 }) }),
      player({ id: 'b', usg: 18.5, pct: pct({ shooting: 60, interior: 60, perimeterD: 60 }) }),
    ]
    const pooled = scoreRotation(team(roster), roster, pooledD)
    const hunted = scoreRotation(team(roster), roster, huntedD)
    expect(hunted.skills.shooting.demand).toBeCloseTo(pooled.skills.shooting.demand, 10)
    expect(hunted.skills.interior.demand).toBeCloseTo(pooled.skills.interior.demand, 10)
    expect(hunted.skills.perimeterD.demand).not.toBeCloseTo(pooled.skills.perimeterD.demand, 6)
  })
})

describe('scoreRotation: ball dominance', () => {
  it('wastes surplus when creators outnumber the room for them', () => {
    const fit = scoreRotation(
      team([
        player({ id: 'a', usg: 34, pct: pct({ playmaking: 0 }) }),
        player({ id: 'b', usg: 34, pct: pct({ playmaking: 0 }) }),
        player({ id: 'c', usg: 30, pct: pct({ playmaking: 0 }) }),
      ]),
    )
    expect(fit.ballDominance.waste).toBeGreaterThan(0)
    expect(fit.noCreator.waste).toBeCloseTo(0, 10)
    expect(fit.ballDominance.fill).toBeLessThan(1)
  })

  it('wastes starved room when nobody creates', () => {
    const fit = scoreRotation(
      team([player({ id: 'a', usg: 10 }), player({ id: 'b', usg: 10 })]),
    )
    expect(fit.noCreator.waste).toBeGreaterThan(0)
    expect(fit.ballDominance.waste).toBeCloseTo(0, 10)
    expect(fit.creators).toEqual([])
  })

  it('matches a creator to the room low-usage teammates offer', () => {
    const starved = scoreRotation(
      team([player({ id: 'a', usg: 10 }), player({ id: 'b', usg: 10 })]),
    )
    const served = scoreRotation(
      team([
        player({ id: 'a', usg: 10 }),
        player({ id: 'b', usg: 10 }),
        player({ id: 'star', usg: 34, pct: pct({ playmaking: 0 }) }),
      ]),
    )
    expect(served.noCreator.waste).toBeLessThan(starved.noCreator.waste)
    expect(served.creators.map((c) => c.id)).toEqual(['star'])
  })

  it('never charges for both surplus and starvation at once', () => {
    const fits = [
      scoreRotation(team([player({ id: 'a', usg: 34 }), player({ id: 'b', usg: 10 })])),
      scoreRotation(team([player({ id: 'a', usg: 22 }), player({ id: 'b', usg: 15 })])),
    ]
    for (const f of fits) {
      expect(Math.min(f.ballDominance.waste, f.noCreator.waste)).toBeCloseTo(0, 10)
    }
  })
})

describe('scoreRotation: score is layout-independent', () => {
  it('gives the same score whatever order the roster arrives in', () => {
    const roster = [
      player({ id: 'a', load: 20, usg: 32, pct: pct({ shooting: 10, playmaking: 30 }) }),
      player({ id: 'b', load: 15, usg: 12, pct: pct({ interior: 95 }) }),
      player({ id: 'c', load: 10, usg: 18, pct: pct({ perimeterD: 5 }) }),
      player({ id: 'd', load: 8, usg: 22, pct: pct({ shooting: 90 }) }),
    ]
    const forward = scoreRotation(team(roster)).wastedFitPct
    const backward = scoreRotation(team([...roster].reverse())).wastedFitPct
    expect(backward).toBeCloseTo(forward, 10)
  })
})

describe('wastePoints', () => {
  it('sums the five channels back to the headline number', () => {
    const fit = scoreRotation(
      team([
        player({ id: 'a', usg: 33, pct: pct({ shooting: 5, perimeterD: 10, playmaking: 20 }) }),
        player({ id: 'b', usg: 11, pct: pct({ interior: 8 }) }),
        player({ id: 'c', usg: 19, pct: pct({ shooting: 90, interior: 90 }) }),
      ]),
    )
    const summed =
      wastePoints(fit, 'shooting') +
      wastePoints(fit, 'interior') +
      wastePoints(fit, 'perimeterD') +
      wastePoints(fit, 'ballDominance') +
      wastePoints(fit, 'noCreator')
    expect(summed).toBeCloseTo(fit.wastedFitPct, 10)
  })
})

// --------------------------------------------------------------------------- //
const fakeFit = (abbr: string, wastedFitPct: number, wins: number) =>
  ({ team: { abbr, wins }, wastedFitPct }) as unknown as TeamFit

describe('rankByFit', () => {
  it('treats differences under a point as ties', () => {
    const ranks = rankByFit([
      fakeFit('AAA', 2.0, 50),
      fakeFit('BBB', 2.6, 40),
      fakeFit('CCC', 8.0, 30),
    ])
    expect(ranks.get('AAA')).toBe(1)
    expect(ranks.get('BBB')).toBe(1)
    expect(ranks.get('CCC')).toBe(3)
  })

  it('separates teams more than a point apart', () => {
    const ranks = rankByFit([fakeFit('AAA', 1, 50), fakeFit('BBB', 4, 40)])
    expect(ranks.get('AAA')).toBe(1)
    expect(ranks.get('BBB')).toBe(2)
  })

  it('does not chain ties across a wide spread', () => {
    // each is 0.8 from the last, but AAA and DDD are 2.4 apart
    const ranks = rankByFit([
      fakeFit('AAA', 1.0, 50),
      fakeFit('BBB', 1.8, 45),
      fakeFit('CCC', 2.6, 40),
      fakeFit('DDD', 3.4, 35),
    ])
    expect(ranks.get('AAA')).toBe(1)
    expect(ranks.get('BBB')).toBe(1)
    expect(ranks.get('CCC')).toBe(3)
    expect(ranks.get('DDD')).toBe(3)
  })
})

describe('fitWinCorrelation and fitWinLine', () => {
  it('reads a perfect inverse relationship as -1 with a negative slope', () => {
    const fits = [
      fakeFit('AAA', 1, 60),
      fakeFit('BBB', 2, 50),
      fakeFit('CCC', 3, 40),
      fakeFit('DDD', 4, 30),
    ]
    expect(fitWinCorrelation(fits)).toBeCloseTo(-1, 10)
    expect(fitWinLine(fits).slope).toBeCloseTo(-10, 10)
  })

  it('returns zero when wasted fit does not move', () => {
    expect(fitWinCorrelation([fakeFit('AAA', 3, 60), fakeFit('BBB', 3, 20)])).toBe(0)
  })
})
