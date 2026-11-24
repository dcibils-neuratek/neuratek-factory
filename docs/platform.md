<!-- Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE. -->
# Neuratek Factory - the platform

**What it is for.** Diego, 24 November 2026: "this is how we are going to
build software from now on", and "this will be converted into a full
Software Development Lifecycle platform for the age of Coding Agents". More
than twenty people at Neuratek, many projects, and coding agents from more
than one maker doing a large share of the work: "it needs to be able to
connect to different Ai enginges like Claude, Gemini, OpenAi and any other
LLM coding agents for executing the tasks", "it needs to integrate and see
the git repo somewhere for every project", "the board might need some
restyling and better use of the spaces", and "we need a how to use Factory
in a way that new users have a good onboarding".

**The idea in one line**: people decide what to build and in what order;
agents build it; Factory is where the two meet - the plan, the queue, who
is doing what now, the questions that need a person, and the code each
piece of work became.

This document is for Diego to agree before more is built. Its three
choices - where agents run, which git host, which look - are his, 24
November.

---

## 1. The lifecycle Factory follows

```
 Idea ──► Discussion ──► Card (Agreed) ──► Queue (Next) ──► Building ──► Review ──► Done
   people       people + agents      people          an agent takes it   PR + CI    merged
```

Every stage exists today except **Review**, which arrives with the
repository (section 4): a card whose pull request is open sits in Review
until it is merged, and Done means merged, not "somebody said so".

---

## 2. Feature set

What a person can do, grouped. *Built* is in the code and its tests on 24
November 2026; the rest is to build.

**Projects and people** - built
- Sign in with the Neuratek Google account (Cloudflare Access); no passwords.
- Belong to any number of projects, as a member (edits) or a viewer (reads).
- Admins make projects, add people, and reach every project.
- Someone who leaves is removed once: their sign-in and every key of theirs stop.

**The plan** - built
- A board per project: Ideas, Agreed, Next, Building, Done, Parked - plus
  Review (to build).
- Cards with an area, a reference, detail, the words they were asked in,
  owners, notes, files and history.
- Discussions: an idea talked through - options with what each gains and
  costs, the questions still open - until it becomes cards.
- Decisions: a question asked of a named person, answered in their words.
- @mentions in any note or message.

**My work** - built
- Across every project: my cards, questions asked of me, where I was
  mentioned, what my agents are waiting on me for.

**Agents** - partly built
- **Connect Claude Code** from a project, in one paste: a one-time setup
  code traded by Claude Code for its own key, kept on the developer's
  machine, and a Factory section added to the repository's `CLAUDE.md`
  (Diego, 24 November). *Built.*
- **The demo project**: a banking app's account opening, half built, that
  every signed-in person sees as a viewer, to learn Factory from (Diego,
  24 November). *Built.*
- Each person's agents have their own keys, so the board says whose agent
  did what. *Built.*
- Several agents in one project, each with its own line in the now-strip. *Built.*
- **Live** - one view of every agent at work across every project, drawn
  as a live flow (Diego, 24 November, after a "token flow" Sankey): who the
  work is for, the agents and their engines, the features they are on with
  each one's step, and where each stands - working, waiting on a person,
  done today. Ribbons weighted by time now, and by tokens and cost once
  agents report them. Drawn first, as `docs/live.html`. *To build.*
- **Any engine** - Claude, Gemini, OpenAI's Codex, Cursor, Aider, or a
  local model: a key records its engine and model, and the board shows them.
- **Factory's MCP server**: one connection that gives any MCP-capable agent
  Factory's tools - take the next task, say what it is doing, ask a person,
  attach a screenshot, link its branch and pull request, mark it for review.
- **Task briefs**: a card taken by an agent carries what it needs - the
  detail, the decisions on it, the repository and branch to work on, the
  definition of done - as one document the agent reads first.
- **Runners** (phase 3): Factory starts an agent on a task by itself, in a
  container, with the engine chosen per project or per card.

**The repository** - to build
- A project is linked to one or more GitHub repositories (Diego:
  GitHub first, through a GitHub App; GitLab later behind the same door).
- On the project: branches, open pull requests, CI, recent commits.
- On a card: its branch, its pull request, CI's verdict, the diff's size -
  linked when an agent says so, or found from `factory/<card>` branch names
  and `Factory: <card>` in commit messages.
- Pushes, pull requests and merges appear in the project's activity; a
  merged pull request moves its card to Done.

**How to use Factory** - built
- A first-run tour on the page: what a project, a card, the queue and an
  agent are, on the person's own first project.
- A Guide view, always one click away: for a person (plan, decide, review)
  and for connecting an agent (one command per engine).
- An empty project explains itself rather than showing six empty columns.

**The look** - built (Diego: a dense work tool, light and dark)
- A left sidebar for projects and views instead of a header that wraps.
- Compact cards and columns that use the width; the card opened in a right
  pane, not over the board.
- Both themes, chosen by the system or by the person.

**Working together at twenty people and three engines** - to build (Diego,
24 November: yes to these four before agents of every maker)
- **Notifications**: what waits for someone reaches them - an agent's
  question, a review, a mention - by email or Google Chat, at once or as a
  daily digest, each person choosing. Without it an agent waits for hours
  for someone who has not opened the page. Diego, 24 November: "factory should email the user
  as well if factory needs some input from the user beyond the
  notification" - so whatever waits for a person (a decision asked of them,
  an agent's question, a mention) is also sent to their email.
- **Project context**: each project keeps its conventions, architecture,
  commands and rules - what `CLAUDE.md` is to Kosmos - and every agent is
  handed it with every task, whatever its engine, so a Gemini and a Claude
  work the same way in the same repository. Edited on the page, versioned.
- **Cost and usage**: tokens and money per agent, per card, per project and
  per engine, reported by the agents; a monthly budget per project, and a
  warning before it is reached.
- **Review rules**: per project, who approves, which CI checks are
  required, and that nothing merges without a person; optionally one
  engine reviewing another's pull request; and actions marked risky - a
  migration, a deploy - waiting for a person's approval. Enforced on GitHub
  through branch protection once the repository is linked.

**Later**
- **Acceptance criteria** on every card: a checklist the agent ticks and the
  reviewer checks - the heart of a task brief.
- **Dependencies and epics**: "blocked by" between cards, which an agent
  never takes while blocked, and cards grouped under a larger goal.
- **Intake**: a failing CI run on main, an error in production, a reported
  bug - each becomes a card by itself.
- **Releases**: what reached staging and production, with a changelog
  written from its cards; Done is merged, shipped is a release.
- **Metrics**: lead time from idea to production, where cards wait, and per
  engine how often its pull requests merge first time and its CI fails -
  which engine is best at what, measured.
- **Operations**: the database backed up daily, a project exported whole,
  and the change history as an audit log for admins.

**Left out, on purpose**: estimates, sprints and story points. When agents
build, what is scarce is decisions and review, not hours, and the queue and
the metrics already measure that.

---

## 3. How agents connect

**They connect first, and are launched later** (Diego, 24 November). Agents run where
people already run them - Claude Code, Gemini CLI, Codex CLI, Cursor - on
their machines or in CI, and Factory coordinates. That is buildable now,
costs nothing to run, and works with every engine on the day it ships,
because the connection is the protocol, not the engine.

```
  Claude Code ─┐
  Gemini CLI  ─┼── MCP (stdio or HTTP) ──► Factory MCP server ──► Factory API ──► D1
  Codex CLI   ─┤                              (a key per agent)
  any script  ─┘── HTTPS + key ─────────────────────────────────►
```

- **The MCP server** is a thin translation of the API, published as a
  package (`npx neuratek-factory-mcp`), and also served by the Worker itself
  over HTTP for agents that take a remote MCP server. Its tools: `next_task`,
  `brief`, `now`, `ask`, `note`, `attach`, `link_pr`, `ready_for_review`.
- **A key per agent** - "Claude (Ana)", "Gemini (Ben)" - made by its person
  from the page, recording the engine and model. Nothing an agent does is
  anonymous, and removing a person stops their agents.
- **Phase 3, runners**: a runner is a small service Factory hands a task to
  - a container with the repository checked out and an engine's CLI inside.
  The task, the brief and the key are the same as above; only who starts
  the agent changes. Cloudflare Containers, GitHub Actions or a machine of
  Neuratek's are all places a runner can live.

---

## 4. How the repository is seen

- **A GitHub App**, installed once on Neuratek's organisation, gives the
  Worker read access to the repositories chosen, and sends webhooks: push,
  pull request, check run.
- **What the Worker keeps**: only links and events - which repository a
  project has, which branch and pull request a card has, the last CI verdict
  - in D1. Code is read from GitHub when shown, never copied in.
- **What it never does**: push, merge, or approve. Agents and people do
  that through git, as now.

---

## 5. Architecture

| Piece | What supplies it | New? |
|---|---|---|
| Page | `public/index.html`, one file, no build step | restyled |
| API | Cloudflare Worker, `src/worker.js` | grows |
| Data | one D1 database, every project in it | grows |
| Sign-in | Cloudflare Access + Google; the Worker checks the token itself | built |
| Agents' door | Factory MCP server, over the API | **new** |
| Repository | GitHub App: REST for reading, webhooks into the Worker | **new** |
| Runners | containers with an engine's CLI | **new**, phase 3 |
| Files | in D1, in 512 KB pieces, 15 MB each | built |

**What travels how**: everything an agent or the page does is one HTTPS
request; GitHub talks to Factory through webhooks, and Factory to GitHub
through its REST API with the App's token. Nothing polls GitHub.

**The busiest path** is the page's: a project's board is seven requests
when opened and a look at what changed every fifteen seconds. With twenty
people that is under two requests a second - D1's free tier is a hundred
thousand writes and five million reads a day.

---

## 6. Phases

1. **People** - built 24 November: sign-in, members and viewers, owners,
   questions asked of someone, mentions, My work, an agent per person.
2. **The look and the guide** - built 24 November: the restyle as drawn in
   `docs/factory.html` (sidebar, agents strip, card pane, light and dark),
   My work, Members and People in the page, the first-run tour and How to
   use Factory.
3. **Working together** - notifications, project context, cost and usage,
   review rules.
4. **Agents of every maker** - engines on keys, keys made from the page,
   the MCP server, task briefs with acceptance criteria.
5. **The repository** - the GitHub App, Review, cards linked to pull
   requests, CI on the board, merged means Done, review rules enforced.
6. **Runners** - Factory starts the agent.
7. **Later** - dependencies and epics, intake, releases, metrics,
   operations.

## 7. Decided, and still open

- One Factory, many projects; people in many projects; Google sign-in;
  admin, member, viewer; owners, asked-of, mentions, My work; one agent key
  per person - Diego, 24 November.
- Agents connect first through MCP and the API, runners later; GitHub
  first; a dense work tool in light and dark - Diego, 24 November.
- Notifications, project context, cost and usage and review rules come
  before agents of every maker; estimates and sprints are left out - Diego,
  24 November.
- The drawing, `docs/factory.html`, agreed - Diego, 24 November.
- Still open: the engines' order after Claude, where runners live, and
  email or Google Chat for notifications.
