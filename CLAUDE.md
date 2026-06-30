# CLAUDE.md

This file gives Claude Code (and other AI assistants) the context needed to work in this repository.

## What this repo is

A personal collection of small, independent Python monitoring bots that run on a schedule via
GitHub Actions. There is no shared application, server, or build system — each script is a
standalone "check something, notify if it changed" job triggered by cron. The repo also hosts a
static GitHub Pages site (`docs/`) that displays output from one of the bots.

All comments, commit messages, and notification text in this codebase are written in **Japanese**.
Follow that convention when editing existing scripts (English is fine for new, unrelated work, but
match the surrounding file's language).

## Scripts (each is independent, no shared imports between them)

| Script | Purpose | Target site(s) | Status file | Notification |
|---|---|---|---|---|
| `camp_monitor.py` | Watches タキノキャンプ場 (Takino campground) for a cancellation opening on 2026/06/20, スタンダードカーサイト | `takino.otomari.info` (Playwright, JS-driven calendar) | `camp_last_status.json` | Gmail |
| `camp_cancellation_monitor.py` | Watches 3 more campgrounds for cancellations on 2026-07-04〜07-05: 仲洞爺 + アルテン (なっぷ JSON API) and 財田 (reservation-resume page scrape) | `nap-camp.com` API, `489pro-x.com` | `camp_cancellation_status.json` | Gmail |
| `iphone17_monitor.py` | Watches Apple Japan's refurbished store for iPhone 17 listings | `apple.com/jp/shop/refurbished/iphone` (Playwright) | `iphone17_last_status.json` | Gmail |
| `news_collector.py` | Polls Google News RSS for keywords defined in `keywords.yaml`, across multiple personal-interest categories (Apple, 日本酒, 札幌再開発, キャンプ, 投資, 音楽AI, 住宅補助金), translates English headlines to Japanese, and writes results for the static site | Google News RSS | `docs/data/articles.json` (also doubles as the data store, not just dedup state) | ntfy push (per-category, optional) |

Each monitor script follows the same shape:
1. Load last-known status from a local JSON file (committed/cached between runs).
2. Scrape or call an API to get current status.
3. Compare to last status; send a notification **only on a state transition** (e.g. `full` →
   `available`), never on every run, to avoid spamming the recipient.
4. Persist the new status back to the JSON file.

When adding a new monitor, copy this pattern rather than inventing a new one.

## `docs/` — static site (GitHub Pages)

`docs/index.html` is a single-file, no-build static page ("マイニュース") that fetches
`docs/data/articles.json` client-side and renders a dark-themed news feed with category filters.
`news_collector.py` is the only writer of `docs/data/articles.json`. If you change that JSON's
shape, update both the writer (`news_collector.py`) and the reader (`docs/index.html`) together.

## GitHub Actions workflows (`.github/workflows/`)

- `camp_monitor.yml` — タキノ campground monitor. **`workflow_dispatch` only** (manual trigger),
  no cron. Caches Playwright's Chromium browser and the status JSON via `actions/cache`.
- `camp_cancellation_monitor.yml` — the 3-campground monitor. Runs every 15 minutes via cron, and
  **commits `camp_cancellation_status.json` back to the repo** after each run (uses
  `permissions: contents: write`, pushes with the `github-actions[bot]` identity).
- `iphone17_monitor.yml` — iPhone 17 monitor. **Disabled**: its cron line is commented out and only
  `workflow_dispatch` remains. The commit history shows it was intentionally turned off
  ("iPhone 17 監視の自動実行を停止"). Don't re-enable the schedule without being asked.
- `news_collector.yml` — news collector. Runs 4x/day on cron (7:00/12:00/18:00/22:00 JST) and
  commits `docs/data/articles.json` back to the repo, same bot-commit pattern as above.

Workflows that scrape with Playwright install dependencies from `camp_requirements.txt` and run
`playwright install chromium --with-deps`. Workflows that only use `requests`/`yaml` use their own
narrower requirements file — there is **no single shared requirements.txt**; each job installs only
what its script needs:
- `camp_requirements.txt` → `playwright` (used by `camp_monitor.py` and `iphone17_monitor.py`)
- `camp_cancellation_requirements.txt` → `requests`
- `news_requirements.txt` → `requests`, `pyyaml`, `deep-translator`

If you add a new script with a new dependency, add/extend the relevant requirements file rather
than installing globally — keep each workflow's install step minimal.

## Secrets / environment variables

All scripts read credentials from environment variables (GitHub Actions `secrets`), never hardcode
them:
- `GMAIL_SENDER`, `GMAIL_RECIPIENT`, `GMAIL_APP_PASSWORD` — used by all three Gmail-notifying
  scripts via `smtplib.SMTP_SSL` to `smtp.gmail.com:465`. If any is unset, the script logs an error
  and skips sending rather than crashing.
- `NTFY_TOPIC` — used by `news_collector.py` to push notifications via ntfy.sh. Deliberately kept
  out of `keywords.yaml` (which is checked in) and set only as a secret.

## Conventions to follow when editing

- **State files are the dedup mechanism.** Never remove the "skip notification if status
  unchanged" check — that's what prevents repeated emails every 15 minutes.
- **Japanese `[INFO]/[WARN]/[ERROR]` log prefixes** are used throughout for print-based logging
  (no logging framework). Match this style in new code.
- Scripts that scrape via Playwright spoof a desktop Chrome user-agent and `locale="ja-JP"`; keep
  this when touching scraping code, since target sites are Japan-only services.
- Selector-based scraping (CSS selectors, regex over page HTML, `CheckOnSubmit`/`CheckOnDetail` JS
  calls for `camp_monitor.py`) is inherently fragile — if a target site changes its markup, the
  fix is almost always in the single scraping function in that script, not elsewhere.
- `keywords.yaml` is the only config file for `news_collector.py` — add new interest categories or
  keywords there rather than hardcoding them in `news_collector.py`.
- `.gitignore` excludes `camp_debug*.{py,html,png}`, `*.log`, and the `*_last_status.json` files
  used by the two Playwright-based monitors (but **not** `camp_cancellation_status.json` or
  `docs/data/articles.json` — those are intentionally committed by their workflows).
- There are no tests in this repo. Verify changes by running a script locally (scripts are safe to
  dry-run; they only send mail/notifications on a detected state change) or by reasoning through
  the diff carefully — there's no CI gate beyond the scheduled jobs themselves.

## Local development

```bash
# Playwright-based scripts
pip install -r camp_requirements.txt
playwright install chromium --with-deps
python camp_monitor.py            # or iphone17_monitor.py

# requests-based scripts
pip install -r camp_cancellation_requirements.txt
python camp_cancellation_monitor.py

pip install -r news_requirements.txt
python news_collector.py
```

All scripts expect the relevant secrets as environment variables (see above) when run locally;
without them, notification sending is skipped but the check/scrape logic still runs and logs
results.
