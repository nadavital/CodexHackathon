# Frontend Worktrees Playbook (v3, Component-First)

Use this playbook to move fast with parallel worktrees and near-zero merge conflicts.

## Locked visual source of truth

All UI work must match these files:

- `uiconcepts/homescreen.png`
- `uiconcepts/individualfolder.png`

Do not add visual concepts not present in these screens unless the user explicitly asks.

## Required skill

Every frontend worktree must use:
`[$project-memory-openai-ui](/Users/nadav/Desktop/Hackathon/skills/project-memory-openai-ui/SKILL.md)`

## Core strategy

1. Migrate from monolith (`public/app.js`, `public/styles.css`) to modular components.
2. Give each worktree exclusive file ownership.
3. Use one scaffold phase, one parallel phase, and one compose phase.
4. Merge in strict order.

## Non-negotiable rules

1. Never work directly on local `main`.
2. Run preflight before editing:

```bash
pwd
git branch --show-current
git status --short
```

3. Frontend worktrees must not modify:
- `src/*`
- `mcp/*`
- `openclaw/*`
- `data/*.db*`

4. Keep branch names as `codex/wt-<name>`.
5. Ask the worktree-specific question pack before writing code.

## Target modular file layout

The scaffold branch creates this structure:

```text
public/
  index.html
  app/
    main.js
    router.js
    pages/
      home-page.js
      folder-page.js
    state/
      store.js
    services/
      api-client.js
      mappers.js
    components/
      topbar/
        topbar.js
      home-folder-grid/
        home-folder-grid.js
      home-recent-list/
        home-recent-list.js
      folder-hero-toolbar/
        folder-hero-toolbar.js
      folder-item-grid/
        folder-item-grid.js
      composer/
        composer.js
  styles/
    tokens.css
    base.css
    pages/
      home.css
      folder.css
    components/
      topbar.css
      home-folder-grid.css
      home-recent-list.css
      folder-hero-toolbar.css
      folder-item-grid.css
      composer.css
```

## Worktree plan

### Phase 1: Scaffold first (single worktree, no parallel edits yet)

Branch: `codex/wt-ui-shell`

Goal:
- Create modular folders/files above.
- Move existing monolith behavior into `pages/*`, `services/*`, and `state/*` scaffolds.
- Wire empty component placeholders so later branches only touch owned component files.

Owned files:
- `public/index.html`
- `public/app/main.js`
- `public/app/router.js`
- `public/app/pages/home-page.js`
- `public/app/pages/folder-page.js`
- `public/styles/tokens.css`
- `public/styles/base.css`
- `public/styles/pages/home.css`
- `public/styles/pages/folder.css`

Do not implement detailed component visuals here. Only shell + plumbing.

### Phase 2: Parallel component worktrees

Create all branches from latest `main` after `codex/wt-ui-shell` is merged.

#### A. Top bar

Branch: `codex/wt-ui-topbar`

Image slice:
- Top header row from both screens (logo/title, breadcrumb where relevant, search, settings).

Owned files:
- `public/app/components/topbar/topbar.js`
- `public/styles/components/topbar.css`

Question pack:
1. Should the home screen header text stay "Smart File Manager" or switch to "Project Memory"?
2. In folder view, should breadcrumb be clickable for each segment?
3. Keep settings as icon-only, or icon + label?

#### B. Home folder grid

Branch: `codex/wt-ui-home-folder-grid`

Image slice:
- Folder cards grid in `homescreen.png`.

Owned files:
- `public/app/components/home-folder-grid/home-folder-grid.js`
- `public/styles/components/home-folder-grid.css`

Question pack:
1. Should folder card count show exact counts from API or placeholder until loaded?
2. Keep three-dot menu visible always or on hover?
3. Should clicking a folder navigate immediately or single-click select + double-click open?

#### C. Home recent list

Branch: `codex/wt-ui-home-recent-list`

Image slice:
- "Recent Files" block in `homescreen.png`.

Owned files:
- `public/app/components/home-recent-list/home-recent-list.js`
- `public/styles/components/home-recent-list.css`

Question pack:
1. Max rows in recent list before scroll (e.g., 4, 6, 8)?
2. Show file type icon only, or icon + source badge?
3. Should row click open folder context directly?

#### D. Folder hero + toolbar

Branch: `codex/wt-ui-folder-hero-toolbar`

Image slice:
- Folder heading block + filter tabs + "New" action in `individualfolder.png`.

Owned files:
- `public/app/components/folder-hero-toolbar/folder-hero-toolbar.js`
- `public/styles/components/folder-hero-toolbar.css`

Question pack:
1. Keep tabs exactly `All / Images / Videos / Favorites` or map to memory types?
2. Should "New" open capture composer focus or a modal?
3. Should filter button open a dropdown or cycle preset filters?

#### E. Folder item grid

Branch: `codex/wt-ui-folder-item-grid`

Image slice:
- Main content cards grid in `individualfolder.png`.

Owned files:
- `public/app/components/folder-item-grid/folder-item-grid.js`
- `public/styles/components/folder-item-grid.css`

Question pack:
1. Keep metadata line as "Uploaded <time>" or use project-specific timestamps?
2. Show favorite star on selected cards only or persisted where tagged?
3. Should card menu be always visible or on hover?

#### F. Shared composer

Branch: `codex/wt-ui-composer`

Image slice:
- Bottom input bar from both screens.

Owned files:
- `public/app/components/composer/composer.js`
- `public/styles/components/composer.css`

Rules:
- No voice controls.
- Fixed structure: plus button, folder picker, text input, send action.

Question pack:
1. Placeholder copy for home vs folder view: same text or contextual text?
2. Send action style: icon-only or text button?
3. Plus button should open file picker immediately, or action menu?

#### G. Data adapter and state

Branch: `codex/wt-ui-adapter`

Owned files:
- `public/app/services/api-client.js`
- `public/app/services/mappers.js`
- `public/app/state/store.js`

Rules:
- No visual CSS changes.
- Support current backend + fallback mode.
- Expose stable page/view model shape to UI components.

Question pack:
1. Which folder ID/name should be default selected on initial load?
2. Should failed endpoints show stale cache or empty state first?
3. Confirm required fields for each card (title, preview, timestamp, tags).

### Phase 3: Compose/integration worktree

Branch: `codex/wt-ui-compose`

Goal:
- Import all component modules into pages.
- Ensure `home-page` and `folder-page` use components without file ownership violations.
- Final responsive pass and interaction glue.

Owned files:
- `public/app/main.js`
- `public/app/router.js`
- `public/app/pages/home-page.js`
- `public/app/pages/folder-page.js`
- `public/styles/base.css`
- `public/styles/pages/home.css`
- `public/styles/pages/folder.css`

Must not edit component-owned files.

## Merge order (strict)

1. Merge `codex/wt-ui-shell` to `main`.
2. Merge in any order:
- `codex/wt-ui-topbar`
- `codex/wt-ui-home-folder-grid`
- `codex/wt-ui-home-recent-list`
- `codex/wt-ui-folder-hero-toolbar`
- `codex/wt-ui-folder-item-grid`
- `codex/wt-ui-composer`
- `codex/wt-ui-adapter`
3. Merge `codex/wt-ui-compose` last.

## Per-worktree completion checklist

1. Only owned files changed.
2. Component matches only its assigned image slice.
3. Loading, empty, success, error states covered for the component.
4. Desktop + mobile sanity check done.
5. Handoff notes include any unanswered design questions.

## Handoff template

```text
Skill used: $project-memory-openai-ui
Worktree branch: <branch>
Image slice implemented: <exact slice>
User answers applied:
- ...

Files changed:
- ...

States covered:
- Loading:
- Empty:
- Success:
- Error:

Scope check:
- Only owned files touched: yes/no

Open questions:
- ...
```
