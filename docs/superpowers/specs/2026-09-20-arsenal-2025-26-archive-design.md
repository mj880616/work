# Arsenal 2025-26 Match Archive Design

## Purpose and scope

Complete the existing personal Arsenal men's first-team archive as a season-long tactical record, not a results table. Keep the existing static page, schema and Korean analytical style. Add only missing 2025-26 Premier League and UEFA Champions League reviews. Do not modify Web1, Web2, read-think-write, Supabase, authentication, other personal pages or existing 2026-27 data. Work on a new branch and submit a PR without merging it.

## Confirmed baseline and 53-match inventory

The latest `origin/main` at design time is `6f5444357a730aad4b03da3f0c24706cc548ccd2`. The complete `personal/arsenal-match-archive/matches.js` parses as 27 records: seven from 2026-27, plus 15 Premier League and five Champions League records from 2025-26. No ID is duplicated. The 2025-26 records below are already present and must not be recreated.

| Competition | Existing matches |
| --- | --- |
| Premier League | 1R Manchester United A; 2R Leeds H; 3R Liverpool A; 4R Nottingham Forest H; 5R Manchester City H; 6R Newcastle A; 7R West Ham H; 8R Fulham A; 9R Crystal Palace H; 10R Burnley A; 11R Sunderland A; 12R Tottenham H; 13R Chelsea A; 14R Brentford H; 15R Aston Villa A |
| UEFA Champions League | League Phase MD1 Athletic Club A; MD2 Olympiacos H; MD3 Atlético de Madrid H; MD4 Slavia Praha A; MD5 Bayern München H |

The following 33 matches are absent. This is the work queue, not a claim that the provisional schedule date is the actual match date. Match-specific dates, venues, scores and events must be independently checked against completed-match reports before insertion. The 20 existing 2025-26 reviews also require a source and factual audit; correct only substantiated errors in place, never duplicate those records.

| Competition | Missing matches |
| --- | --- |
| Premier League | 16R Wolverhampton H; 17R Everton A; 18R Brighton H; 19R Aston Villa H; 20R Bournemouth A; 21R Liverpool H; 22R Nottingham Forest A; 23R Manchester United H; 24R Leeds A; 25R Sunderland H; 26R Brentford A; 27R Tottenham A; 28R Chelsea H; 29R Brighton A; 30R Everton H; 31R Wolverhampton A; 32R Bournemouth H; 33R Manchester City A; 34R Newcastle H; 35R Fulham H; 36R West Ham A; 37R Burnley H; 38R Crystal Palace A |
| UEFA Champions League | League Phase MD6 Club Brugge A; MD7 Inter A; MD8 Kairat Almaty H; Round of 16 first leg Leverkusen A; Round of 16 second leg Leverkusen H; Quarter-final first leg Sporting CP A; Quarter-final second leg Sporting CP H; Semi-final first leg Atlético de Madrid A; Semi-final second leg Atlético de Madrid H; Final Paris Saint-Germain, neutral venue |

Inventory authorities: Premier League 2025/26 fixture list at `https://www.premierleague.com/en/news/4324539` and UEFA's completed 2025/26 results at `https://www.uefa.com/uefachampionsleague/news/029c-1e9a2f63fe2d-ebf9ad643892-1000/`. Because league fixtures were rescheduled, the fixture list is used for round/opponent inventory only. The Champions League final ended 1-1 and Paris won the shootout 4-3; use `homeScore: 1`, `awayScore: 1`, `result: "패"`, and explicitly explain the shootout in `summary` and `events`.

## Record contract

Preserve the `window.ARSENAL_MATCHES` array and the page's `matches.js` → `app.js` loading order. Existing fields remain authoritative: `id`, `date`, `season`, `competition`, `round`, `venue`, `home`, `away`, `homeScore`, `awayScore`, `result`, `title`, `subtitle`, `verdict`, `summary`, `decisive`, `arteta`, `nextWatch`, `stats`, `opponentStats`, `sources`, and where substantiated `lineup`, `events`, `media`. Do not introduce a second renderer, data loader, schema or third-party dependency.

Every new record has a unique, date-based ID; `YYYY-MM-DD` date; `season: "2025-26"`; an exact competition string of `Premier League` or `UEFA Champions League`; and league rounds `1R` through `38R`. Champions League stages are `League Phase MD1` through `League Phase MD8`, `Round of 16 1st Leg`, `Round of 16 2nd Leg`, `Quarter-final 1st Leg`, `Quarter-final 2nd Leg`, `Semi-final 1st Leg`, `Semi-final 2nd Leg`, and `Final`. Scores are regulation plus extra-time match scores, with a separate shootout note where applicable. Preserve the existing Korean nominal sentence endings and distinguish observed match facts, attributed external interpretation and our season-spanning inference.

Each new review has approximately three `summary` items, three to four `decisive` items, approximately three `arteta` items and three to four `nextWatch` items. Discuss only supported tactical claims. Trace, where relevant rather than mechanically in every game, Raya's build-up and long kicks, the No. 9 role, target play and second balls, midfield combinations, full-back positions, opposite-wing output, high-press and low-block responses, rest defence, set pieces, in-game adjustments and strong away-match risk. Link hypotheses to the prior match and say what subsequent match would test them. Record major goals, red cards and consequential substitutions in `events`; use a sourced `lineup` when the full XI and substitutions can be verified.

## Research and provenance

For each missing game, verify core match facts with an official completed-match page from Arsenal, Premier League or UEFA where available, plus at least one independent reliable report or tactical analysis. Record both in `sources` with precise labels and working original URLs. Use Arsenal or competition match pages as the first choice for photo-gallery/highlight links in `media`; an opponent club's official gallery is acceptable. Do not download or copy copyrighted images. Leave `photos` absent unless a stable public image URL and permissible reuse are both established.

Check Arsenal and opponent possession, shots, xG and big chances where available. Mark an unverified value `"—"`. For xG, use one identified provider for both teams in a match and state the provider in a `sources` label; do not splice values from different providers. Source labels must make the provenance of other populated statistics clear as well. A link to a report containing a photograph is not relabelled as an official gallery. Check that media links point to the relevant game and are reachable; inaccessible or ambiguous links are omitted rather than guessed.

## Work sequence and files

Research and add five to eight chronologically related matches per batch, beginning with December and continuing through the May finale. Before each batch, compare against the current `matches.js` IDs and round inventory. After each batch, run JS syntax, duplicate-ID, round-uniqueness and season-count checks, and exercise the page. Review adjacent records' `nextWatch` hypotheses against the next researched game before committing that batch. Never rewrite the entire array wholesale or regenerate existing matches.

Only `personal/arsenal-match-archive/matches.js` should change for match content, including any source-proven corrections to existing 2025-26 records. Add a focused archive validation script or test under the same directory for durable count, schema and provenance checks. Change `app.js`, `index.html` or `styles.css` only if a demonstrated archive-page defect prevents the requested verification and the change is separately justified and tested. The design and implementation-plan documents live under `docs/superpowers/` and do not change a production page.

## Verification and completion

The validator must assert exactly 38 distinct Premier League rounds, exactly 15 distinct Champions League rounds/stages, exactly 53 total 2025-26 reviews, no duplicate IDs or invalid dates, required text blocks, at least two distinct source URLs for each added match, safe URL schemes, and no duplicate match identity. Compare the existing 2026-27 records against their baseline serialization to catch accidental mutation. Run Node syntax checks after every batch and full validation at completion.

Serve `personal/arsenal-match-archive/index.html` locally and run browser checks at desktop and mobile widths: season filter, both competition filters, clicked review identity, valid media link targets, no console errors and no layout overflow. Run relevant local repository checks and inspect all PR CI results; report any nonapplicable workflows separately. Do not merge if checks fail. The PR report states EPL 38/38, UCL 15/15, total 53, how many reviews have a verified actual photo-gallery or video link (not merely any `media` item), changed files, test/CI results, PR URL and any remaining evidentiary uncertainty. If a record lacks enough sources for a defensible tactical analysis, do not fabricate it or describe the archive as complete.
