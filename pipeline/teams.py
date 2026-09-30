"""Team identity: name, Basketball-Reference code, and the two official colors
used to derive each roster's per-player palette in the app."""

TEAMS = {
    "ATL": ("Atlanta Hawks",          "ATL", "#e03a3e", "#26282a"),
    "BKN": ("Brooklyn Nets",          "BRK", "#000000", "#777d84"),
    "BOS": ("Boston Celtics",         "BOS", "#007a33", "#ba9653"),
    "CHA": ("Charlotte Hornets",      "CHO", "#1d1160", "#00788c"),
    "CHI": ("Chicago Bulls",          "CHI", "#ce1141", "#1d1160"),
    "CLE": ("Cleveland Cavaliers",    "CLE", "#860038", "#fdbb30"),
    "DAL": ("Dallas Mavericks",       "DAL", "#00538c", "#b8c4ca"),
    "DEN": ("Denver Nuggets",         "DEN", "#0e2240", "#fec524"),
    "DET": ("Detroit Pistons",        "DET", "#c8102e", "#1d42ba"),
    "GSW": ("Golden State Warriors",  "GSW", "#1d428a", "#ffc72c"),
    "HOU": ("Houston Rockets",        "HOU", "#ce1141", "#c4ced4"),
    "IND": ("Indiana Pacers",         "IND", "#002d62", "#fdbb30"),
    "LAC": ("Los Angeles Clippers",   "LAC", "#c8102e", "#1d428a"),
    "LAL": ("Los Angeles Lakers",     "LAL", "#552583", "#fdb927"),
    "MEM": ("Memphis Grizzlies",      "MEM", "#5d76a9", "#12173f"),
    "MIA": ("Miami Heat",             "MIA", "#98002e", "#f9a01b"),
    "MIL": ("Milwaukee Bucks",        "MIL", "#00471b", "#eee1c6"),
    "MIN": ("Minnesota Timberwolves", "MIN", "#0c2340", "#78be20"),
    "NOP": ("New Orleans Pelicans",   "NOP", "#0c2340", "#c8102e"),
    "NYK": ("New York Knicks",        "NYK", "#006bb6", "#f58426"),
    "OKC": ("Oklahoma City Thunder",  "OKC", "#007ac1", "#ef3b24"),
    "ORL": ("Orlando Magic",          "ORL", "#0077c0", "#c4ced4"),
    "PHI": ("Philadelphia 76ers",     "PHI", "#006bb6", "#ed174c"),
    "PHX": ("Phoenix Suns",           "PHO", "#1d1160", "#e56020"),
    "POR": ("Portland Trail Blazers", "POR", "#e03a3e", "#1d1160"),
    "SAC": ("Sacramento Kings",       "SAC", "#5a2d81", "#63727a"),
    "SAS": ("San Antonio Spurs",      "SAS", "#c4ced4", "#000000"),
    "TOR": ("Toronto Raptors",        "TOR", "#ce1141", "#a1a1a4"),
    "UTA": ("Utah Jazz",              "UTA", "#002b5c", "#00471b"),
    "WAS": ("Washington Wizards",     "WAS", "#002b5c", "#e31837"),
}

BBREF_TO_ABBR = {bbref: abbr for abbr, (_, bbref, _, _) in TEAMS.items()}
