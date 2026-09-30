/**
 * Everything worth sharing lives in the hash: the view, the team, a swap, and
 * any rules moved off their defaults. `#/team/BOS?swap=jrueholiday|POR~...`
 * opens straight onto that board with that player seated, which is what makes
 * the assembly worth leading with in a shared link.
 *
 * Rules travel as a diff against the defaults, so an untouched panel adds
 * nothing to the URL and a link keeps working if an unrelated default moves.
 */
import { DEFAULT_RULES, type Rules } from './fit/types'

export type View = 'team' | 'league' | 'chart'

/** The seasons there is a bundle for; the first is the default and stays out of URLs. */
export const SEASONS = ['2025-26', '2026-27'] as const
export type Season = (typeof SEASONS)[number]
export const DEFAULT_SEASON: Season = SEASONS[0]

export interface Route {
  view: View
  season: Season
  team: string
  swap: { out: string; in: string } | null
  rules: Rules
}

type Diff = { [k: string]: number | Diff }

function diff(a: object, b: object): Diff | undefined {
  const out: Diff = {}
  for (const [k, v] of Object.entries(a)) {
    const base = (b as Record<string, unknown>)[k]
    if (typeof v === 'number') {
      if (v !== base) out[k] = v
    } else if (v && typeof v === 'object' && base && typeof base === 'object') {
      const d = diff(v, base)
      if (d) out[k] = d
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Merge a diff onto the defaults, keeping only keys and types that exist there. */
function apply<T extends object>(base: T, d: unknown): T {
  if (!d || typeof d !== 'object') return base
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    const cur = out[k]
    if (typeof cur === 'number' && typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (cur && typeof cur === 'object') out[k] = apply(cur as object, v)
  }
  return out as T
}

const encode = (s: string) =>
  btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const decode = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'))

export function parseRoute(hash: string, fallbackTeam: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [head, abbr] = path.split('/')
  const params = new URLSearchParams(query)

  // the league grid is the front door; anything unrecognised lands there too
  const view: View = head === 'team' || head === 'chart' ? head : 'league'

  let rules = DEFAULT_RULES
  const r = params.get('rules')
  if (r) {
    try {
      rules = apply(DEFAULT_RULES, JSON.parse(decode(r)))
    } catch {
      rules = DEFAULT_RULES
    }
  }

  const asked = params.get('season')
  const season = (SEASONS as readonly string[]).includes(asked ?? '')
    ? (asked as Season)
    : DEFAULT_SEASON

  const s = params.get('swap')?.split('~')
  const swap = s && s.length === 2 && s[0] && s[1] ? { out: s[0], in: s[1] } : null

  return {
    view,
    season,
    team: (view === 'team' && abbr ? abbr : fallbackTeam).toUpperCase(),
    swap: view === 'team' ? swap : null,
    rules,
  }
}

export function formatRoute(route: Route): string {
  const params = new URLSearchParams()
  if (route.season !== DEFAULT_SEASON) params.set('season', route.season)
  if (route.view === 'team' && route.swap) {
    params.set('swap', `${route.swap.out}~${route.swap.in}`)
  }
  const d = diff(route.rules, DEFAULT_RULES)
  if (d) params.set('rules', encode(JSON.stringify(d)))
  const q = params.toString()
  const path = route.view === 'team' ? `/team/${route.team}` : `/${route.view}`
  // URLSearchParams escapes the separators; they are safe in a fragment
  return `#${path}${q ? `?${q.replace(/%7C/gi, '|').replace(/%7E/gi, '~')}` : ''}`
}
