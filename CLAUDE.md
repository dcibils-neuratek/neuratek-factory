<!-- Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE. -->
# Neuratek Factory

Where Neuratek's people and coding agents build software together: projects
as boards of cards, a queue agents take work from, what every agent is doing
now (Live), discussions, decisions, and My work. `README.md` says what it is
and lists every route; `docs/platform.md` is where it is going and what has
been decided. **Read both before proposing anything.**

## What it is made of

Three pieces, and no build step anywhere:

| Piece | File | |
|---|---|---|
| The API | `src/worker.js` | one Cloudflare Worker, plain JavaScript |
| The data | `schema.sql` | one D1 (SQLite) database for every project |
| The page | `public/index.html` | one file: its CSS, its JavaScript, no framework |

Around them:

- `keys.py` - people and keys from the command line (`person add`, `make`, `list`, `revoke`).
- `demo.sql` - the demo project every signed-in person sees; applying it again remakes it.
- `migrations/` - changes for a database made before them; `schema.sql` is always the whole of it.
- `test_board.py` - the test: the API against `wrangler dev`, then `test_page.mjs` in headless Chrome.
- `screenshots.py` / `screenshots.mjs` - the README's pictures, taken from the demo.
- `routes.py` - copies the README's route table into the page's API view.
- `docs/` - the plan (`platform.md`) and the drawings agreed before building (`factory.html`, `live.html`).

## Running it

```bash
npm install -g wrangler                 # once
cp wrangler.example.toml wrangler.toml  # once; fill in your own database id and address
python3 test_board.py                   # the whole test - must pass before any commit
python3 screenshots.py                  # after a visible change: the README's pictures again
```

`test_board.py` makes a throwaway local database, starts `wrangler dev`,
plays Cloudflare Access with keys of its own, and drives the API and then the
page. It needs `wrangler`, `node` 22 or later and Google Chrome (`CHROME=` to
point elsewhere). It prints `PASS: N checks` or every failure.

## How work is done here

**Every feature is planned before it is built.** Agreed features go into
`docs/platform.md` the day they are agreed, with whose words asked for them.
A new view is drawn first as an HTML page in `docs/` with made-up data,
agreed, and then built to match - `docs/live.html` is the drawing Live was
built from. When a decision changes something written, correct the text
rather than adding an exception beside it.

**Everything that is finished leaves a test.** An API change gets checks in
`test_board.py`; something on the page, a check in `test_page.mjs`. The test
passes before a commit, and checks are never deleted to make it pass.

**A route is written in three places, together**: its code in
`src/worker.js`, its row in `README.md`'s API table, and then
`python3 routes.py` so the page's API view lists it.

**A change to the database is two changes**: the table as it should be in
`schema.sql`, and a file in `migrations/` that brings an existing database
there. A migration is applied once, by whoever deploys.

**The page stays one file with no build step.** It uses `el(tag, props,
...children)` to make elements, `api(path, opts)` to talk to the Worker,
`S` for everything it knows, and `render()` / `renderMain()` to draw. Colours
come from the tokens on `:root`, defined for light and for dark; nothing sets
a colour directly. It works at phone width.

**Plain words, in English**, in the code, the page and the documents: say
what a thing does, from the reader's side. A comment says why.

**Every file opens with its licence line** - `// Neuratek Factory. Copyright
(c) 2026 Diego Cibils. MIT; see LICENSE.` in the comment style of its
language.

## Security, which is not optional

- **Sign-in is Cloudflare Access**, and the Worker checks the Access token
  itself (`access_email`) - against the team's certificates, the audience,
  the issuer and the domain. A request is never trusted because Access let it
  through.
- **Keys are for agents and scripts.** Only a key's SHA-256 is stored; the
  key is shown once. A key acts for its person and reaches what they reach,
  narrowed to the projects it was made for. Connect Claude Code makes one
  from a one-time setup code, so no key passes through a page or a chat.
- **What someone may do is decided by `role()`, `reaches()` and `writes()`**
  in the Worker - admin, member, viewer, per project - and a project
  someone does not reach answers 404, as though it did not exist.
- **A change from the browser carries `X-Factory: 1`**, which no other site
  can send without asking first.
- **Never commit `wrangler.toml`, a key, `.dev.vars`, a Cloudflare account
  id or the deployed address.** The repository is public; `.gitignore` keeps
  the first three out, and the example file names none of them.
- Every text field has a limit (`LIMITS`), and the Worker refuses what it
  does not expect rather than storing it.

## Deploying

Deploys are done by Factory's maintainer, never by an agent unasked:

```bash
CLOUDFLARE_ACCOUNT_ID=... wrangler d1 execute neuratek-factory --remote --file migrations/<new>.sql
CLOUDFLARE_ACCOUNT_ID=... wrangler deploy
CLOUDFLARE_ACCOUNT_ID=... wrangler d1 execute neuratek-factory --remote --file demo.sql   # to remake the demo
```

## Working on Factory from Factory

Factory is planned on Factory. If this repository has been connected to a
project there with **Connect Claude Code**, a *Neuratek Factory* section
below says which project and how to report: take work from its queue, say
what you are doing at every step, and ask a person rather than guess.
