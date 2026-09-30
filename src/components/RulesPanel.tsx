/**
 * The fit rules, section 5.5. Every constant from section 3, live: a change
 * recomputes all thirty teams and the chart.
 */
import { DEFAULT_RULES, type Rules } from '../fit/types'

interface Field {
  label: string
  hint: string
  min: number
  max: number
  step: number
  get: (r: Rules) => number
  set: (r: Rules, v: number) => Rules
}

const FIELDS: Array<{ group: string; fields: Field[] }> = [
  {
    group: 'Where a notch opens',
    fields: [
      {
        label: 'Weakness pivot',
        hint: 'percentile a notch starts below',
        min: 20,
        max: 80,
        step: 1,
        get: (r) => r.needPivot,
        set: (r, v) => ({ ...r, needPivot: v }),
      },
      {
        label: 'Weakness curve',
        hint: 'exponent on need; lower punishes mild flaws more',
        min: 0.3,
        max: 1.5,
        step: 0.05,
        get: (r) => r.needExponent,
        set: (r, v) => ({ ...r, needExponent: v }),
      },
      {
        label: 'Strength floor',
        hint: 'percentile a strength starts above',
        min: 50,
        max: 90,
        step: 1,
        get: (r) => r.strengthFloor,
        set: (r, v) => ({ ...r, strengthFloor: v }),
      },
      {
        label: 'Compounding',
        hint: 'how much extra weaknesses deepen each other',
        min: 0,
        max: 1.5,
        step: 0.05,
        get: (r) => r.compoundFactor,
        set: (r, v) => ({ ...r, compoundFactor: v }),
      },
    ],
  },
  {
    group: 'How deep it cuts',
    fields: [
      {
        label: 'Shooting depth',
        hint: 'fraction of the side',
        min: 0.1,
        max: 0.6,
        step: 0.01,
        get: (r) => r.depth.shooting,
        set: (r, v) => ({ ...r, depth: { ...r.depth, shooting: v } }),
      },
      {
        label: 'Interior depth',
        hint: 'fraction of the side',
        min: 0.1,
        max: 0.6,
        step: 0.01,
        get: (r) => r.depth.interior,
        set: (r, v) => ({ ...r, depth: { ...r.depth, interior: v } }),
      },
      {
        label: 'Perimeter D depth',
        hint: 'fraction of the side',
        min: 0.1,
        max: 0.6,
        step: 0.01,
        get: (r) => r.depth.perimeterD,
        set: (r, v) => ({ ...r, depth: { ...r.depth, perimeterD: v } }),
      },
      {
        label: 'Notch cap',
        hint: 'no notch cuts past this',
        min: 0.2,
        max: 0.6,
        step: 0.01,
        get: (r) => r.notchCap,
        set: (r, v) => ({ ...r, notchCap: v }),
      },
      {
        label: 'Slot width',
        hint: 'how wide a notch is along its edge',
        min: 0.15,
        max: 0.45,
        step: 0.01,
        get: (r) => r.slot,
        set: (r, v) => ({ ...r, slot: v }),
      },
    ],
  },
  {
    group: 'Coverage on the floor',
    fields: [
      {
        label: 'On-floor coverage',
        hint: '0 pools the whole rotation, 1 caps coverage at minutes played',
        min: 0,
        max: 1,
        step: 0.05,
        get: (r) => r.coverage.onFloor,
        set: (r, v) => ({ ...r, coverage: { ...r.coverage, onFloor: v } }),
      },
      {
        label: 'Weakest-link defence',
        hint: '0 pools perimeter D, 1 charges only the worst defender',
        min: 0,
        max: 1,
        step: 0.05,
        get: (r) => r.coverage.weakestLinkD,
        set: (r, v) => ({ ...r, coverage: { ...r.coverage, weakestLinkD: v } }),
      },
      {
        label: 'Interior spacing credit',
        hint: 'share of an open interior hole paid back on offense (0.9 from lineup data)',
        min: 0,
        max: 1,
        step: 0.05,
        get: (r) => r.coverage.interiorSpacing,
        set: (r, v) => ({ ...r, coverage: { ...r.coverage, interiorSpacing: v } }),
      },
    ],
  },
  {
    group: 'How far a strength reaches',
    fields: [
      {
        label: 'Shooting reach',
        hint: 'spacing helps, but only so far',
        min: 0.5,
        max: 4,
        step: 0.1,
        get: (r) => r.reach.shooting,
        set: (r, v) => ({ ...r, reach: { ...r.reach, shooting: v } }),
      },
      {
        label: 'Interior reach',
        hint: 'one rim protector covers the floor',
        min: 0.5,
        max: 6,
        step: 0.1,
        get: (r) => r.reach.interior,
        set: (r, v) => ({ ...r, reach: { ...r.reach, interior: v } }),
      },
      {
        label: 'Perimeter D reach',
        hint: 'a stopper can only guard one man',
        min: 0.5,
        max: 4,
        step: 0.1,
        get: (r) => r.reach.perimeterD,
        set: (r, v) => ({ ...r, reach: { ...r.reach, perimeterD: v } }),
      },
    ],
  },
  {
    group: 'Ball dominance',
    fields: [
      {
        label: 'Usage floor',
        hint: 'a ball notch opens above this usage',
        min: 12,
        max: 28,
        step: 0.5,
        get: (r) => r.ball.usgFloor,
        set: (r, v) => ({ ...r, ball: { ...r.ball, usgFloor: v } }),
      },
      {
        label: 'Usage range',
        hint: 'usage points to a full ball notch',
        min: 4,
        max: 24,
        step: 0.5,
        get: (r) => r.ball.usgRange,
        set: (r, v) => ({ ...r, ball: { ...r.ball, usgRange: v } }),
      },
      {
        label: 'Playmaker relief',
        hint: 'how much passing shrinks a ball notch',
        min: 0,
        max: 1,
        step: 0.05,
        get: (r) => r.ball.playmakerRelief,
        set: (r, v) => ({ ...r, ball: { ...r.ball, playmakerRelief: v } }),
      },
      {
        label: 'Ball notch depth',
        hint: 'a full ball notch, as a fraction of the side',
        min: 0,
        max: 0.6,
        step: 0.01,
        get: (r) => r.ball.tabLength,
        set: (r, v) => ({ ...r, ball: { ...r.ball, tabLength: v } }),
      },
      {
        label: 'Creator ceiling',
        hint: 'needs-a-creator opens below this usage',
        min: 10,
        max: 24,
        step: 0.5,
        get: (r) => r.lowUsage.usgCeiling,
        set: (r, v) => ({ ...r, lowUsage: { ...r.lowUsage, usgCeiling: v } }),
      },
      {
        label: 'Creator depth',
        hint: 'how much room a low-usage player offers',
        min: 0,
        max: 0.6,
        step: 0.01,
        get: (r) => r.lowUsage.depth,
        set: (r, v) => ({ ...r, lowUsage: { ...r.lowUsage, depth: v } }),
      },
    ],
  },
]

export function RulesPanel({
  rules,
  onChange,
}: {
  rules: Rules
  onChange: (r: Rules) => void
}) {
  const dirty = JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES)

  return (
    <>
      <div className="prose">
        <p>
          Moving one recomputes every board, the league grid and the chart, so you can see which
          constants the ranking actually depends on.
        </p>
        <p>
          The two under <b>Coverage on the floor</b> are the ones that change what the model
          measures rather than how hard it grades. Setting on-floor coverage to 0 and
          weakest-link defence to 0 returns the original pooled model, where any strength on the
          roster counted for the whole game.
        </p>
      </div>

      {FIELDS.map(({ group, fields }) => (
        <section key={group}>
          <h3
            style={{
              fontSize: 'var(--f-small)',
              color: 'var(--ink-2)',
              borderBottom: '1px solid var(--hair)',
              paddingBottom: 'calc(var(--step) * 1.5)',
              marginBottom: 'calc(var(--step) * 3)',
            }}
          >
            {group}
          </h3>
          <div className="rules">
            {fields.map((f) => {
              const id = `rule-${f.label.replace(/\s+/g, '-').toLowerCase()}`
              return (
                <div className="rule-field" key={f.label}>
                  <label htmlFor={id}>
                    {f.label}
                    <br />
                    <span style={{ color: 'var(--ink-3)', fontSize: 'var(--f-micro)' }}>
                      {f.hint}
                    </span>
                  </label>
                  <output htmlFor={id}>{f.get(rules)}</output>
                  <input
                    id={id}
                    type="range"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={f.get(rules)}
                    onChange={(e) => onChange(f.set(rules, Number(e.target.value)))}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <div>
        <button
          type="button"
          className="ghost"
          onClick={() => onChange(DEFAULT_RULES)}
          disabled={!dirty}
          style={{ borderColor: dirty ? 'var(--rule)' : 'transparent' }}
        >
          {dirty ? 'Reset to the defaults' : 'Showing the defaults'}
        </button>
      </div>
    </>
  )
}
