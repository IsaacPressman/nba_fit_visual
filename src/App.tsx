import { useCallback, useEffect, useMemo, useState } from 'react'
import { rankByFit, scoreLeague } from './fit/model'
import type { Mode } from './fit/palette'
import { DEFAULT_RULES, type League, type Player, type Rules } from './fit/types'
import { FitChart, FitTable } from './components/FitChart'
import { LeagueGrid } from './components/LeagueGrid'
import { SvgDefs } from './components/SvgDefs'
import { TeamView } from './components/TeamView'
import { Tooltip, tooltip } from './components/Tooltip'
import { formatRoute, parseRoute, type Route, type View } from './route'

const HOME_TEAM = 'OKC'

function useMode(): [Mode, (m: Mode | null) => void, Mode | null] {
  const [choice, setChoice] = useState<Mode | null>(() => {
    try {
      const saved = localStorage.getItem('csp-theme')
      return saved === 'light' || saved === 'dark' ? saved : null
    } catch {
      return null
    }
  })
  const [system, setSystem] = useState<Mode>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    try {
      if (choice) localStorage.setItem('csp-theme', choice)
      else localStorage.removeItem('csp-theme')
    } catch {
      // storage can be blocked; the theme still applies for this visit
    }
    if (choice) document.documentElement.dataset.theme = choice
    else delete document.documentElement.dataset.theme
  }, [choice])

  return [choice ?? system, setChoice, choice]
}

/**
 * The route is the app's state. Changing view or team pushes a history entry so
 * Back works; a swap or a slider only replaces the current one, so dragging a
 * slider does not bury the previous page under a hundred entries.
 */
function useRoute(): [Route, (next: Partial<Route>, push?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash, HOME_TEAM))

  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash, HOME_TEAM))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const update = useCallback((next: Partial<Route>, push = false) => {
    setRoute((prev) => {
      const merged = { ...prev, ...next }
      const hash = formatRoute(merged)
      if (hash !== window.location.hash) {
        if (push) window.history.pushState(null, '', hash)
        else window.history.replaceState(null, '', hash)
      }
      return merged
    })
  }, [])

  return [route, update]
}

export default function App() {
  const [data, setData] = useState<League | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [route, go] = useRoute()
  const [textured, setTextured] = useState(false)
  const [mode, setMode, explicit] = useMode()

  const { view, rules } = route

  useEffect(() => {
    fetch('league.json')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json() as Promise<League>
      })
      .then(setData)
      .catch(() =>
        setError(
          'The league bundle is missing. Build it with: python pipeline/fetch_sources.py && cd pipeline && python build_data.py',
        ),
      )
  }, [])

  // a readout from the page you just left is never right on the next one
  useEffect(() => tooltip.hide(), [view, route.team])

  const fits = useMemo(() => (data ? scoreLeague(data.teams, rules) : []), [data, rules])
  const ranks = useMemo(() => rankByFit(fits), [fits])
  const team = data?.teams.find((t) => t.abbr === route.team) ?? data?.teams[0]

  const customRules = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES),
    [rules],
  )

  // a swap in the URL is only honoured if both ids still resolve
  const swap = useMemo((): { out: Player; in: Player } | null => {
    if (!data || !team || !route.swap) return null
    const out = team.players.find((p) => p.id === route.swap!.out)
    const incoming =
      data.league.find((p) => p.id === route.swap!.in) ??
      data.teams.flatMap((t) => t.players).find((p) => p.id === route.swap!.in)
    return out && incoming ? { out, in: incoming } : null
  }, [data, team, route.swap])

  const setView = (next: View) => go({ view: next, swap: null }, true)

  const open = (next: string) => {
    go({ view: 'team', team: next, swap: null }, true)
    window.scrollTo({ top: 0 })
  }

  const setRules = (next: Rules) => go({ rules: next })

  if (error) {
    return (
      <div className="shell">
        <div className="loading">{error}</div>
      </div>
    )
  }

  if (!data || !team) {
    return (
      <div className="shell">
        <div className="loading">Loading the 2025-26 rotations…</div>
      </div>
    )
  }

  return (
    <div className="shell">
      <SvgDefs mode={mode} />

      <header className="topbar">
        <span className="wordmark">
          Missing Pieces<span>{data.season}</span>
        </span>

        <nav className="tabs" aria-label="Views">
          <button
            type="button"
            aria-current={view === 'league' ? 'page' : undefined}
            onClick={() => setView('league')}
          >
            All 30 teams
          </button>
          <button
            type="button"
            aria-current={view === 'team' ? 'page' : undefined}
            onClick={() => setView('team')}
          >
            Teams
          </button>
          <button
            type="button"
            aria-current={view === 'chart' ? 'page' : undefined}
            onClick={() => setView('chart')}
          >
            Fit vs record
          </button>
        </nav>

        {view === 'team' && (
          <>
            <label htmlFor="team-picker" className="visually-hidden">
              Team
            </label>
            <select
              id="team-picker"
              className="picker"
              value={team.abbr}
              onChange={(e) => go({ team: e.target.value, swap: null }, true)}
            >
              {[...data.teams]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <option key={t.abbr} value={t.abbr}>
                    {t.name}
                  </option>
                ))}
            </select>
          </>
        )}

        <span className="spacer" />

        <button
          type="button"
          className="ghost"
          aria-pressed={textured}
          onClick={() => setTextured((v) => !v)}
          title="Adds a directional fill to each supplier's color, for when hue alone is hard to separate"
        >
          Patterns
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setMode(explicit === null ? (mode === 'dark' ? 'light' : 'dark') : null)}
          title={explicit === null ? 'Following your system theme' : 'Follow the system theme'}
        >
          {mode === 'dark' ? 'Dark' : 'Light'}
          {explicit === null && <span className="theme-sys"> (system)</span>}
        </button>
      </header>

      <main>
        {view === 'team' && (
          <TeamView
            key={team.abbr}
            data={data}
            team={team}
            fits={fits}
            ranks={ranks}
            rules={rules}
            customRules={customRules}
            mode={mode}
            textured={textured}
            swap={swap}
            onSwap={(s) => go({ swap: s ? { out: s.out.id, in: s.in.id } : null })}
            onRules={setRules}
          />
        )}

        {view === 'league' && (
          <LeagueGrid
            fits={fits}
            ranks={ranks}
            rules={rules}
            mode={mode}
            onOpenTeam={open}
            onOpenChart={() => {
              setView('chart')
              window.scrollTo({ top: 0 })
            }}
          />
        )}

        {view === 'chart' && (
          <>
            <div className="team-head">
              <h1>Does fit explain the standings?</h1>
            </div>
            <div className="chart-wrap">
              <FitChart fits={fits} rules={rules} onOpenTeam={open} />
            </div>
            <div className="folds">
              <details>
                <summary>
                  All 30, ranked <span className="hint">table view</span>
                </summary>
                <div className="fold-body">
                  <FitTable fits={fits} ranks={ranks} />
                </div>
              </details>
            </div>
          </>
        )}
      </main>

      <Tooltip />
    </div>
  )
}
