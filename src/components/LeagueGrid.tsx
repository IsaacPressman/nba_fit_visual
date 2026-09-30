/**
 * All thirty boards at once, section 4.3 — and the front door.
 *
 * One scale across every tile, so a team whose top eight cover 88% of
 * possessions draws a visibly smaller board than one covering 100% — the
 * prototype zoomed each tile to fit and lost that. Detail is dropped to what
 * survives at this size: piece size, striped waste, the ball tab.
 *
 * Pieces are one neutral tone and the stripes carry the only accent, so the
 * eye compares exposure rather than team branding. Team color survives as a
 * chip beside the name, and a bar on one shared scale gives the number a shape.
 *
 * Above the grid, one board assembles itself. The tiles are too small to show
 * the premise, and the assembly is the premise in one move.
 */
import { useEffect, useMemo, useState } from 'react'
import { focusOf } from '../fit/highlight'
import { rankLabel } from '../fit/model'
import { SlotMap, type Mode } from '../fit/palette'
import type { Rules, TeamFit } from '../fit/types'
import { Board, Tile, type Assembly } from './Board'

type Sort = 'fit' | 'record'

/** Nicknames with two words; everything else is the last word of the name. */
const TWO_WORD = ['Trail Blazers']

/** "Timberwolves", not "Minnesota Timbe…": the tile has room for one word. */
export function nickname(name: string) {
  const two = TWO_WORD.find((n) => name.endsWith(n))
  return two ?? name.split(' ').slice(-1)[0]
}

function Intro({
  fits,
  rules,
  mode,
  onOpenTeam,
  onOpenChart,
}: {
  fits: TeamFit[]
  rules: Rules
  mode: Mode
  onOpenTeam: (abbr: string) => void
  onOpenChart: () => void
}) {
  // the median team: a board with some stripes to show, chosen by rule, not taste
  const demo = useMemo(() => {
    const sorted = [...fits].sort((a, b) => a.wastedFitPct - b.wastedFitPct)
    return sorted[Math.floor(sorted.length / 2)]
  }, [fits])

  const slots = useMemo(
    () =>
      new SlotMap(
        [...demo.team.players].sort((a, b) => b.load - a.load).map((p) => p.id),
      ),
    [demo],
  )

  // the landing explains the premise, so the team view need not repeat it
  useEffect(() => {
    try {
      localStorage.setItem('csp-seen-intro', '1')
    } catch {
      // storage blocked: the team view shows its one-line intro instead
    }
  }, [])

  const [assembly, setAssembly] = useState<Assembly>('exploded')
  const [run, setRun] = useState(0)
  useEffect(() => {
    setAssembly('exploded')
    const id = window.setTimeout(() => setAssembly('assembled'), 900)
    return () => window.clearTimeout(id)
  }, [run])

  return (
    <section className="landing">
      <div className="landing-copy">
        <h1>How well does each NBA rotation fit together?</h1>
        <p>
          Every player is a puzzle piece, sized by his share of possessions. His weaknesses cut
          notches; teammates' strengths fill them in their colors.{' '}
          <b>Whatever nobody covers stays striped</b> — that striped share is the team's
          exposure, and lower is better.
        </p>
        <p className="landing-links">
          Pick a team below, or{' '}
          <button type="button" className="link" onClick={onOpenChart}>
            see whether fit explains the standings
          </button>
          .
        </p>
      </div>

      <figure className="landing-demo">
        <button
          type="button"
          className="demo-mat"
          onClick={() => onOpenTeam(demo.team.abbr)}
          aria-label={`${demo.team.name}, ${demo.wastedFitPct.toFixed(1)}% exposure. Open board.`}
        >
          <Board
            fit={demo}
            rules={rules}
            slots={slots}
            mode={mode}
            assembly={assembly}
            focus={focusOf(demo, null)}
            layout="wide"
          />
        </button>
        <figcaption>
          <span>
            {demo.team.name}, the league's median fit: {demo.wastedFitPct.toFixed(1)}% exposed.
          </span>
          <button type="button" className="link" onClick={() => setRun((n) => n + 1)}>
            Assemble again
          </button>
        </figcaption>
      </figure>
    </section>
  )
}

export function LeagueGrid({
  fits,
  ranks,
  rules,
  mode,
  onOpenTeam,
  onOpenChart,
}: {
  fits: TeamFit[]
  ranks: Map<string, number>
  rules: Rules
  mode: Mode
  onOpenTeam: (abbr: string) => void
  onOpenChart: () => void
}) {
  const [sort, setSort] = useState<Sort>('fit')

  const maxLoad = useMemo(() => Math.max(...fits.map((f) => f.totalLoad)), [fits])
  const maxExposure = useMemo(
    () => Math.ceil(Math.max(...fits.map((f) => f.wastedFitPct)) / 5) * 5 || 5,
    [fits],
  )

  const ordered = useMemo(
    () =>
      [...fits].sort((a, b) =>
        sort === 'fit'
          ? a.wastedFitPct - b.wastedFitPct
          : b.team.wins - a.team.wins || a.wastedFitPct - b.wastedFitPct,
      ),
    [fits, sort],
  )

  return (
    <>
      <Intro
        fits={fits}
        rules={rules}
        mode={mode}
        onOpenTeam={onOpenTeam}
        onOpenChart={onOpenChart}
      />

      <div className="grid-tools">
        <h2>All 30 teams</h2>
        <div className="tabs" role="group" aria-label="Sort the league">
          <button
            type="button"
            aria-current={sort === 'fit' ? 'page' : undefined}
            onClick={() => setSort('fit')}
          >
            Best fit
          </button>
          <button
            type="button"
            aria-current={sort === 'record' ? 'page' : undefined}
            onClick={() => setSort('record')}
          >
            Best record
          </button>
        </div>
        <p className="pooled-note" style={{ margin: 0 }}>
          Board size is the share of possessions the top eight carry, on one scale across all
          thirty. Only the stripes are exposure. Ranks within a point of each other are ties.
        </p>
      </div>

      <div className="tile-grid">
        {ordered.map((f) => (
          <button
            type="button"
            className="tile"
            key={f.team.abbr}
            onClick={() => onOpenTeam(f.team.abbr)}
            aria-label={`${f.team.name}, ${f.team.wins}-${f.team.losses}, ${f.wastedFitPct.toFixed(
              1,
            )}% exposure, rank ${rankLabel(ranks, f.team.abbr)}. Open board.`}
          >
            <span className="tile-mat">
              <Tile fit={f} rules={rules} maxLoad={maxLoad} size={240} />
            </span>
            <span className="tile-meta">
              <span
                className="team-chip"
                style={{ background: f.team.colors[0], borderColor: f.team.colors[1] }}
                aria-hidden="true"
              />
              <span className="tile-name" title={f.team.name}>
                {nickname(f.team.name)}
              </span>
              <span className="tile-record">
                {f.team.wins}-{f.team.losses}
              </span>
            </span>
            <span className="tile-bar" aria-hidden="true">
              <i style={{ width: `${(f.wastedFitPct / maxExposure) * 100}%` }} />
            </span>
            <span className="tile-fit">
              <span>{f.wastedFitPct.toFixed(1)}% exposure</span>
              <span style={{ color: 'var(--ink-3)' }}>#{rankLabel(ranks, f.team.abbr)}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
