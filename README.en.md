# Xiaoyu Studio · dsh-xiaoyu-novel

[中文](README.md) | English

> A pen that keeps watch over your manuscript.

Xiaoyu Studio is a web-novel writing assistant plugin for **DSH (DeepSeek Harness)**. Once installed, your main AI agent stops being a chat box and becomes an **editor-in-chief**: it leads an outliner, a drafter, a de-AI polisher, a reviewer, a lore keeper and a researcher to take one long serial novel from premise to finished draft.

The whole novel is a `novel/` directory in your workspace — plain Markdown and YAML. No database, no API layer, no migrations. "Show every unresolved foreshadow" is one line of grep.

**Version**: 3.25.1 · **License**: MIT · **Runtime dependencies**: none · **Runs on**: DSH Web on Windows / macOS / Linux / Android

---

## Contents

- [What it solves](#what-it-solves)
- [Install](#install)
- [Five-minute start](#five-minute-start)
- [The studio panel](#the-studio-panel)
- [The writing workflow](#the-writing-workflow)
- [Command line](#command-line)
- [The novel/ directory](#the-novel-directory)
- [Skill packs](#skill-packs)
- [Style presets](#style-presets)
- [Quality tools](#quality-tools)
- [Updates and China-friendly mirrors](#updates-and-china-friendly-mirrors)
- [FAQ](#faq)
- [The name and acknowledgments](#the-name-and-acknowledgments)

---

## What it solves

Writing a long serial with AI fails not at "draft one chapter" but at these:

| Pain | How Xiaoyu Studio answers it |
|---|---|
| By chapter 80 the AI forgot the foreshadowing planted in chapter 12 | **Foreshadow state machine**: planted → progressing → resolved/abandoned, each with chapter numbers and expected payoff |
| Black eyes today, red hair tomorrow | **Continuity audit**: character-card attributes cross-checked against prose; impossible timelines flagged |
| Dozens of pages of lore nobody reads | **Living bible**: used lore gets a timestamp and floats to the top; unused lore sinks |
| Every chapter reads like assembly line output | **Per-chapter de-AI gate**: human-voice score below the bar sends the chapter back |
| Drift from the outline, chapters ending flat | **Chapter blueprint**: goal / conflict / hook must be filled before drafting |
| Spoiling what readers must not know yet | **Information-gap guard**: reader-unknown threads are forbidden in prose, dialogue and inner monologue |
| Platform rejection after publishing | **Compliance scan**: three-tier sensitive-word lexicon per chapter |
| No idea what genre is hot | **Genre radar**: Fanqie public rank pages aggregated into a category board, with an offline snapshot fallback |

---

## Install

### From the panel (recommended)

1. Download the latest `dsh-xiaoyu-novel-x.y.z.zip` from [Releases](https://github.com/gqpG10/dsh-xiaoyu-novel/releases)
2. In DSH run `dsha-plugin import <path to zip>`
3. Restart DSH Web

### From the command line

```bash
dsha-plugin import ./dsh-xiaoyu-novel-3.25.1.zip
```

**Xiaoyu Studio** then appears in the sidebar panel list.

---

## Five-minute start

```bash
xiaoyu-novel init ./my-book      # create novel/ with all nine starter sets
xiaoyu-novel setup ./my-book     # check the opening checklist (exit 1 if incomplete)
xiaoyu-novel handoff ./my-book   # register novel/ as a DSH workspace
```

Then tell the editor-in-chief in DSH: **"Use Xiaoyu Studio, finish the setting for my book, then write chapter one."**

The editor advances through idea → setting → outline → writing → review → consistency → export, reporting at each milestone and stopping for your sign-off where a human decision belongs.

---

## The studio panel

A standalone single page — no host CSS dependencies, dark theme, usable on a phone held upright. Fifteen tabs:

| Tab | What it does |
|---|---|
| **Overview** | Book metadata, volume plan, today's word gain, a 120-day writing heatmap, streak |
| **Project** | project.yml form editing; **genre radar**; decisions ledger |
| **Chapters** | Chapter list sortable by gate score, one click into the reader |
| **Gate** | Per-chapter human-voice score, batch fixes, **compliance scan** card |
| **Audit** | **Six-dimension quality trend**, **continuity audit**, cross-chapter repeats, zero-appearance characters, word-count outliers, flat endings |
| **Todos** | Issue checklist |
| **This chapter** | Everything needed before drafting: cast, due foreshadowing, background threads, **spoiler guard**, **previous-chapter memory**, **blueprint form**, **context pack** |
| **Characters** | Character cards, **attendance matrix** (cast × chapter grid), appearance heatmap |
| **Foreshadowing** | Ledger with state transitions and payoff scheduling |
| **Relations** | Force-directed relation graph with drift control, dedupe maintenance |
| **Timeline** | Timeline view and editing |
| **World** | Worldbuilding, science/tech, research notes; **living bible** ordering |
| **Index** | Chapter index and clue board |
| **Style** | Style presets, one-click apply |
| **Tools** | Name generator, ledger cleaning, slimming, export, version history, Git operations |

Reader page: outline alongside prose, save with 409 conflict protection, sentence-level de-AI suggestions with one-click apply, whole-chapter conservative rewrite with undo, copy entire chapter.

---

## The writing workflow

### Seven phases

`idea → setting → outline → writing → review → consistency → export`

The phase lives in `novel/project.yml`. Advancing has hard criteria (core setting on disk, volume plan and first three outlines in place before writing); unmet criteria send you back.

### Seven steps per chapter

1. **Continuity check** — read the previous ending and this chapter's outline
2. **Blueprint** — goal / conflict / hook (the "This chapter" tab form)
3. **Draft** — the drafter writes, given only this chapter's cast and threads
4. **De-AI polish** — the polisher rewrites; the scanner runs before and after
5. **Review** — the reviewer works the seven-layer checklist
6. **Revise** — apply the checklist
7. **Finalize** — write back foreshadowing, character states, timeline, chapter memory

### Editor-in-chief plus six helpers

| Role | Responsibility |
|---|---|
| **Editor-in-chief (main agent)** | Planning, continuity, acceptance, state advancement |
| Outliner | Volume arcs, chapter outlines, pacing curves |
| Drafter | Writes prose from blueprint and context |
| De-AI polisher | Twelve surgery moves: cut clichés, split long sentences, add sensory detail |
| Reviewer | Seven-layer checklist (read-only) |
| Lore keeper | Character cards, settings, foreshadowing, relations, timeline |
| Researcher | Web research, separating fact / consensus / legend, with sources |

---

## Command line

```bash
xiaoyu-novel <command> [dir]
```

| Command | Purpose |
|---|---|
| `init` | Create a book: scaffold the nine starter sets |
| `setup` | Opening checklist (exit 1 when incomplete) |
| `check` | Hard format validation (keys, order, fences, filenames, index consistency) |
| `stats` / `wc` | Word counts |
| `index` | Rebuild the chapter index |
| `brief` | Writing brief: previous context plus this chapter's essentials |
| `gate` | De-AI scoring for one chapter or the whole book |
| `report` | Write gate/audit reports to disk |
| `audit` | Whole-book audit |
| `ledger` / `clean` | Foreshadow ledger stats and cleanup |
| `relations` | Deduplicate relation records (dry-run unless `--apply`) |
| `find` | Full-book search |
| `export` | Export the book as txt / docx / epub |
| `handoff` | Handoff / workspace registration |
| `slim` | Archive older chapters |
| `undo` | Undo the last write |
| `history` / `git-*` | Chapter snapshots and Git operations |
| `progress` | Writing progress ledger |
| `portable` | Bundle into a portable package |
| `doctor` | Environment check (Python / Node / permissions / paths) |
| `update` | Check for and apply updates |
| `token` | Inspect or set the update-channel token |

---

## The novel/ directory

```
novel/
├── project.yml          Book metadata (title, genre, phase, mode)
├── volumes.yml          Volume plan
├── chapters/            Prose, one file per chapter (v01-c001.md)
├── outlines/            Chapter outlines, paired by filename
├── characters/          Character cards
├── world/               Worldbuilding (the living bible)
├── science/             Science and technology settings
├── research/            Research notes with sources
├── foreshadows.yml      Foreshadow ledger (state machine)
├── relations.yml        Relationship ledger
├── timeline.yml         Timeline
├── clue-board.yml       Clue board
├── decisions.yml        Decisions ledger
├── memories.yml         Narrative memory
├── index.yml            Chapter index
├── style.md             Style baseline
├── blueprints/          Chapter blueprints (3.22.0+)
├── memory/              Post-chapter memory summaries (3.23.0+)
├── reports/             Audit reports, radar snapshots
└── exports/             Exported deliverables
```

Everything is grep-friendly YAML and Markdown: humans edit it directly, Git versions it, and copying the folder to another machine continues the book.

---

## Skill packs

The plugin ships ten reusable skills (`skills/`), callable from DSH:

| Skill | Purpose |
|---|---|
| `xiaoyu-book-setup` | Contents and pass marks for the nine starter sets |
| `xiaoyu-golden-opening` | The golden first three chapters; four opening archetypes |
| `xiaoyu-beat-pacing` | Payoff rhythm, tension/release ratio, chapter hooks |
| `xiaoyu-suspense-craft` | Paradoxical suspense, information-gap quadrants |
| `xiaoyu-volume-craft` | Volume design, five-step plot cycle, ensemble screen time |
| `xiaoyu-foreshadow-discipline` | Planting, advancing and paying off foreshadowing |
| `xiaoyu-qu-ai-wei` | Five symptom layers, twelve rewrite surgeries |
| `xiaoyu-review-checklist` | Seven-layer review checklist with P0/P1/P2 severity |
| `xiaoyu-reader-review` | The serial reader's view: expectation ledger, pacing feel |
| `xiaoyu-teardown` | Book teardown: structural skeleton plus style fingerprint |

---

## Style presets

`templates/novel/style-presets/` ships 19 presets, one-click from the **Style** tab:

- **Commercial**: `fanqie`, `qidian`, `qimao`, `fast`, `plain`, `humor`, `tomatohumor`, `suspense`, `tianchong`, `zhongtian`
- **Literary**: `classical`, `epic`, `romance`, `nuelian`, `warm`, `niandai`, `guize`, `semi`, `minimal`

Each defines concrete constraints — sentence length, paragraph rhythm, dialogue density, banned patterns, chapter-ending hook style — not adjectives.

---

## Quality tools

**De-AI gate** — every chapter runs the bundled scanner before and after polishing: human-voice index below 78, or any hard-fail dimension, sends it back. Five detector lenses: sentence-length burst ≥ 0.55, connectives ≤ 6 per 1k characters, four-character idioms ≤ 1.5 per 1k, colloquial markers ≥ 5 per 1k, punctuation variety ≥ 6. Style only — plot, dialogue meaning and foreshadow positions stay untouched, word count within ±10%.

**Six-dimension trend** — human voice · payoff · hook · rhythm · consistency · pull, scored per chapter into six trend lines; three consecutive chapters averaging under 45 on pull raises an alert.

**Compliance scan** — three tiers (reject / risk / notice), matches shown with context; extend the lexicon with `novel/compliance.yml`.

**Continuity audit** — character-card attributes versus prose, plus impossible timelines.

**Whole-book audit** — cross-chapter repeats, zero-appearance characters, unfilled outline names, word-count outliers, flat endings, exported as a report.

---

## Updates and China-friendly mirrors

The panel's update check races several sources in parallel: GitHub REST API (token / anonymous), raw main branch, four public mirrors, and **Gitee tags**. First valid tag wins, converging in about eight seconds per source. Downloads race four ways too (REST tarball / codeload / mirror chain / Gitee archive), each to its own `.part` file, with the first to verify being renamed into place.

When GitHub is unreachable the Gitee channel still works — which is why this repository is mirrored there.

Escape hatches:

```bash
XIAOYU_GITHUB_REPO=off      # Gitee only
XIAOYU_GITEE_REPO=off       # GitHub only
XIAOYU_GH_MIRRORS=...       # override the mirror chain
```

---

## FAQ

**Does it need Python?**
The de-AI scanner (`aiwei_scan.py`) does. Without it the panel notes "python3 missing, score unavailable" and everything else works. `xiaoyu-novel doctor` checks the environment.

**Can I use it on a phone?**
Yes — the panel is a standalone page with a portrait layout, and the Windows and Android builds run the same test suite.

**Where is my manuscript?**
In your own workspace `novel/` directory, as plain text. Nothing is uploaded, nothing is reformatted; copy the folder and keep writing.

**Can it publish to Fanqie / Qidian directly?**
No. The plugin never touches author backends. The compliance scan is a pre-flight self-check; export supports txt / docx / epub.

**Will it corrupt my drafts?**
Every write is validated (format, structure, hash). Files changed externally are refused with a 409 until refreshed. Chapters have snapshots and undo; `ledger clean` and `relations` default to dry-run and back up before writing.

---

## The name and acknowledgments

### The name

"Xiaoyu" (小鱼) is this plugin's own name, meaning simply "the pen" — writers know that what does the work is never inspiration but the pen, gripped until it turns hot.

(A correction in passing: what Han Yu wrote was *Mao Ying Zhuan*, personifying the writing brush as "Mao Ying". Xiaoyu has nothing to do with it; misattributed lore is lore the author will not carry.)

### Acknowledgments

This plugin ships with zero third-party runtime dependencies (`dependencies: {}`), but many of its ideas were learned from the projects below:

**Design and structure**

- [Pagekin](https://github.com/EthanYoQ/Pagekin) — the chapter-blueprint pattern.
- [oh-story-claudecode](https://github.com/zenstory-ai/oh-story-claudecode) — "load only what you would get wrong without" and per-chapter quality records.
- [webnovel-writer](https://github.com/lingfengQAQ/webnovel-writer) — the six review dimensions.
- [chronicler](https://github.com/a9549521/chronicler) and [ai-creation](https://github.com/z19910928-afk/ai-creation) — author-owns-assets and post-chapter memory.
- [novel-skills](https://github.com/aeopress/novel-skills) — the living bible and continuity checklist.
- [sumeru](https://github.com/xindoo/sumeru) — three-tier sensitive-content screening.
- [fanqie-radar](https://github.com/WindXRan/fanqie-radar) — zero-dependency rank scraping into local snapshots.
- StoryGraphs — the cast × chapter attendance grid.
- obsidian-writing-studio — writing sprints.
- obsidian-snowflake-method — the ten-step snowflake wizard.
- open-wrimo — seven-day average and best-day statistics.
- random_chinese_fantasy_names — category-based name generation.
- graphify-novel — hub detection for ensemble casts.

**Platforms and tools**

- [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) — the host.
- [Node.js](https://nodejs.org/) — ustar/gzip, YAML parsing and ZIP packaging are all standard library.
- [node:test](https://nodejs.org/api/test.html) — all 339 tests run on it.
- Fanqie public ranking pages, Gitee and GitHub — the radar reads public data only.

**If something is missing**

Code accumulates; so do borrowed ideas. If a project is missing from this list, tell the author and it will be added right away.

---

## License

[MIT](LICENSE) © 2026 lifangjin

This project provides writing-assistance tooling and is not responsible for the content users create with it.
