// Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
//
// Neuratek Factory: every project's plan as cards on a board, with Claude's
// queue, what Claude is doing now, discussions, decisions and files, behind
// one API that the page, a phone and Claude all use (`README.md`). A
// Cloudflare Worker over one D1 database; the page is a static file the
// same Worker serves. Forked on 24 November 2026 from the Kosmos Board
// (`dcibils-neuratek/kosmos`, `tools/board`), which knew one project.
//
// **Nothing is readable without knowing who asks.** A person signs in with
// their Google account through Cloudflare Access, whose token the Worker
// checks itself (`access_email`); an agent or a script sends a key - `kb_`
// and 40 hex characters, `Authorization: Bearer kb_...` - which belongs to a
// person and acts for them. Only a key's SHA-256 is kept.
//
// **People belong to projects**, as a member (who edits) or a viewer (who
// reads); an admin reaches every project, makes projects and adds people.
// A project someone does not reach answers 404, as one that is not there.
//
// **A project's routes are under `/api/p/<project>/`**, each as the Kosmos
// Board had it; `/api/me`, `/api/mine`, `/api/people`, `/api/projects`,
// `/api/files/<id>`, and `now`, `waiting` and `changes` across every project
// the asker reaches, are not.

const COLUMNS = ["ideas", "agreed", "next", "building", "done", "parked"];
const LIMITS = { model: 60, email: 200, title: 200, detail: 4000, quote: 400, area: 40, ref: 60, note: 4000, question: 600, words: 2000, step: 300, waiting: 200, task: 200, idea: 2000, purpose: 1000, summary: 4000, caption: 300, filename: 200, name: 80 };

// What a file may be, and how large: pictures, PDFs, short films, text.
const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm)|text\/(plain|markdown))$/;
const FILE_MOST = 15 * 1024 * 1024;
const PIECE = 512 * 1024;
const STAGES = ["open", "shaping", "ready", "became", "parked"];
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const ROLES = ["member", "viewer"];
const STATES = ["working", "waiting", "idle"];

const now = () => new Date().toISOString();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function refused(status, why) {
  return json({ error: why }, status);
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(text) {
  let t = text.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

// Access's signing keys, fetched from the team and held an hour; an unknown
// key id fetches them again, at most once a minute.
let CERTS = { at: 0, tried: 0, keys: new Map() };

//
// **Who signed in through Cloudflare Access**: the token Access hands the
// origin (the `Cf-Access-Jwt-Assertion` header, or its cookie), checked
// here rather than trusted - RS256 against the team's certificates, this
// application's audience, the team as issuer, not expired, and, when
// `ACCESS_DOMAIN` is set, an address in that domain. Their address, or null.
//
async function access_email(request, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return null;

  let jwt = request.headers.get("cf-access-jwt-assertion");

  if (!jwt) {
    const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    jwt = m && m[1];
  }

  const parts = (jwt || "").split(".");

  if (parts.length !== 3) return null;

  let head, body;

  try {
    head = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    body = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch {
    return null;
  }

  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];

  if (head.alg !== "RS256" || !aud.includes(env.ACCESS_AUD) || body.iss !== env.ACCESS_TEAM
      || !(body.exp > Date.now() / 1000) || typeof body.email !== "string") return null;

  const email = body.email.toLowerCase();

  if (env.ACCESS_DOMAIN && !email.endsWith("@" + env.ACCESS_DOMAIN.toLowerCase())) return null;

  const t = Date.now();

  if ((t - CERTS.at > 3600e3 || !CERTS.keys.has(head.kid)) && t - CERTS.tried > 60e3) {
    CERTS.tried = t;
    try {
      const r = await fetch(env.ACCESS_TEAM + "/cdn-cgi/access/certs");
      const j = await r.json();
      CERTS = { at: t, tried: t, keys: new Map((j.keys || []).map((k) => [k.kid, k])) };
    } catch {}
  }

  const jwk = CERTS.keys.get(head.kid);

  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    return ok ? email : null;
  } catch {
    return null;
  }
}

// A handle for @mentions: the address before the @, made unique.
async function new_handle(env, email) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30) || "person";
  let h = base;

  for (let n = 2; await env.DB.prepare("SELECT 1 FROM people WHERE handle = ?").bind(h).first(); n++) h = base + n;
  return h;
}

async function add_person(env, email, name, admin) {
  const h = await new_handle(env, email);

  await env.DB.prepare("INSERT INTO people (email, name, handle, admin, created) VALUES (?, ?, ?, ?, ?)")
    .bind(email, name, h, admin ? 1 : 0, now()).run();
  return env.DB.prepare("SELECT * FROM people WHERE email = ?").bind(email).first();
}

//
// Who is asking: their person, their name as changes are signed, whether it
// is an agent, how it came (a key or Access), and their roles. A key acts
// for its person; someone who signs in for the first time is added,
// belonging to no project yet.
//
async function who(request, env) {
  const DB = env.DB;
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer (kb_[0-9a-f]{40})$/);
  let person, key = null;

  if (m) {
    key = await DB.prepare("SELECT id, name, person, agent, projects FROM keys WHERE hash = ? AND revoked IS NULL")
      .bind(await sha256(m[1])).first();

    if (!key) return null;

    person = await DB.prepare("SELECT * FROM people WHERE id = ? AND removed IS NULL").bind(key.person).first();

    if (!person) return null;

    await DB.prepare("UPDATE keys SET last_used = ? WHERE id = ?").bind(now(), key.id).run();
  } else {
    const email = await access_email(request, env);

    if (!email) return null;

    person = await DB.prepare("SELECT * FROM people WHERE email = ?").bind(email).first();

    if (person && person.removed) return null;
    if (!person) person = await add_person(env, email, email.split("@")[0], false);
  }

  await DB.prepare("UPDATE people SET seen = ? WHERE id = ?").bind(now(), person.id).run();

  const rows = await DB.prepare("SELECT project, role FROM members WHERE person = ?").bind(person.id).all();
  const roles = new Map(rows.results.map((r) => [r.project, r.role]));
  let narrow = null;

  // A project open to everyone - the demo - is theirs at its role, unless
  // they were made more in it.
  const open = await DB.prepare("SELECT id, everyone FROM projects WHERE everyone IS NOT NULL").all();

  for (const p of open.results) if (!roles.has(p.id) && ROLES.includes(p.everyone)) roles.set(p.id, p.everyone);

  if (key && key.projects) {
    try { narrow = JSON.parse(key.projects); } catch { narrow = []; }
    if (!Array.isArray(narrow)) narrow = [];
  }

  return { name: key ? key.name : person.name, agent: !!(key && key.agent), by_key: !!key, person,
           admin: !!person.admin && !narrow, roles, narrow };
}

// What someone is in a project: "admin", "member", "viewer", or null.
function role(me, project) {
  if (me.narrow && !me.narrow.includes(project)) return null;
  if (me.person.admin) return "admin";
  return me.roles.get(project) || null;
}

function reaches(me, project) {
  return !!role(me, project);
}

function writes(me, project) {
  const r = role(me, project);
  return r === "admin" || r === "member";
}

// A text field as it may be kept: a string, trimmed, no longer than its limit.
function text(v, field, required) {
  if (v === undefined || v === null) {
    if (required) throw new Error(`${field} is needed`);
    return undefined;
  }

  if (typeof v !== "string") throw new Error(`${field} must be words`);

  const t = v.trim();

  if (required && !t) throw new Error(`${field} is empty`);
  if (t.length > LIMITS[field]) throw new Error(`${field} is longer than ${LIMITS[field]} characters`);

  return t;
}

function column(v) {
  if (!COLUMNS.includes(v)) throw new Error(`a column is one of ${COLUMNS.join(", ")}`);
  return v;
}

function slug(title) {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "card";
  return `${s}-${Date.now().toString(36)}`;
}

// `cx` is one request's context: the database, who asks, and the project.
async function log(cx, kind, card, data) {
  await cx.env.DB.prepare("INSERT INTO changes (project, at, author, kind, card, data) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(cx.project || null, now(), cx.author, kind, card, JSON.stringify(data || {})).run();
}

async function card(cx, id) {
  return cx.env.DB.prepare("SELECT * FROM cards WHERE id = ? AND project = ? AND removed IS NULL")
    .bind(id, cx.project).first();
}

async function discussion_row(cx, id) {
  return cx.env.DB.prepare("SELECT * FROM discussions WHERE id = ? AND project = ?").bind(id, cx.project).first();
}

// The rank that puts a card last in a column, or just before `before`.
async function rank_for(cx, col, before, moving) {
  const DB = cx.env.DB;

  if (before) {
    const b = await DB.prepare("SELECT rank FROM cards WHERE id = ? AND project = ? AND col = ? AND removed IS NULL")
      .bind(before, cx.project, col).first();

    if (!b) throw new Error(`no card ${before} in ${col}`);

    const prev = await DB.prepare(
      "SELECT rank FROM cards WHERE project = ? AND col = ? AND rank < ? AND id != ? AND removed IS NULL ORDER BY rank DESC LIMIT 1")
      .bind(cx.project, col, b.rank, moving || "").first();

    return prev ? (prev.rank + b.rank) / 2 : b.rank - 1;
  }

  const last = await DB.prepare("SELECT MAX(rank) AS r FROM cards WHERE project = ? AND col = ? AND removed IS NULL")
    .bind(cx.project, col).first();

  return (last && last.r !== null ? last.r : 0) + 1;
}

//
// **Who owes a reply**, from the last word in each thread: a person's waits
// for Claude; an agent's waits for the person it works for only when it
// asked something - a note saying what was built waits for nobody. Each
// thread's `{ state, of }`, in the projects in `projects`.
//
async function talk_states(env, kind, projects) {
  const marks = projects.map(() => "?").join(", ");
  const sql = kind === "notes"
    ? `SELECT t.card AS k, t.agent, t.asks, t.asks_of FROM notes t
       JOIN (SELECT card, MAX(id) AS id FROM notes GROUP BY card) last ON last.id = t.id
       JOIN cards c ON c.id = t.card WHERE c.project IN (${marks})`
    : `SELECT t.discussion AS k, t.agent, t.asks, t.asks_of FROM messages t
       JOIN (SELECT discussion, MAX(id) AS id FROM messages GROUP BY discussion) last ON last.id = t.id
       JOIN discussions d ON d.id = t.discussion WHERE d.project IN (${marks})`;
  const rows = projects.length ? await env.DB.prepare(sql).bind(...projects).all() : { results: [] };
  const out = new Map();

  for (const r of rows.results) {
    if (!r.agent) out.set(r.k, { state: "claude", of: null });
    else if (r.asks) out.set(r.k, { state: "person", of: r.asks_of });
  }

  return out;
}

// @handles in some words, as the people in this project they name.
async function mentioned(cx, words) {
  const handles = [...new Set([...words.matchAll(/(?:^|[^\w@])@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase().replace(/[.]+$/, "")))];

  if (!handles.length) return [];

  const rows = await cx.env.DB.prepare(
    `SELECT id, admin FROM people WHERE removed IS NULL AND handle IN (${handles.map(() => "?").join(", ")})`)
    .bind(...handles).all();
  const out = [];

  for (const p of rows.results) {
    if (p.id === cx.me.person.id) continue;
    const m = await cx.env.DB.prepare("SELECT 1 FROM members WHERE project = ? AND person = ?").bind(cx.project, p.id).first();
    if (m || p.admin) out.push(p.id);
  }

  return out;
}

// Said in a thread: its mentions recorded, and the speaker's own in it done.
async function thread_said(cx, where, words) {
  const at = now();
  const DB = cx.env.DB;
  const col = where.card ? "card" : "discussion";
  const val = where.card || where.discussion;

  await DB.prepare(`UPDATE mentions SET done = ? WHERE person = ? AND ${col} = ? AND done IS NULL`)
    .bind(at, cx.me.person.id, val).run();

  for (const person of await mentioned(cx, words)) {
    await DB.prepare("INSERT INTO mentions (person, project, card, discussion, text, author, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(person, cx.project, where.card || null, where.discussion || null, words.slice(0, 400), cx.author, at).run();
  }
}

function shape(c, owners) {
  return { ...c, in_roadmap: !!c.in_roadmap, owners: owners || [] };
}

async function owners_of(env, ids) {
  const out = new Map(ids.map((id) => [id, []]));

  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    const rows = await env.DB.prepare(`SELECT card, person FROM owners WHERE card IN (${part.map(() => "?").join(", ")}) ORDER BY person`)
      .bind(...part).all();
    for (const r of rows.results) out.get(r.card).push(r.person);
  }

  return out;
}

async function shaped(cx, id) {
  const c = await card(cx, id);
  return c ? shape(c, (await owners_of(cx.env, [id])).get(id)) : null;
}

// A card's owners, each someone who reaches its project.
async function set_owners(cx, id, list) {
  if (!Array.isArray(list)) throw new Error("owners are a list of people");

  const people = [...new Set(list.map(Number))].slice(0, 12);

  for (const p of people) {
    if (!(await person_in(cx.env, p, cx.project))) throw new Error(`person ${p} is not in this project`);
  }

  await cx.env.DB.prepare("DELETE FROM owners WHERE card = ?").bind(id).run();
  for (const p of people) await cx.env.DB.prepare("INSERT INTO owners (card, person) VALUES (?, ?)").bind(id, p).run();
}

// Whether a person belongs to a project, or is an admin and so reaches it.
async function person_in(env, person, project) {
  const p = await env.DB.prepare("SELECT admin FROM people WHERE id = ? AND removed IS NULL").bind(person).first();

  if (!p) return false;
  if (p.admin) return true;
  return !!(await env.DB.prepare("SELECT 1 FROM members WHERE project = ? AND person = ?").bind(project, person).first());
}

// ---- Projects -------------------------------------------------------------

async function project_row(env, id) {
  return env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
}

// The projects someone reaches, archived ones only when asked for.
async function reachable(env, me, archived) {
  const rows = await env.DB.prepare(
    `SELECT * FROM projects ${archived ? "" : "WHERE archived IS NULL"} ORDER BY rank, created`).all();
  return rows.results.filter((p) => reaches(me, p.id));
}

async function list_projects(env, key, url) {
  const list = await reachable(env, key, url.searchParams.get("archived") === "true");
  const out = [];

  for (const p of list) {
    const counts = await env.DB.prepare(
      "SELECT col, COUNT(*) AS n FROM cards WHERE project = ? AND removed IS NULL GROUP BY col").bind(p.id).all();
    const queued = await env.DB.prepare("SELECT COUNT(*) AS n FROM queue WHERE project = ?").bind(p.id).first();
    const doing = await now_of(env, p.id);
    const members = await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE project = ?").bind(p.id).first();

    out.push({ ...p, role: role(key, p.id), members: members.n, cards: Object.fromEntries(counts.results.map((r) => [r.col, r.n])),
               queued: queued ? queued.n : 0, now: doing,
               working: doing.filter((n) => n.state !== "idle").length });
  }

  return json({ projects: out });
}

async function new_project(env, key, body) {
  if (!key.admin) return refused(403, "only an admin makes a project");

  const name = text(body.name, "name", true);
  const id = body.id === undefined ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
                                   : body.id;

  if (typeof id !== "string" || !PROJECT_ID.test(id)) {
    throw new Error("a project's id is lower-case letters, digits and dashes, at most 40");
  }
  if (await project_row(env, id)) return refused(400, `there is a project ${id} already`);

  const last = await env.DB.prepare("SELECT MAX(rank) AS r FROM projects").first();
  const t = now();

  await env.DB.prepare("INSERT INTO projects (id, name, detail, rank, created, author) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, text(body.detail, "detail") || "", (last && last.r !== null ? last.r : 0) + 1, t, key.name).run();
  await log({ env, author: key.name, project: id }, "project.new", null, { name });
  return json({ project: await project_row(env, id) }, 201);
}

async function edit_project(env, key, id, body) {
  const p = await project_row(env, id);

  if (!p || !reaches(key, id)) return refused(404, `no project ${id}`);
  if (!key.admin) return refused(403, "only an admin changes a project");

  const fields = {};

  if (body.name !== undefined) fields.name = text(body.name, "name", true);
  if (body.detail !== undefined) fields.detail = text(body.detail, "detail");
  if (body.archived !== undefined) fields.archived = body.archived ? (p.archived || now()) : null;
  if (body.everyone !== undefined) {
    if (body.everyone !== null && !ROLES.includes(body.everyone)) throw new Error("everyone is member, viewer or null");
    fields.everyone = body.everyone;
  }

  const names = Object.keys(fields);

  if (!names.length) return refused(400, "nothing to change");

  await env.DB.prepare(`UPDATE projects SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), id).run();
  await log({ env, author: key.name, project: id }, "project.edit", null, fields);
  return json({ project: await project_row(env, id) });
}

// ---- People and who belongs where --------------------------------------------

function person_shape(p) {
  return { id: p.id, email: p.email, name: p.name, handle: p.handle, admin: !!p.admin, seen: p.seen, removed: p.removed };
}

// An admin sees everyone, each with their projects; anyone else, the people
// they share a project with - whom a card can be for, and @mentions reach.
async function list_people(env, me) {
  const rows = await env.DB.prepare("SELECT * FROM people ORDER BY name").all();
  const all = await env.DB.prepare("SELECT project, person, role FROM members").all();
  const of = new Map();

  for (const m of all.results) {
    if (!of.has(m.person)) of.set(m.person, []);
    of.get(m.person).push({ project: m.project, role: m.role });
  }

  const mine = new Set((await reachable(env, me, true)).map((p) => p.id));
  const list = rows.results.filter((p) => me.admin || p.id === me.person.id || p.admin && !p.removed
    || (of.get(p.id) || []).some((m) => mine.has(m.project)) && !p.removed);

  return json({ people: list.map((p) => ({ ...person_shape(p),
    projects: me.admin || p.id === me.person.id ? (of.get(p.id) || []) : (of.get(p.id) || []).filter((m) => mine.has(m.project)) })) });
}

async function new_person_route(env, me, body) {
  if (!me.admin) return refused(403, "only an admin adds people");

  const email = text(body.email, "email", true).toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("that is not an address");
  if (await env.DB.prepare("SELECT 1 FROM people WHERE email = ?").bind(email).first()) return refused(400, `${email} is here already`);

  const p = await add_person(env, email, text(body.name, "name") || email.split("@")[0], !!body.admin);

  await log({ env, author: me.name, project: null }, "person.new", null, { person: p.id, email });
  return json({ person: person_shape(p) }, 201);
}

async function edit_person(env, me, id, body) {
  if (!me.admin) return refused(403, "only an admin changes someone");

  const p = await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(id).first();

  if (!p) return refused(404, `no person ${id}`);

  const fields = {};

  if (body.name !== undefined) fields.name = text(body.name, "name", true);
  if (body.admin !== undefined) fields.admin = body.admin ? 1 : 0;
  if (body.removed !== undefined) fields.removed = body.removed ? (p.removed || now()) : null;
  if (p.id === me.person.id && (fields.admin === 0 || fields.removed)) return refused(400, "an admin cannot take themselves out");

  const names = Object.keys(fields);

  if (!names.length) return refused(400, "nothing to change");

  await env.DB.prepare(`UPDATE people SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), id).run();
  await log({ env, author: me.name, project: null }, "person.edit", null, { person: id, ...fields });
  return json({ person: person_shape(await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(id).first()) });
}

async function list_members(cx) {
  const rows = await cx.env.DB.prepare(
    `SELECT p.*, m.role FROM members m JOIN people p ON p.id = m.person WHERE m.project = ? AND p.removed IS NULL ORDER BY p.name`)
    .bind(cx.project).all();
  return json({ members: rows.results.map((p) => ({ ...person_shape(p), role: p.role })) });
}

async function set_member(cx, person, body) {
  if (!cx.me.admin) return refused(403, "only an admin adds people to a project");
  if (!ROLES.includes(body.role)) throw new Error(`a role is one of ${ROLES.join(", ")}`);

  const p = await cx.env.DB.prepare("SELECT * FROM people WHERE id = ? AND removed IS NULL").bind(person).first();

  if (!p) return refused(404, `no person ${person}`);

  await cx.env.DB.prepare(`INSERT INTO members (project, person, role, added, added_by) VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT (project, person) DO UPDATE SET role = excluded.role`)
    .bind(cx.project, person, body.role, now(), cx.author).run();
  await log(cx, "member", null, { person, name: p.name, role: body.role });
  return list_members(cx);
}

async function remove_member(cx, person) {
  if (!cx.me.admin) return refused(403, "only an admin takes people out of a project");

  await cx.env.DB.prepare("DELETE FROM members WHERE project = ? AND person = ?").bind(cx.project, person).run();
  await log(cx, "member.remove", null, { person });
  return list_members(cx);
}

// Someone's own work, in every project they reach: the cards that are
// theirs and not finished, and everything that waits for them.
async function mine(env, me) {
  const ids = (await reachable(env, me, false)).map((p) => p.id);
  const marks = ids.map(() => "?").join(", ");
  const cards = ids.length ? await env.DB.prepare(
    `SELECT c.id, c.project, c.title, c.col, c.area, c.ref, c.updated FROM owners o JOIN cards c ON c.id = o.card
     WHERE o.person = ? AND c.removed IS NULL AND c.col NOT IN ('done', 'parked') AND c.project IN (${marks})
     ORDER BY c.updated DESC`).bind(me.person.id, ...ids).all() : { results: [] };
  const waiting = await (await waiting_in(env, me, ids)).json();

  return json({ owned: cards.results, ...waiting.person });
}

async function mention_done(env, me, id) {
  const r = await env.DB.prepare("UPDATE mentions SET done = ? WHERE id = ? AND person = ? AND done IS NULL")
    .bind(now(), id, me.person.id).run();

  return r.meta.changes ? json({ done: id }) : refused(404, `no mention ${id} waiting for you`);
}

// ---- A project's routes ------------------------------------------------------

async function list_cards(cx, url) {
  const where = ["cards.project = ?", "cards.removed IS NULL"];
  const args = [cx.project];
  const col = url.searchParams.get("column");
  const area = url.searchParams.get("area");
  const q = url.searchParams.get("q");

  if (col) { where.push("cards.col = ?"); args.push(column(col)); }
  if (area) { where.push("cards.area = ?"); args.push(area); }
  if (q) {
    where.push("(cards.title LIKE ? OR cards.detail LIKE ? OR cards.ref LIKE ? OR cards.quote LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }

  // Next in the queue's order, each with its place in it; the rest by rank.
  const rows = await cx.env.DB.prepare(
    `SELECT cards.*, q.rank AS queue_rank FROM cards LEFT JOIN queue q ON q.card = cards.id
     WHERE ${where.join(" AND ")}
     ORDER BY cards.col, CASE WHEN cards.col = 'next' THEN q.rank END, cards.rank`)
    .bind(...args).all();
  const talk = await talk_states(cx.env, "notes", [cx.project]);
  const owners = await owners_of(cx.env, rows.results.map((c) => c.id));

  const queue = await cx.env.DB.prepare("SELECT card FROM queue WHERE project = ? ORDER BY rank").bind(cx.project).all();
  const place = new Map(queue.results.map((e, i) => [e.card, i + 1]));
  const counted = await cx.env.DB.prepare(
    "SELECT card, COUNT(*) AS n FROM files WHERE project = ? AND card IS NOT NULL AND removed IS NULL GROUP BY card")
    .bind(cx.project).all();
  const files = new Map(counted.results.map((r) => [r.card, r.n]));

  return json({ cards: rows.results.map(({ queue_rank, ...c }) => {
    const t = talk.get(c.id);
    return { ...shape(c, owners.get(c.id)), talk: t ? t.state : null, talk_of: t ? t.of : null,
             queued: place.get(c.id) || null, files: files.get(c.id) || 0 };
  }) });
}

async function new_card(cx, body) {
  const title = text(body.title, "title", true);
  const col = column(body.column || "ideas");
  const id = slug(title);
  const t = now();

  await cx.env.DB.prepare(`INSERT INTO cards (id, project, title, col, rank, area, ref, detail, quote, asked, in_roadmap,
                           created, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .bind(id, cx.project, title, col, await rank_for(cx, col, body.before), text(body.area, "area") || "",
          text(body.ref, "ref") || "", text(body.detail, "detail") || "", text(body.quote, "quote") || "",
          t.slice(0, 10), t, t, cx.author).run();

  // Made straight into Next, it is queued, last: Next is the queue.
  if (col === "next") {
    await cx.env.DB.prepare("INSERT INTO queue (project, card, title, rank, added, added_by) VALUES (?, ?, '', ?, ?, ?)")
      .bind(cx.project, id, await queue_rank(cx), t, cx.author).run();
  }

  if (body.owners !== undefined) await set_owners(cx, id, body.owners);

  await log(cx, "card.new", id, { title, column: col });
  return json({ card: await shaped(cx, id) }, 201);
}

async function get_card(cx, id) {
  const c = await card(cx, id);

  if (!c) return refused(404, `no card ${id}`);

  const DB = cx.env.DB;
  const notes = await DB.prepare("SELECT id, text, author, at, asks, agent, asks_of FROM notes WHERE card = ? ORDER BY id").bind(id).all();
  const history = await DB.prepare("SELECT at, author, kind, data FROM changes WHERE card = ? ORDER BY at").bind(id).all();
  const decisions = await DB.prepare("SELECT * FROM decisions WHERE card = ? ORDER BY asked").bind(id).all();

  return json({
    card: await shaped(cx, id), notes: notes.results.map((n) => ({ ...n, asks: !!n.asks, agent: !!n.agent })), files: await files_of(cx, "card", id),
    history: history.results.map((h) => ({ ...h, data: JSON.parse(h.data) })),
    decisions: decisions.results.map((d) => ({ ...d, options: JSON.parse(d.options) })),
  });
}

async function edit_card(cx, id, body) {
  const c = await card(cx, id);

  if (!c) return refused(404, `no card ${id}`);

  const fields = {};

  for (const f of ["title", "area", "ref", "detail", "quote"]) {
    const v = text(body[f], f, f === "title" && body.title !== undefined);
    if (v !== undefined) fields[f] = v;
  }

  if (body.in_roadmap !== undefined) fields.in_roadmap = body.in_roadmap ? 1 : 0;

  const names = Object.keys(fields);

  if (!names.length && body.owners === undefined) return refused(400, "nothing to change");
  if (body.owners !== undefined) await set_owners(cx, id, body.owners);

  await cx.env.DB.prepare(`UPDATE cards SET ${names.map((n) => `${n} = ?, `).join("")}updated = ?, updated_by = ? WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), now(), cx.author, id).run();

  await log(cx, "card.edit", id, body.owners !== undefined ? { ...fields, owners: body.owners } : fields);
  return json({ card: await shaped(cx, id) });
}

async function move_card(cx, id, body) {
  const c = await card(cx, id);
  const DB = cx.env.DB;

  if (!c) return refused(404, `no card ${id}`);

  const col = column(body.column || c.col);

  if (body.before === id) return refused(400, "a card cannot go before itself");

  const r = await rank_for(cx, col, body.before, id);

  await DB.prepare("UPDATE cards SET col = ?, rank = ?, updated = ?, updated_by = ? WHERE id = ?")
    .bind(col, r, now(), cx.author, id).run();

  // **Next is Claude's queue, as cards**: dropped into Next, a card is
  // queued where it was dropped - before the entry of the card it landed
  // above, or last; moved within Next, its entry moves; taken out to
  // anywhere but Building, it leaves the queue.
  const queued = await DB.prepare("SELECT id FROM queue WHERE card = ?").bind(id).first();

  if (col === "next") {
    const above = body.before
      ? await DB.prepare("SELECT id FROM queue WHERE card = ? AND project = ?").bind(body.before, cx.project).first() : null;
    const place = await queue_rank(cx, above ? above.id : null, false, queued ? queued.id : 0);

    if (queued) {
      await DB.prepare("UPDATE queue SET rank = ? WHERE id = ?").bind(place, queued.id).run();
    } else {
      await DB.prepare("INSERT INTO queue (project, card, title, rank, added, added_by) VALUES (?, ?, '', ?, ?, ?)")
        .bind(cx.project, id, place, now(), cx.author).run();
    }
  } else if (queued && col !== "building") {
    await DB.prepare("DELETE FROM queue WHERE id = ?").bind(queued.id).run();
  }

  await log(cx, "card.move", id, { from: c.col, to: col, before: body.before || null });
  return json({ card: await shaped(cx, id) });
}

async function remove_card(cx, id) {
  const c = await card(cx, id);

  if (!c) return refused(404, `no card ${id}`);

  await cx.env.DB.prepare("UPDATE cards SET removed = ?, updated = ?, updated_by = ? WHERE id = ?")
    .bind(now(), now(), cx.author, id).run();

  await cx.env.DB.prepare("DELETE FROM queue WHERE card = ?").bind(id).run();
  await log(cx, "card.remove", id, { title: c.title });
  return json({ removed: id });
}

async function add_note(cx, id, body) {
  if (!(await card(cx, id))) return refused(404, `no card ${id}`);

  const t = text(body.text, "note", true);
  const asks = body.asks && cx.me.agent ? 1 : 0;
  const at = now();

  await cx.env.DB.prepare("INSERT INTO notes (card, text, author, at, asks, agent, asks_of) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, t, cx.author, at, asks, cx.me.agent ? 1 : 0, asks ? cx.me.person.id : null).run();
  await thread_said(cx, { card: id }, t);
  await log(cx, "note", id, { text: t, asks: !!asks });
  return json({ note: { card: id, text: t, author: cx.author, at, asks: !!asks, agent: cx.me.agent } }, 201);
}

async function list_decisions(cx, url) {
  const open = url.searchParams.get("open") === "true";
  const rows = await cx.env.DB.prepare(
    `SELECT * FROM decisions WHERE project = ? ${open ? "AND answer IS NULL" : ""} ORDER BY asked DESC`)
    .bind(cx.project).all();

  return json({ decisions: rows.results.map((d) => ({ ...d, options: JSON.parse(d.options) })) });
}

async function new_decision(cx, body) {
  const question = text(body.question, "question", true);
  const options = Array.isArray(body.options) ? body.options.slice(0, 8).map((o) => text(o, "title", true)) : [];

  if (body.card && !(await card(cx, body.card))) return refused(404, `no card ${body.card}`);

  // Asked of someone in the project, or of the person whoever asks works for.
  const of = body.asks_of === undefined || body.asks_of === null ? cx.me.person.id : Number(body.asks_of);

  if (!(await person_in(cx.env, of, cx.project))) return refused(400, `person ${body.asks_of} is not in this project`);

  const r = await cx.env.DB.prepare(
    "INSERT INTO decisions (project, card, question, options, asked, asked_by, asked_of) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(cx.project, body.card || null, question, JSON.stringify(options), now(), cx.author, of).run();

  await log(cx, "decision.new", body.card || null, { question, options, asks_of: of });
  return json({ decision: { id: r.meta.last_row_id, project: cx.project, card: body.card || null, question, options,
                            asked_of: of, answer: null } }, 201);
}

async function answer_decision(cx, id, body) {
  const d = await cx.env.DB.prepare("SELECT * FROM decisions WHERE id = ? AND project = ?").bind(id, cx.project).first();

  if (!d) return refused(404, `no decision ${id}`);

  const answer = text(body.answer, "question", true);
  const words = text(body.words, "words") || "";
  const at = now();

  await cx.env.DB.prepare("UPDATE decisions SET answer = ?, words = ?, answered = ?, answered_by = ? WHERE id = ?")
    .bind(answer, words, at, cx.author, id).run();

  if (d.card) {
    await cx.env.DB.prepare("INSERT INTO notes (card, text, author, at, agent) VALUES (?, ?, ?, ?, ?)")
      .bind(d.card, `Decided: ${d.question} - ${answer}${words ? ` ("${words}")` : ""}`, cx.author, at, cx.me.agent ? 1 : 0).run();
  }

  await log(cx, "decision.answer", d.card, { question: d.question, answer, words });
  return json({ decision: { ...d, options: JSON.parse(d.options), answer, words, answered: at, answered_by: cx.author } });
}

//
// **What each Claude is doing now** in a project: its card, its step, what
// it waits on, and since when - one row a project and key, said at each
// step, newest first. `since` moves only when the card does, so the strip
// says how long a card has taken, not how long since the last word.
//
async function now_of(env, project) {
  const rows = await env.DB.prepare(
    `SELECT d.*, c.title FROM doing d LEFT JOIN cards c ON c.id = d.card AND c.project = d.project AND c.removed IS NULL
     WHERE d.project = ? ORDER BY d.updated DESC`).bind(project).all();
  return rows.results;
}

async function get_now(cx) {
  return json({ now: await now_of(cx.env, cx.project) });
}

async function set_now(cx, body) {
  const state = body.state || "working";

  if (!STATES.includes(state)) throw new Error(`a state is one of ${STATES.join(", ")}`);
  if (body.card && !(await card(cx, body.card))) return refused(404, `no card ${body.card}`);

  const step = text(body.step, "step") || "";
  const waiting = text(body.waiting, "waiting") || "";
  const model = text(body.model, "model") || null;
  const at = now();
  const before = await cx.env.DB.prepare("SELECT card, since FROM doing WHERE project = ? AND author = ?")
    .bind(cx.project, cx.author).first();
  const since = before && before.card === (body.card || null) && before.since ? before.since : at;

  // The model, once said, is kept until the agent says another.
  await cx.env.DB.prepare(`INSERT INTO doing (project, author, person, state, card, step, waiting, model, since, updated)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT (project, author) DO UPDATE SET person = excluded.person, state = excluded.state,
                           card = excluded.card, step = excluded.step, waiting = excluded.waiting,
                           model = COALESCE(excluded.model, doing.model), since = excluded.since, updated = excluded.updated`)
    .bind(cx.project, cx.author, cx.me.person.id, state, body.card || null, step, waiting, model, since, at).run();

  await log(cx, "now", body.card || null, { state, step, waiting });
  return json({ now: (await now_of(cx.env, cx.project)).find((n) => n.author === cx.author) });
}

//
// **Claude's queue** in a project: what comes after the card Claude is on,
// in order. A card in it is in Next; out of it, back in Agreed; a task is
// an entry with no card.
//
async function queue_rank(cx, before, top, moving) {
  const DB = cx.env.DB;

  if (top) {
    const first = await DB.prepare("SELECT MIN(rank) AS r FROM queue WHERE project = ? AND id != ?")
      .bind(cx.project, moving || 0).first();
    return (first && first.r !== null ? first.r : 1) - 1;
  }

  if (before) {
    const b = await DB.prepare("SELECT rank FROM queue WHERE id = ? AND project = ?").bind(before, cx.project).first();

    if (!b) throw new Error(`no queue entry ${before}`);

    const prev = await DB.prepare(
      "SELECT rank FROM queue WHERE project = ? AND rank < ? AND id != ? ORDER BY rank DESC LIMIT 1")
      .bind(cx.project, b.rank, moving || 0).first();

    return prev ? (prev.rank + b.rank) / 2 : b.rank - 1;
  }

  const last = await DB.prepare("SELECT MAX(rank) AS r FROM queue WHERE project = ? AND id != ?")
    .bind(cx.project, moving || 0).first();
  return (last && last.r !== null ? last.r : 0) + 1;
}

async function get_queue(cx) {
  const rows = await cx.env.DB.prepare(
    `SELECT q.id, q.card, q.title AS task, q.rank, q.added, q.added_by, c.title, c.area, c.col, c.ref
     FROM queue q LEFT JOIN cards c ON c.id = q.card WHERE q.project = ? ORDER BY q.rank`).bind(cx.project).all();

  return json({ queue: rows.results.map((r, i) => ({
    id: r.id, place: i + 1, kind: r.card ? "card" : "task", card: r.card,
    title: r.card ? r.title : r.task, area: r.area || "", column: r.col || null, ref: r.ref || "",
    added: r.added, added_by: r.added_by,
  })) });
}

async function queue_entry(cx, id) {
  return cx.env.DB.prepare("SELECT * FROM queue WHERE id = ? AND project = ?").bind(id, cx.project).first();
}

async function enqueue(cx, body) {
  const at = now();
  const DB = cx.env.DB;
  let title = "";

  if (body.card) {
    const c = await card(cx, body.card);

    if (!c) return refused(404, `no card ${body.card}`);
    if (c.col === "done") return refused(400, "a done card is not queued");

    const there = await DB.prepare("SELECT id FROM queue WHERE card = ?").bind(body.card).first();

    if (there) return refused(400, `${body.card} is in the queue already`);

    if (c.col !== "next" && c.col !== "building") {
      await DB.prepare("UPDATE cards SET col = 'next', rank = ?, updated = ?, updated_by = ? WHERE id = ?")
        .bind(await rank_for(cx, "next"), at, cx.author, body.card).run();
    }
  } else {
    title = text(body.title, "task", true);
  }

  const r = await DB.prepare("INSERT INTO queue (project, card, title, rank, added, added_by) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(cx.project, body.card || null, title, await queue_rank(cx, body.before, body.top), at, cx.author).run();

  await log(cx, "queue.add", body.card || null, { entry: r.meta.last_row_id, task: title || undefined });
  return get_queue(cx);
}

async function move_queued(cx, id, body) {
  const e = await queue_entry(cx, id);

  if (!e) return refused(404, `no queue entry ${id}`);
  if (body.before === id) return refused(400, "an entry cannot go before itself");

  await cx.env.DB.prepare("UPDATE queue SET rank = ? WHERE id = ?")
    .bind(await queue_rank(cx, body.before, body.top, id), id).run();

  await log(cx, "queue.move", e.card, { entry: id, before: body.before || null, top: !!body.top });
  return get_queue(cx);
}

// Out of the queue: a card that was waiting in Next goes back to Agreed.
async function dequeue(cx, id) {
  const e = await queue_entry(cx, id);

  if (!e) return refused(404, `no queue entry ${id}`);

  await cx.env.DB.prepare("DELETE FROM queue WHERE id = ?").bind(id).run();

  if (e.card) {
    const c = await card(cx, e.card);

    if (c && c.col === "next") {
      await cx.env.DB.prepare("UPDATE cards SET col = 'agreed', rank = ?, updated = ?, updated_by = ? WHERE id = ?")
        .bind(await rank_for(cx, "agreed"), now(), cx.author, e.card).run();
    }
  }

  await log(cx, "queue.remove", e.card, { entry: id, task: e.title || undefined });
  return get_queue(cx);
}

// Claude takes the top: it is what Claude is doing now, and its card is
// in Building.
async function take(cx) {
  const e = await cx.env.DB.prepare("SELECT * FROM queue WHERE project = ? ORDER BY rank LIMIT 1").bind(cx.project).first();

  if (!e) return refused(404, "the queue is empty");

  await cx.env.DB.prepare("DELETE FROM queue WHERE id = ?").bind(e.id).run();

  if (e.card) {
    await cx.env.DB.prepare("UPDATE cards SET col = 'building', rank = ?, updated = ?, updated_by = ? WHERE id = ?")
      .bind(await rank_for(cx, "building"), now(), cx.author, e.card).run();
  }

  await log(cx, "queue.take", e.card, { entry: e.id, task: e.title || undefined });
  return set_now(cx, { card: e.card || undefined, step: e.card ? "" : e.title, state: "working" });
}

function discussion_shape(d, talk) {
  return { ...d, options: JSON.parse(d.options), questions: JSON.parse(d.questions),
           talk: talk ? talk.state : null, talk_of: talk ? talk.of : null };
}

function options_of(v) {
  if (!Array.isArray(v)) throw new Error("options are a list");

  return v.slice(0, 8).map((o) => ({
    name: text(o && o.name, "title", true), plus: text(o.plus, "purpose") || "", minus: text(o.minus, "purpose") || "",
    recommended: !!o.recommended, chosen: !!o.chosen,
  }));
}

function questions_of(v) {
  if (!Array.isArray(v)) throw new Error("questions are a list");
  return v.slice(0, 12).map((q) => text(q, "question", true));
}

async function list_discussions(cx, url) {
  const stage = url.searchParams.get("stage");

  if (stage && !STAGES.includes(stage)) throw new Error(`a stage is one of ${STAGES.join(", ")}`);

  const rows = await cx.env.DB.prepare(
    `SELECT * FROM discussions WHERE project = ? ${stage ? "AND stage = ?" : ""} ORDER BY updated DESC`)
    .bind(cx.project, ...(stage ? [stage] : [])).all();
  const talk = await talk_states(cx.env, "messages", [cx.project]);

  return json({ discussions: rows.results.map((d) => discussion_shape(d, talk.get(d.id))) });
}

async function new_discussion(cx, body) {
  const t = now();
  const r = await cx.env.DB.prepare(
    "INSERT INTO discussions (project, title, idea, purpose, created, author, updated) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(cx.project, text(body.title, "title", true), text(body.idea, "idea") || "", text(body.for, "purpose") || "",
          t, cx.author, t).run();
  const id = r.meta.last_row_id;

  if (body.idea) {
    await cx.env.DB.prepare("INSERT INTO messages (discussion, text, author, at, agent) VALUES (?, ?, ?, ?, ?)")
      .bind(id, text(body.idea, "idea"), cx.author, t, cx.me.agent ? 1 : 0).run();
    await thread_said(cx, { discussion: id }, body.idea);
  }

  await log(cx, "discussion.new", null, { discussion: id, title: body.title });
  return get_discussion(cx, id, 201);
}

async function get_discussion(cx, id, status = 200) {
  const d = await discussion_row(cx, id);

  if (!d) return refused(404, `no discussion ${id}`);

  const DB = cx.env.DB;
  const msgs = await DB.prepare("SELECT id, text, author, at, asks, agent, asks_of FROM messages WHERE discussion = ? ORDER BY id").bind(id).all();
  const cards = await DB.prepare("SELECT id, title, col FROM cards WHERE discussion = ? AND project = ? AND removed IS NULL")
    .bind(id, cx.project).all();
  const talk = await talk_states(cx.env, "messages", [cx.project]);

  return json({ discussion: discussion_shape(d, talk.get(d.id)),
                messages: msgs.results.map((m) => ({ ...m, asks: !!m.asks, agent: !!m.agent })), cards: cards.results,
                files: await files_of(cx, "discussion", id) }, status);
}

async function edit_discussion(cx, id, body) {
  const d = await discussion_row(cx, id);

  if (!d) return refused(404, `no discussion ${id}`);

  const fields = {};

  if (body.title !== undefined) fields.title = text(body.title, "title", true);
  if (body.idea !== undefined) fields.idea = text(body.idea, "idea");
  if (body.for !== undefined) fields.purpose = text(body.for, "purpose");
  if (body.summary !== undefined) fields.summary = text(body.summary, "summary");
  if (body.options !== undefined) fields.options = JSON.stringify(options_of(body.options));
  if (body.questions !== undefined) fields.questions = JSON.stringify(questions_of(body.questions));
  if (body.stage !== undefined) {
    if (!STAGES.includes(body.stage)) throw new Error(`a stage is one of ${STAGES.join(", ")}`);
    fields.stage = body.stage;
  }

  const names = Object.keys(fields);

  if (!names.length) return refused(400, "nothing to change");

  await cx.env.DB.prepare(`UPDATE discussions SET ${names.map((n) => `${n} = ?`).join(", ")}, updated = ? WHERE id = ?`)
    .bind(...names.map((n) => fields[n]), now(), id).run();

  await log(cx, "discussion.edit", null, { discussion: id, fields: names });
  return get_discussion(cx, id);
}

async function add_message(cx, id, body) {
  if (!(await discussion_row(cx, id))) return refused(404, `no discussion ${id}`);

  const t = text(body.text, "note", true);
  const at = now();

  const asks = body.asks && cx.me.agent ? 1 : 0;

  await cx.env.DB.prepare("INSERT INTO messages (discussion, text, author, at, asks, agent, asks_of) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, t, cx.author, at, asks, cx.me.agent ? 1 : 0, asks ? cx.me.person.id : null).run();
  await thread_said(cx, { discussion: id }, t);
  await cx.env.DB.prepare("UPDATE discussions SET updated = ? WHERE id = ?").bind(at, id).run();
  await log(cx, "message", null, { discussion: id, text: t, asks: !!body.asks });
  return get_discussion(cx, id, 201);
}

// A card made from a discussion: linked both ways, and the discussion has
// become cards.
async function discussion_card(cx, id, body) {
  const d = await discussion_row(cx, id);

  if (!d) return refused(404, `no discussion ${id}`);

  const res = await new_card(cx, { ...body, detail: body.detail || d.summary, quote: body.quote || d.idea });
  const made = (await res.clone().json()).card;

  await cx.env.DB.prepare("UPDATE cards SET discussion = ? WHERE id = ?").bind(id, made.id).run();
  await cx.env.DB.prepare("UPDATE discussions SET stage = 'became', updated = ? WHERE id = ?").bind(now(), id).run();
  await log(cx, "discussion.card", made.id, { discussion: id });
  return get_discussion(cx, id, 201);
}

// What waits for a reply in these projects: for Claude, every thread whose
// last word is a person's; for the one asking, what their Claudes asked
// them, the questions asked of them, and where they were @mentioned. Each
// item names its project, so the overview can say where.
async function waiting_in(env, me, projects) {
  const cards = await talk_states(env, "notes", projects);
  const talks = await talk_states(env, "messages", projects);
  const out = { claude: { cards: [], discussions: [] }, person: { cards: [], discussions: [] } };
  const mine = (t) => t.state === "claude" ? "claude" : t.of === me.person.id ? "person" : null;

  for (const [id, t] of cards) {
    const whom = mine(t);
    const c = whom && await env.DB.prepare("SELECT id, project, title FROM cards WHERE id = ? AND removed IS NULL").bind(id).first();
    if (c) out[whom].cards.push(c);
  }

  for (const [id, t] of talks) {
    const whom = mine(t);
    const d = whom && await env.DB.prepare("SELECT id, project, title FROM discussions WHERE id = ?").bind(id).first();
    if (d) out[whom].discussions.push(d);
  }

  const marks = projects.map(() => "?").join(", ");
  const open = projects.length
    ? await env.DB.prepare(`SELECT id, project, card, question FROM decisions WHERE answer IS NULL AND asked_of = ? AND project IN (${marks})`)
      .bind(me.person.id, ...projects).all()
    : { results: [] };
  const named = projects.length
    ? await env.DB.prepare(`SELECT id, project, card, discussion, text, author, at FROM mentions
                            WHERE person = ? AND done IS NULL AND project IN (${marks}) ORDER BY at DESC`)
      .bind(me.person.id, ...projects).all()
    : { results: [] };

  out.person.decisions = open.results;
  out.person.mentions = named.results;
  return json(out);
}

//
// **Files**: a screenshot, a PDF, a film - for reference, or to show what
// was built. The bytes are the body (`Content-Type` says what they are,
// `?name=` and `?caption=` what they are called); kept in pieces.
//
async function add_file(cx, request, url, owner) {
  const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

  if (!FILE_TYPES.test(type)) return refused(415, `${type || "nothing"} is not a file the Factory keeps: pictures, PDFs, films and text`);

  const bytes = new Uint8Array(await request.arrayBuffer());

  if (bytes.length === 0) return refused(400, "the file is empty");
  if (bytes.length > FILE_MOST) return refused(413, `the file is ${Math.round(bytes.length / 1048576)} MB; at most 15`);

  if (owner.card && !(await card(cx, owner.card))) return refused(404, `no card ${owner.card}`);
  if (owner.discussion && !(await discussion_row(cx, owner.discussion))) return refused(404, `no discussion ${owner.discussion}`);

  const id = crypto.randomUUID();
  const name = text(url.searchParams.get("name") || "file", "filename", true);
  const caption = text(url.searchParams.get("caption") || "", "caption") || "";
  const at = now();
  const writes = [cx.env.DB.prepare(
    "INSERT INTO files (id, project, card, discussion, name, type, size, caption, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, cx.project, owner.card || null, owner.discussion || null, name, type, bytes.length, caption, cx.author, at)];

  for (let n = 0; n * PIECE < bytes.length; n++) {
    writes.push(cx.env.DB.prepare("INSERT INTO file_pieces (file, n, data) VALUES (?, ?, ?)")
      .bind(id, n, bytes.subarray(n * PIECE, (n + 1) * PIECE)));
  }

  await cx.env.DB.batch(writes);
  await log(cx, "file", owner.card || null, { file: id, name, caption, discussion: owner.discussion || undefined });
  return json({ file: { id, project: cx.project, card: owner.card || null, discussion: owner.discussion || null, name, type,
                        size: bytes.length, caption, author: cx.author, at } }, 201);
}

// A file by its id: its project must be one the key reaches, or it is not there.
async function file_row(env, me, id) {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND removed IS NULL").bind(id).first();
  return f && reaches(me, f.project) ? f : null;
}

async function get_file(env, key, id) {
  const f = await file_row(env, key, id);

  if (!f) return refused(404, `no file ${id}`);

  const pieces = await env.DB.prepare("SELECT data FROM file_pieces WHERE file = ? ORDER BY n").bind(id).all();
  const out = new Uint8Array(f.size);
  let at = 0;

  for (const p of pieces.results) {
    const b = new Uint8Array(p.data);
    out.set(b, at);
    at += b.length;
  }

  return new Response(out, { headers: {
    "content-type": f.type, "cache-control": "private, max-age=86400",
    "content-disposition": `inline; filename="${f.name.replace(/["\\]/g, "")}"`,
  } });
}

async function remove_file(env, key, id) {
  const f = await file_row(env, key, id);

  if (!f) return refused(404, `no file ${id}`);
  if (!writes(key, f.project)) return refused(403, "a viewer does not remove files");

  await env.DB.prepare("UPDATE files SET removed = ? WHERE id = ?").bind(now(), id).run();
  await env.DB.prepare("DELETE FROM file_pieces WHERE file = ?").bind(id).run();
  await log({ env, author: key.name, project: f.project }, "file.remove", f.card, { file: id, name: f.name });
  return json({ removed: id });
}

async function files_of(cx, column, value) {
  const rows = await cx.env.DB.prepare(
    `SELECT id, name, type, size, caption, author, at FROM files WHERE ${column} = ? AND project = ? AND removed IS NULL ORDER BY at`)
    .bind(value, cx.project).all();
  return rows.results;
}

// What changed since a time, in these projects.
async function changes_in(env, projects, url) {
  const since = url.searchParams.get("since") || "1970-01-01T00:00:00Z";
  const marks = projects.map(() => "?").join(", ");
  const rows = projects.length
    ? await env.DB.prepare(`SELECT * FROM changes WHERE at > ? AND project IN (${marks}) ORDER BY at LIMIT 1000`)
      .bind(since, ...projects).all()
    : { results: [] };

  return json({ changes: rows.results.map((c) => ({ ...c, data: JSON.parse(c.data) })), now: now() });
}

const NAMES = { ideas: "Ideas", agreed: "Agreed", next: "Next", building: "Building", done: "Done", parked: "Parked" };

async function export_md(cx) {
  const p = await project_row(cx.env, cx.project);
  const rows = await cx.env.DB.prepare("SELECT * FROM cards WHERE project = ? AND removed IS NULL ORDER BY col, rank")
    .bind(cx.project).all();
  const out = [`# ${p.name}`, "", `Exported from Neuratek Factory ${now()}.`, ""];

  for (const col of COLUMNS) {
    const list = rows.results.filter((c) => c.col === col);

    out.push(`## ${NAMES[col]} (${list.length})`, "");

    for (const c of list) {
      out.push(`- **${c.title}**${c.area ? ` · ${c.area}` : ""}${c.ref ? ` · ${c.ref}` : ""}${c.in_roadmap ? "" : " · not yet in the plan"}`);
      if (c.detail) out.push(`  ${c.detail}`);
      if (c.quote) out.push(`  > ${c.quote}`);
    }

    out.push("");
  }

  return new Response(out.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}

// ---- Live: every agent's day, across every project -----------------------------
//
// Each agent's day as blocks: the time between one `PUT /now` and the next,
// on a card, working or waiting - read back from the changes, where every
// one is kept. Nothing new is asked of an agent to draw it. `since` is the
// start of the asker's day, which only their browser knows.
//
async function live(env, me, url) {
  const since = url.searchParams.get("since") || new Date(Date.now() - 12 * 3600000).toISOString();

  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(since)) return refused(400, "since is a time, as 2026-11-24T03:00:00.000Z");

  const projects = await reachable(env, me, false);
  const at = now();

  if (!projects.length) return json({ now: at, since, agents: [], steps: [] });

  const ids = projects.map((p) => p.id);
  const marks = ids.map(() => "?").join(", ");
  const DB = env.DB;
  const doing = (await DB.prepare(`SELECT * FROM doing WHERE project IN (${marks})`).bind(...ids).all()).results;
  const said = (await DB.prepare(`SELECT project, at, author, card, data FROM changes WHERE kind = 'now' AND at >= ? AND project IN (${marks}) ORDER BY at, id`)
    .bind(since, ...ids).all()).results;
  const cards = new Map((await DB.prepare(`SELECT id, project, title, col, ref FROM cards WHERE removed IS NULL AND project IN (${marks})`)
    .bind(...ids).all()).results.map((c) => [c.id, c]));
  const open = (await DB.prepare(`SELECT id, project, card, asked_by, question FROM decisions WHERE answer IS NULL AND project IN (${marks})`)
    .bind(...ids).all()).results;
  const people = new Map((await DB.prepare("SELECT id, name FROM people").all()).results.map((p) => [p.id, p.name]));
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const key = (project, author) => project + "\u0000" + author;
  const agents = new Map();
  const agent = (project, author) => {
    const k = key(project, author);
    if (!agents.has(k)) agents.set(k, { project, project_name: names.get(project), author, blocks: [] });
    return agents.get(k);
  };
  const steps = [];

  for (const c of said) {
    let d = {};
    try { d = JSON.parse(c.data); } catch {}
    const a = agent(c.project, c.author);
    const card = cards.get(c.card);
    const last = a.blocks[a.blocks.length - 1];

    if (last && !last.to) last.to = c.at;
    if (d.state && d.state !== "idle") {
      // The same card in the same state goes on being one block.
      if (last && last.to === c.at && last.card === (c.card || null) && last.state === d.state) {
        last.to = null; last.step = d.step || last.step; last.waiting = d.waiting || "";
      } else {
        a.blocks.push({ card: c.card || null, title: card ? card.title : d.step || "", ref: card ? card.ref : "", col: card ? card.col : null,
                        state: d.state, from: c.at, to: null, step: d.step || "", waiting: d.waiting || "" });
      }
    }
    if (d.step || d.waiting) {
      steps.push({ at: c.at, author: c.author, project: c.project, card: c.card || null, title: card ? card.title : "",
                   state: d.state || "working", step: d.step || "", waiting: d.waiting || "" });
    }
  }

  for (const d of doing) {
    // An agent at work, or one that said something today.
    if (d.state === "idle" && d.updated < since && !agents.has(key(d.project, d.author))) continue;

    const a = agent(d.project, d.author);
    const card = cards.get(d.card);
    const last = a.blocks[a.blocks.length - 1];

    if (last && !last.to && d.state === "idle") last.to = d.updated;
    // At work since before the day began: a block from the day's start.
    if (!a.blocks.length && d.state !== "idle") {
      a.blocks.push({ card: d.card, title: card ? card.title : d.step, ref: card ? card.ref : "", col: card ? card.col : null,
                      state: d.state, from: since > d.since ? since : d.since, to: null, step: d.step, waiting: d.waiting });
    }
    const q = d.card && open.find((x) => x.project === d.project && x.card === d.card && x.asked_by === d.author);

    Object.assign(a, { person: d.person, person_name: people.get(d.person) || "", model: d.model || "", state: d.state, card: d.card,
                       title: card ? card.title : "", ref: card ? card.ref : "", col: card ? card.col : null, step: d.step,
                       waiting: d.waiting, since: d.since, updated: d.updated, decision: q ? { id: q.id, question: q.question } : null });
  }

  const list = [...agents.values()].filter((a) => a.state !== undefined || a.blocks.length);

  list.sort((x, y) => (x.state === "idle") - (y.state === "idle") || (x.project_name || "").localeCompare(y.project_name || "") || x.author.localeCompare(y.author));
  return json({ now: at, since, agents: list, steps: steps.reverse().slice(0, 60) });
}

// ---- Connecting a coding agent ----------------------------------------------
//
// A person, signed in on the page, asks for a setup code for a project; the
// page shows it inside a prompt to paste into Claude Code in that project's
// repository. Claude Code trades it once, within ten minutes, for an agent
// key of that person's limited to that project, and is handed the section
// to add to the repository's CLAUDE.md. No key crosses a chat or a screen.
//
const CONNECT_MINUTES = 10;

async function new_connect(cx) {
  if (cx.me.by_key) return refused(403, "a setup code is asked for by a person signed in, not by a key");
  if (!writes(cx.me, cx.project)) return refused(403, "a viewer connects no agent to this project");

  const code = "fc_" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const t = new Date();
  const expires = new Date(t.getTime() + CONNECT_MINUTES * 60000).toISOString();

  await cx.env.DB.prepare("INSERT INTO connects (hash, person, project, created, expires) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(code), cx.me.person.id, cx.project, t.toISOString(), expires).run();
  return json({ code, expires, minutes: CONNECT_MINUTES }, 201);
}

// What the repository's CLAUDE.md is given: where the project is, and how
// work is done on it.
function factory_section(origin, p, name) {
  const api = `${origin}/api/p/${p.id}`;
  const key = `~/.config/neuratek-factory/${p.id}.key`;

  return `## Neuratek Factory

This repository's work is planned on Neuratek Factory, project **${p.name}**
(\`${p.id}\`): ${origin}. You work there as **${name}**.

The key is in \`${key}\`; send it as
\`Authorization: Bearer $(cat ${key})\`. Never print it, and never put it in
this repository or in a message.

How to work:

- **Take the next task**: \`POST ${api}/queue/take\`. It is the top of the
  queue, and the card it names moves to Building. Work on nothing else
  unless a person asks.
- **Say what you are doing, at every step**: \`PUT ${api}/now\` with
  \`{"card": "<id>", "state": "working", "step": "<a few words>"}\` - and, the
  first time, \`"model": "<the model you run on>"\`; while you wait,
  \`"state": "waiting", "waiting": "<on what>"\`; with nothing left,
  \`"state": "idle"\`. Each step is a line in the project's Live view.
- **Ask, do not guess**: a note on the card with \`"asks": true\`
  (\`POST ${api}/cards/<id>/notes\`), or a decision with \`question\` and
  \`options\` (\`POST ${api}/decisions\`) - then wait for the answer.
- **Show the work**: what was done as notes on the card, and screenshots as
  files (\`POST ${api}/cards/<id>/files?name=<file>\`, the bytes as the body).
- **Done is tested**: then \`POST ${api}/cards/<id>/move\` with
  \`{"column": "done"}\`, and take the next.

Every route is listed in the page's API view.
`;
}

async function trade_connect(request, env, url) {
  let body;

  try { body = JSON.parse(await request.text()); } catch { return refused(400, "the body is not JSON"); }
  if (!body || typeof body.code !== "string" || !/^fc_[0-9a-f]{40}$/.test(body.code)) return refused(400, "no setup code");

  const DB = env.DB;
  const c = await DB.prepare("SELECT * FROM connects WHERE hash = ?").bind(await sha256(body.code)).first();
  const t = now();

  if (!c || c.used || c.expires < t) return refused(401, "this setup code is used, expired or unknown: make a new one on the page");

  const person = await DB.prepare("SELECT * FROM people WHERE id = ? AND removed IS NULL").bind(c.person).first();
  const p = await project_row(env, c.project);
  const member = person && await DB.prepare("SELECT role FROM members WHERE project = ? AND person = ?").bind(c.project, person.id).first();
  const may = person && p && !p.archived && (person.admin || (member && member.role === "member") || (!member && p.everyone === "member"));

  if (!may) return refused(403, "whoever made this setup code no longer edits this project");

  // Taken once: whoever marks it used is the one who gets the key.
  const took = await DB.prepare("UPDATE connects SET used = ? WHERE id = ? AND used IS NULL").bind(t, c.id).run();

  if (!took.meta.changes) return refused(401, "this setup code is used, expired or unknown: make a new one on the page");

  // "Claude (Ana)", or what the agent says it is; one name for one agent,
  // since the now-strip has a line per name.
  const first = person.name.split(/\s+/)[0] || person.handle;
  const base = (text(body.name, "name") || `Claude (${first})`).slice(0, LIMITS.name - 3);
  let name = base;

  for (let n = 2; await DB.prepare("SELECT 1 FROM keys WHERE name = ? AND revoked IS NULL").bind(name).first(); n++) name = `${base} ${n}`;

  const key = "kb_" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const made = await DB.prepare("INSERT INTO keys (name, hash, person, agent, projects, created) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(name, await sha256(key), person.id, JSON.stringify([p.id]), t).run();

  await DB.prepare("UPDATE connects SET key = ? WHERE id = ?").bind(made.meta.last_row_id, c.id).run();
  await log({ env, author: person.name, project: p.id }, "agent.connect", null, { name });
  return json({ key, name, project: p.id, project_name: p.name, url: url.origin,
                claude_md: factory_section(url.origin, p, name) }, 201);
}

// A project's own routes, `parts` being what follows `/api/p/<project>/`.
async function project_api(cx, request, url, m, parts, body, upload) {
  if (parts[0] === "connect" && parts.length === 1 && m === "POST") return new_connect(cx);
  if (parts[0] === "members") {
    if (parts.length === 1 && m === "GET") return list_members(cx);
    if (parts.length === 2 && m === "PUT") return set_member(cx, Number(parts[1]), body);
    if (parts.length === 2 && m === "DELETE") return remove_member(cx, Number(parts[1]));
  }
  if (m !== "GET" && !writes(cx.me, cx.project)) return refused(403, "a viewer reads this project and does not change it");
  if (parts[0] === "cards") {
    if (parts.length === 1 && m === "GET") return list_cards(cx, url);
    if (parts.length === 1 && m === "POST") return new_card(cx, body);
    if (parts.length === 2 && m === "GET") return get_card(cx, parts[1]);
    if (parts.length === 2 && m === "PATCH") return edit_card(cx, parts[1], body);
    if (parts.length === 2 && m === "DELETE") return remove_card(cx, parts[1]);
    if (parts.length === 3 && parts[2] === "move" && m === "POST") return move_card(cx, parts[1], body);
    if (parts.length === 3 && parts[2] === "notes" && m === "POST") return add_note(cx, parts[1], body);
    if (upload) return add_file(cx, request, url, { card: parts[1] });
  }
  if (parts[0] === "decisions") {
    if (parts.length === 1 && m === "GET") return list_decisions(cx, url);
    if (parts.length === 1 && m === "POST") return new_decision(cx, body);
    if (parts.length === 2 && m === "PATCH") return answer_decision(cx, Number(parts[1]), body);
  }
  if (parts[0] === "queue") {
    if (parts.length === 1 && m === "GET") return get_queue(cx);
    if (parts.length === 1 && m === "POST") return enqueue(cx, body);
    if (parts.length === 2 && parts[1] === "take" && m === "POST") return take(cx);
    if (parts.length === 2 && m === "DELETE") return dequeue(cx, Number(parts[1]));
    if (parts.length === 3 && parts[2] === "move" && m === "POST") return move_queued(cx, Number(parts[1]), body);
  }
  if (parts[0] === "discussions") {
    if (parts.length === 1 && m === "GET") return list_discussions(cx, url);
    if (parts.length === 1 && m === "POST") return new_discussion(cx, body);
    if (parts.length === 2 && m === "GET") return get_discussion(cx, Number(parts[1]));
    if (parts.length === 2 && m === "PATCH") return edit_discussion(cx, Number(parts[1]), body);
    if (parts.length === 3 && parts[2] === "messages" && m === "POST") return add_message(cx, Number(parts[1]), body);
    if (parts.length === 3 && parts[2] === "cards" && m === "POST") return discussion_card(cx, Number(parts[1]), body);
    if (upload) return add_file(cx, request, url, { discussion: Number(parts[1]) });
  }
  if (parts[0] === "waiting" && m === "GET") return waiting_in(cx.env, cx.me, [cx.project]);
  if (parts[0] === "now" && m === "GET") return get_now(cx);
  if (parts[0] === "now" && m === "PUT") return set_now(cx, body);
  if (parts[0] === "changes" && m === "GET") return changes_in(cx.env, [cx.project], url);
  if (parts[0] === "export.md" && m === "GET") return export_md(cx);
  return null;
}

async function api(request, env, url) {
  // The one route a request without a key or a sign-in may take: the setup
  // code it carries is what says who it is.
  if (url.pathname === "/api/connect" && request.method === "POST") return trade_connect(request, env, url);

  const key = await who(request, env);

  if (!key) return refused(401, "sign in with your Google account, or send a key: Authorization: Bearer kb_...");

  // Signed in by a cookie, a change must also carry a header no other site
  // can send without asking first - so a page elsewhere cannot act for you.
  if (!key.by_key && request.method !== "GET" && request.headers.get("x-factory") !== "1") {
    return refused(403, "a change from the browser carries X-Factory: 1");
  }

  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const m = request.method;
  let body = {};

  // A file's bytes are the body: `.../cards/<id>/files` or `.../discussions/<id>/files`.
  const upload = m === "POST" && parts[0] === "p" && parts.length === 5 && parts[4] === "files";

  if ((m === "POST" || m === "PATCH" || m === "PUT") && !upload) {
    // No body at all is nothing to say - a take, a move to the end.
    const raw = await request.text();

    try {
      body = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return refused(400, "the body is not JSON");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) return refused(400, "the body is not an object");
  }

  try {
    if (parts[0] === "me" && m === "GET") {
      return json({ name: key.name, agent: key.agent, person: person_shape(key.person), admin: key.admin,
                    projects: key.narrow, roles: Object.fromEntries(key.roles) });
    }
    if (parts[0] === "mine" && parts.length === 1 && m === "GET") return await mine(env, key);
    if (parts[0] === "live" && parts.length === 1 && m === "GET") return await live(env, key, url);
    if (parts[0] === "mentions" && parts.length === 3 && parts[2] === "done" && m === "POST") return await mention_done(env, key, Number(parts[1]));
    if (parts[0] === "people") {
      if (parts.length === 1 && m === "GET") return await list_people(env, key);
      if (parts.length === 1 && m === "POST") return await new_person_route(env, key, body);
      if (parts.length === 2 && m === "PATCH") return await edit_person(env, key, Number(parts[1]), body);
    }
    if (parts[0] === "projects") {
      if (parts.length === 1 && m === "GET") return await list_projects(env, key, url);
      if (parts.length === 1 && m === "POST") return await new_project(env, key, body);
      if (parts.length === 2 && m === "PATCH") return await edit_project(env, key, parts[1], body);
    }
    if (parts[0] === "files" && parts.length === 2 && m === "GET") return await get_file(env, key, parts[1]);
    if (parts[0] === "files" && parts.length === 2 && m === "DELETE") return await remove_file(env, key, parts[1]);

    // Across every project the key reaches.
    if (parts.length === 1 && m === "GET" && ["now", "waiting", "changes"].includes(parts[0])) {
      const ids = (await reachable(env, key, false)).map((p) => p.id);

      if (parts[0] === "waiting") return await waiting_in(env, key, ids);
      if (parts[0] === "changes") return await changes_in(env, ids, url);

      const out = [];
      for (const id of ids) out.push(...await now_of(env, id));
      return json({ now: out });
    }

    if (parts[0] === "p" && parts.length >= 3) {
      const project = parts[1];
      const p = await project_row(env, project);

      // A project the key does not reach is one it cannot tell exists.
      if (!p || !reaches(key, project)) return refused(404, `no project ${project}`);

      const res = await project_api({ env, me: key, author: key.name, project }, request, url, m, parts.slice(2), body, upload);

      if (res) return res;
    }
  } catch (e) {
    return refused(400, e.message);
  }

  return refused(404, `no ${m} ${url.pathname}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") return api(request, env, url);

    return env.ASSETS.fetch(request);
  },
};
