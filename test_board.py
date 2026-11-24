#!/usr/bin/env python3
#  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
"""Neuratek Factory's API, on this Mac: `wrangler dev --local` over a
database made fresh in a temporary folder, and every route asked.

    python3 test_board.py

A test key is made for the run (the local exception: it never leaves this
machine's temporary folder). Checked: projects made, listed, renamed and
put away; a project's cards, queue and now unseen from another, and a key
limited to one project refused the rest; nothing is answered without a key, or
with a withdrawn one; a card made, read, edited, moved into a column and
before another, noted and removed; ordering in a column; decisions asked
and answered, the answer a note on its card; what changed since a time,
signed by the key's name; the Markdown export; and bad bodies refused
with a reason. Then the page, in headless Chrome, by test_page.mjs.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import shutil
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

fails, checks = [], 0
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def check(ok, what):
    global checks
    checks += 1
    if not ok:
        fails.append(what)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def routes_agree():
    """The page's API table is README.md's, row for row."""
    import re
    readme = [list(m.groups()) for m in re.finditer(r"^\| (GET|POST|PATCH|PUT|DELETE) \| `([^`]*)` \| (.*) \|$",
                                                       open(os.path.join(HERE, "README.md")).read(), re.M)]
    page = re.search(r"^const ROUTES = (.*);$", open(os.path.join(HERE, "public", "index.html")).read(), re.M)
    check(page and json.loads(page.group(1)) == readme, "the page's API table is not README.md's")


def main():
    global checks
    routes_agree()
    state = tempfile.mkdtemp(prefix="factory-")
    run = lambda *a: subprocess.run(["wrangler", *a, "--local", "--persist-to", state],
                                    cwd=HERE, capture_output=True, text=True)
    made = run("d1", "execute", "neuratek-factory", "--file", "schema.sql")
    if made.returncode != 0:
        print("FAIL: the schema would not apply: " + made.stderr[-600:])
        return 1

    def keys(*a):
        k = subprocess.run([sys.executable, "keys.py", "--local", "--persist-to", state, *a], cwd=HERE, capture_output=True, text=True)
        if k.returncode != 0:
            print("FAIL: keys.py %s: %s" % (" ".join(a), (k.stderr or k.stdout)[-600:]))
            sys.exit(1)
        return k.stdout

    keyfile = os.path.join(state, "test.key")
    other = os.path.join(state, "other.key")
    claudefile = os.path.join(state, "claude.key")
    keys("person", "add", "test@neuratek.test", "--name", "Test", "--admin")
    keys("person", "add", "other@neuratek.test", "--name", "Other")
    for name, path, whose, agent in (("Test", keyfile, "test@neuratek.test", []), ("Other", other, "other@neuratek.test", []),
                                     ("Claude", claudefile, "test@neuratek.test", ["--agent"])):
        keys("make", name, "--person", whose, "--to", path, *agent)

    # Cloudflare Access, played by a key of the test's own and a server
    # handing out its certificates as Access does.
    import http.server
    import threading
    subprocess.run(["node", "test_access.mjs", "keys", state], cwd=HERE, check=True)
    certs = open(os.path.join(state, "certs.json"), "rb").read()

    class Certs(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if self.path == "/cdn-cgi/access/certs" else 404)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(certs)

        def log_message(self, *a):
            pass

    team = http.server.HTTPServer(("127.0.0.1", 0), Certs)
    threading.Thread(target=team.serve_forever, daemon=True).start()
    issuer = "http://127.0.0.1:%d" % team.server_address[1]

    def token(email, aud="factory-test", iss=None, seconds=600):
        return subprocess.run(["node", "test_access.mjs", "sign", state, email, aud, iss or issuer, str(seconds)],
                              cwd=HERE, capture_output=True, text=True, check=True).stdout

    key = open(keyfile).read().strip()
    port = free_port()
    dev = subprocess.Popen(["wrangler", "dev", "--local", "--persist-to", state, "--port", str(port), "--ip", "127.0.0.1",
                            "--var", "ACCESS_TEAM:" + issuer, "--var", "ACCESS_AUD:factory-test", "--var", "ACCESS_DOMAIN:neuratek.test"],
                           cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = "http://127.0.0.1:%d" % port

    def call(method, path, body=None, auth=key, access=None, cookie=None, factory=True):
        req = urllib.request.Request(base + path, method=method,
                                     data=None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode()))
        if auth and not access and not cookie:
            req.add_header("Authorization", "Bearer " + auth)
        if access:
            req.add_header("Cf-Access-Jwt-Assertion", access)
        if cookie:
            req.add_header("Cookie", "other=1; CF_Authorization=" + cookie)
        if factory and (access or cookie):
            req.add_header("X-Factory", "1")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read().decode(errors="replace")
                return r.status, (json.loads(raw) if r.headers.get("content-type", "").startswith("application/json") else raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw

    try:
        deadline = time.time() + 60
        while True:
            try:
                urllib.request.urlopen(base + "/", timeout=2)
                break
            except Exception:                                   # noqa: BLE001 - not up yet
                if time.time() > deadline or dev.poll() is not None:
                    print("FAIL: wrangler dev never answered")
                    return 1
                time.sleep(0.5)

        P = "/api/p/kosmos"
        s, b = call("GET", P + "/cards", auth=None)
        check(s == 401 and "key" in b.get("error", ""), "a request with no key was answered: %r" % ((s, b),))
        s, _ = call("GET", P + "/cards", auth="kb_" + "0" * 40)
        check(s == 401, "an unknown key was answered")
        s, b = call("GET", "/api/me")
        check(s == 200 and b.get("name") == "Test" and b.get("projects") is None and b.get("admin") is True
              and b["person"]["email"] == "test@neuratek.test", "the key's name: %r" % ((s, b),))

        # Projects: made, listed; the rest of the run is in one of them.
        s, b = call("POST", "/api/projects", {"name": "Kosmos", "detail": "the operating system"})
        check(s == 201 and b["project"]["id"] == "kosmos", "a project made: %r" % ((s, b),))
        s, b = call("POST", "/api/projects", {"name": "Kosmos"})
        check(s == 400 and "already" in b["error"], "a project made twice: %r" % ((s, b),))
        s, b = call("POST", "/api/projects", {"name": "Bad", "id": "Not An Id"})
        check(s == 400 and "id" in b["error"], "a bad project id taken: %r" % ((s, b),))
        s, b = call("POST", "/api/projects", {"name": "Neuratek Site", "id": "site"})
        check(s == 201, "a second project made: %r" % ((s, b),))
        s, b = call("GET", "/api/projects")
        check([p["id"] for p in b["projects"]] == ["kosmos", "site"], "the projects listed: %r" % b)
        s, b = call("GET", "/api/p/nowhere/cards")
        check(s == 404 and "project" in b["error"], "a project that is not there answered: %r" % ((s, b),))

        s, b = call("POST", P + "/cards", {"title": "Mail M6: write, reply and forward", "column": "next", "area": "Mail", "ref": "Mail M6"})
        check(s == 201 and b["card"]["col"] == "next" and b["card"]["in_roadmap"] is False, "a card made: %r" % ((s, b),))
        m6 = b["card"]["id"]
        s, b = call("POST", P + "/cards", {"title": "Astra split D2", "column": "next", "area": "Desktop"})
        d2 = b["card"]["id"]
        s, b = call("POST", P + "/cards", {"title": "Read NTFS drives"})
        ntfs = b["card"]["id"]
        check(b["card"]["col"] == "ideas", "a card with no column is not an idea: %r" % b)

        s, b = call("GET", P + "/cards?column=next")
        check([c["id"] for c in b["cards"]] == [m6, d2], "Next in the order made: %r" % b)

        s, b = call("POST", P + "/cards/%s/move" % d2, {"column": "next", "before": m6})
        s, b = call("GET", P + "/cards?column=next")
        check([c["id"] for c in b["cards"]] == [d2, m6], "a card moved before another: %r" % b)

        s, b = call("POST", P + "/cards/%s/move" % ntfs, {"column": "agreed"})
        check(s == 200 and b["card"]["col"] == "agreed", "a card moved to a column: %r" % ((s, b),))

        s, b = call("PATCH", P + "/cards/%s" % m6, {"detail": "The composer as drawn.", "in_roadmap": True})
        check(s == 200 and b["card"]["detail"] == "The composer as drawn." and b["card"]["in_roadmap"] is True,
              "a card edited: %r" % ((s, b),))

        s, b = call("POST", P + "/cards/%s/notes" % m6, {"text": "M5 built in 0.11.91."})
        check(s == 201 and b["note"]["author"] == "Test", "a note signed: %r" % ((s, b),))

        s, b = call("POST", P + "/decisions", {"card": d2, "question": "Who draws an ordinary window?",
                                               "options": ["Every window itself", "The server"]})
        check(s == 201 and b["decision"]["answer"] is None, "a decision asked: %r" % ((s, b),))
        did = b["decision"]["id"]
        s, b = call("GET", P + "/decisions?open=true")
        check(len(b["decisions"]) == 1, "the open decisions: %r" % b)
        s, b = call("PATCH", P + "/decisions/%d" % did, {"answer": "Every window itself", "words": "as recommended"})
        check(s == 200 and b["decision"]["answer"] == "Every window itself", "a decision answered: %r" % ((s, b),))
        s, b = call("GET", P + "/decisions?open=true")
        check(len(b["decisions"]) == 0, "an answered decision still open")

        s, b = call("GET", P + "/cards/%s" % d2)
        check(any("Decided: Who draws" in n["text"] for n in b["notes"]), "the answer is not a note on its card: %r" % b)
        check([h["kind"] for h in b["history"]][:2] == ["card.new", "card.move"], "a card's history: %r" % b["history"])

        s, b = call("GET", P + "/changes?since=1970-01-01T00:00:00Z")
        kinds = [c["kind"] for c in b["changes"]]
        check(s == 200 and kinds.count("card.new") == 3 and "decision.answer" in kinds and all(c["author"] == "Test" for c in b["changes"]),
              "what changed, signed: %r" % kinds)
        later = b["now"]
        s, b = call("GET", P + "/changes?since=" + later)
        check(b["changes"] == [], "changes since the last look were not empty")

        s, b = call("DELETE", P + "/cards/%s" % ntfs)
        s, b = call("GET", P + "/cards")
        check(ntfs not in [c["id"] for c in b["cards"]], "a removed card is still listed")

        # What Claude is doing now: idle until said, then its card, step and
        # wait; `since` held while the card is the same, moved with the card.
        s, b = call("GET", P + "/now")
        check(s == 200 and b["now"] == [], "now, before anything: %r" % b)
        s, b = call("PUT", P + "/now", {"card": m6, "step": "the composer's To field", "state": "working"})
        check(s == 200 and b["now"]["card"] == m6 and b["now"]["title"] == "Mail M6: write, reply and forward"
              and b["now"]["author"] == "Test", "now, said: %r" % ((s, b),))
        first_since = b["now"]["since"]
        time.sleep(1.1)
        s, b = call("PUT", P + "/now", {"card": m6, "step": "running x86-mail-3", "state": "waiting", "waiting": "x86-mail-3"})
        check(b["now"]["since"] == first_since and b["now"]["waiting"] == "x86-mail-3" and b["now"]["updated"] > first_since,
              "the same card kept its since: %r" % b)
        s, b = call("PUT", P + "/now", {"card": d2, "step": "D2", "state": "working"})
        check(b["now"]["since"] > first_since, "a new card did not move since: %r" % b)
        s, b = call("PUT", P + "/now", {"state": "sleeping"})
        check(s == 400 and "state" in b["error"], "an unknown state taken: %r" % ((s, b),))
        s, b = call("GET", P + "/changes?since=" + later)
        check([c["kind"] for c in b["changes"]].count("now") == 3, "now's words not in the changes: %r" % b)

        # Claude's queue: fed by the board, ordered by a person, taken from the top.
        s, b = call("POST", P + "/cards", {"title": "Tooltips on the status icons", "column": "agreed"})
        tips = b["card"]["id"]
        s, b = call("POST", P + "/cards", {"title": "Mixer devices", "column": "agreed"})
        mixer = b["card"]["id"]

        def order():
            return [(e["kind"], e["card"] or e["title"]) for e in call("GET", P + "/queue")[1]["queue"]]

        # Cards made into Next earlier are queued: emptied first, so these
        # checks see only their own entries.
        check([e["card"] for e in call("GET", P + "/queue")[1]["queue"]] == [d2, m6],
              "cards made into Next are not the queue, in Next's order: %r" % order())
        for e in call("GET", P + "/queue")[1]["queue"]:
            call("DELETE", P + "/queue/%d" % e["id"])

        def entry(key):
            return next(e["id"] for e in call("GET", P + "/queue")[1]["queue"] if (e["card"] or e["title"]) == key)

        s, b = call("POST", P + "/queue", {"card": tips})
        check(s == 200 and order() == [("card", tips)], "a card queued: %r" % ((s, b),))
        check(call("GET", P + "/cards/" + tips)[1]["card"]["col"] == "next", "a queued card is not in Next")
        task = "Put 0.11.91 on the M700"
        call("POST", P + "/queue", {"title": task, "top": True})
        call("POST", P + "/queue", {"card": mixer})
        check(order() == [("task", task), ("card", tips), ("card", mixer)], "a task on top, a card last: %r" % order())
        s, b = call("POST", P + "/queue", {"card": tips})
        check(s == 400 and "already" in b["error"], "a card queued twice: %r" % ((s, b),))
        call("POST", P + "/queue/%d/move" % entry(mixer), {"before": entry(tips)})
        check(order() == [("task", task), ("card", mixer), ("card", tips)], "moved before another: %r" % order())
        call("POST", P + "/queue/%d/move" % entry(tips), {"top": True})
        check(order() == [("card", tips), ("task", task), ("card", mixer)], "moved to the top: %r" % order())
        call("DELETE", P + "/queue/%d" % entry(mixer))
        check(order() == [("card", tips), ("task", task)]
              and call("GET", P + "/cards/" + mixer)[1]["card"]["col"] == "agreed",
              "out of the queue, not back in Agreed: %r" % order())
        s, b = call("POST", P + "/queue/take")
        check(s == 200 and b["now"]["card"] == tips and call("GET", P + "/cards/" + tips)[1]["card"]["col"] == "building"
              and order() == [("task", task)], "the top taken as now, its card Building: %r" % ((s, b),))
        s, b = call("POST", P + "/queue/take")
        check(s == 200 and b["now"]["card"] is None and b["now"]["step"] == task and order() == [],
              "a task taken: %r" % ((s, b),))
        s, b = call("POST", P + "/queue/take")
        check(s == 404, "an empty queue gave something")
        call("POST", P + "/queue", {"card": m6})
        call("POST", P + "/cards/%s/move" % m6, {"column": "done"})
        check(order() == [], "a done card stayed in the queue: %r" % order())

        # Talking on a card: a person's word waits for Claude; Claude's answer
        # waits for nobody unless it asks.
        claude = open(claudefile).read().strip()

        def talk(card_id):
            return next(c["talk"] for c in call("GET", P + "/cards")[1]["cards"] if c["id"] == card_id)

        call("POST", P + "/cards/%s/notes" % d2, {"text": "Could the split wait until Mail is done?"})
        check(talk(d2) == "claude", "a person's word does not wait for Claude: %r" % talk(d2))
        call("POST", P + "/cards/%s/notes" % d2, {"text": "Yes - it is after Mail in the queue."}, auth=claude)
        check(talk(d2) is None, "Claude's plain answer waits for someone: %r" % talk(d2))
        call("POST", P + "/cards/%s/notes" % d2, {"text": "Which comes first, D1's questions or D2?", "asks": True}, auth=claude)
        check(talk(d2) == "person", "Claude's question does not wait for the person: %r" % talk(d2))

        # A discussion: started, answered, shaped, made a card.
        s, b = call("POST", P + "/discussions", {"title": "A radio from my own library",
                                                 "idea": "music that learns what I skip", "for": "music all day"})
        check(s == 201 and b["discussion"]["stage"] == "open" and len(b["messages"]) == 1
              and b["discussion"]["talk"] == "claude", "a discussion started: %r" % ((s, b),))
        did = b["discussion"]["id"]
        s, b = call("POST", P + "/discussions/%d/messages" % did, {"text": "From skips, or from the sound?", "asks": True}, auth=claude)
        check(s == 201 and b["discussion"]["talk"] == "person", "Claude's question in a discussion: %r" % b["discussion"])
        s, b = call("GET", P + "/waiting")
        check([x["id"] for x in b["person"]["discussions"]] == [did] and [x["id"] for x in b["person"]["cards"]] == [d2],
              "what waits for the person: %r" % b)
        call("POST", P + "/discussions/%d/messages" % did, {"text": "From skips."})
        s, b = call("GET", P + "/waiting")
        check([x["id"] for x in b["claude"]["discussions"]] == [did], "what waits for Claude: %r" % b)
        s, b = call("PATCH", P + "/discussions/%d" % did, {
            "stage": "shaping", "summary": "A playlist kit, fed by plays and skips.",
            "options": [{"name": "Skips", "plus": "day one", "minus": "learns slowly", "recommended": True},
                        {"name": "Sound", "plus": "good at once", "minus": "slow to build"}],
            "questions": ["Ever the network?"]}, auth=claude)
        d = b["discussion"]
        check(s == 200 and d["stage"] == "shaping" and d["options"][0]["recommended"] and d["questions"] == ["Ever the network?"],
              "a discussion shaped: %r" % ((s, b),))
        s, b = call("PATCH", P + "/discussions/%d" % did, {"stage": "someday"})
        check(s == 400 and "stage" in b["error"], "an unknown stage taken: %r" % ((s, b),))
        s, b = call("POST", P + "/discussions/%d/cards" % did, {"title": "Playlist kit", "column": "agreed", "area": "Audio"})
        check(s == 201 and b["discussion"]["stage"] == "became" and len(b["cards"]) == 1, "a card made from it: %r" % ((s, b),))
        made = b["cards"][0]["id"]
        s, b = call("GET", P + "/cards/" + made)
        check(b["card"]["discussion"] == did and b["card"]["detail"] == "A playlist kit, fed by plays and skips.",
              "the card is not linked to its discussion: %r" % b["card"])
        s, b = call("GET", P + "/discussions?stage=became")
        check([x["id"] for x in b["discussions"]] == [did], "discussions by stage: %r" % b)

        # Dragging on the board: into Next is into the queue, where it was
        # dropped; within Next reorders the queue; out of Next leaves it.
        s, b = call("POST", P + "/cards", {"title": "Calendar", "column": "ideas"})
        cal = b["card"]["id"]
        s, b = call("POST", P + "/cards", {"title": "NTFS", "column": "agreed"})
        ntfs2 = b["card"]["id"]
        call("POST", P + "/queue", {"title": "a task"})
        call("POST", P + "/cards/%s/move" % cal, {"column": "agreed"})
        check(call("GET", P + "/cards/" + cal)[1]["card"]["col"] == "agreed", "an idea dragged to Agreed")
        call("POST", P + "/cards/%s/move" % cal, {"column": "ideas"})
        check(call("GET", P + "/cards/" + cal)[1]["card"]["col"] == "ideas", "and back to Ideas")
        call("POST", P + "/cards/%s/move" % ntfs2, {"column": "next"})
        check(order()[-1] == ("card", ntfs2), "dropped last in Next, not last in the queue: %r" % order())
        call("POST", P + "/cards/%s/move" % cal, {"column": "next", "before": ntfs2})
        check(order()[-2:] == [("card", cal), ("card", ntfs2)], "dropped above a card, not before it in the queue: %r" % order())
        nxt = [c["id"] for c in call("GET", P + "/cards?column=next")[1]["cards"]]
        check(nxt[-2:] == [cal, ntfs2], "Next not in the queue's order: %r" % nxt)
        call("POST", P + "/cards/%s/move" % ntfs2, {"column": "next", "before": cal})
        check(order()[-2:] == [("card", ntfs2), ("card", cal)], "reordered within Next, not in the queue: %r" % order())
        q = {c["id"]: c["queued"] for c in call("GET", P + "/cards?column=next")[1]["cards"]}
        check(q.get(ntfs2) and q.get(cal) and q[ntfs2] == q[cal] - 1, "a card's place in the queue: %r" % q)
        call("POST", P + "/cards/%s/move" % cal, {"column": "agreed"})
        check(("card", cal) not in order(), "dragged out of Next, still queued: %r" % order())

        # Files: a screenshot larger than a piece comes back byte for byte.
        def put(path, data, kind, name="shot.png", caption=""):
            req = urllib.request.Request(base + path + "?" + urllib.parse.urlencode({"name": name, "caption": caption}),
                                         method="POST", data=data)
            req.add_header("Authorization", "Bearer " + claude)
            req.add_header("Content-Type", kind)
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())

        shot = bytes((i * 37 + (i >> 9)) & 0xFF for i in range(1_200_000))
        s, b = put(P + "/cards/%s/files" % d2, b"\x89PNG" + shot, "image/png", "m700.png", "Mail M5 on the M700")
        check(s == 201 and b["file"]["size"] == len(shot) + 4 and b["file"]["author"] == "Claude",
              "a screenshot added: %r" % ((s, b),))
        fid = b["file"]["id"]
        got = urllib.request.urlopen(urllib.request.Request(base + "/api/files/" + fid,
                                                            headers={"Authorization": "Bearer " + key}), timeout=30)
        body_ = got.read()
        check(body_ == b"\x89PNG" + shot and got.headers["content-type"] == "image/png",
              "the screenshot did not come back whole: %d bytes" % len(body_))
        s, b = call("GET", P + "/cards/" + d2)
        check([f["caption"] for f in b["files"]] == ["Mail M5 on the M700"], "a card's files: %r" % b.get("files"))
        check(next(c["files"] for c in call("GET", P + "/cards")[1]["cards"] if c["id"] == d2) == 1, "a card's file count")
        s, b = put(P + "/discussions/%d/files" % did, b"%PDF-1.4 sketch", "application/pdf", "sketch.pdf")
        check(s == 201 and call("GET", P + "/discussions/%d" % did)[1]["files"][0]["name"] == "sketch.pdf",
              "a file on a discussion: %r" % ((s, b),))
        s, b = put(P + "/cards/%s/files" % d2, b"MZ\x90", "application/x-msdownload", "x.exe")
        check(s == 415, "a program taken as a file: %r" % ((s, b),))
        s, b = put(P + "/cards/%s/files" % d2, b"\0" * (16 * 1024 * 1024), "image/png")
        check(s == 413, "16 MB taken: %r" % ((s, b),))
        s, _ = call("GET", "/api/files/" + fid, auth=None)
        check(s == 401, "a file read without a key")
        call("DELETE", "/api/files/" + fid)
        s, _ = call("GET", "/api/files/" + fid)
        check(s == 404, "a removed file still read")

        s, md = call("GET", P + "/export.md")
        check(s == 200 and "## Next (" in md and "## Done (" in md and "**Astra split D2**" in md and "not yet in the plan" in md and md.startswith("# Kosmos"),
              "the Markdown export: %r" % md[:300])

        s, b = call("POST", P + "/cards", {"column": "next"})
        check(s == 400 and "title" in b["error"], "a card with no title made: %r" % ((s, b),))
        s, b = call("POST", P + "/cards", {"title": "x", "column": "someday"})
        check(s == 400 and "column" in b["error"], "an unknown column taken: %r" % ((s, b),))
        s, b = call("POST", P + "/cards", b"not json")
        check(s == 400, "a body that is not JSON taken")
        s, b = call("POST", P + "/cards", {"title": "x" * 300})
        check(s == 400 and "longer" in b["error"], "a title too long taken")

        # Isolation: the second project sees none of the first, and the
        # first's cards cannot be reached through the second's path.
        S = "/api/p/site"
        s, b = call("GET", S + "/cards")
        check(s == 200 and b["cards"] == [], "another project's cards seen: %r" % b)
        s, b = call("GET", S + "/cards/" + d2)
        check(s == 404, "a card reached through another project: %r" % ((s, b),))
        s, b = call("POST", S + "/cards/%s/move" % d2, {"column": "done"})
        check(s == 404, "a card moved through another project: %r" % ((s, b),))
        s, b = call("GET", S + "/queue")
        check(b["queue"] == [], "another project's queue seen: %r" % b)
        s, b = call("GET", S + "/now")
        check(b["now"] == [], "another project's now seen: %r" % b)
        s, b = call("POST", S + "/cards", {"title": "The home page", "column": "next"})
        home = b["card"]["id"]
        s, b = call("POST", S + "/cards/%s/move" % home, {"column": "next", "before": d2})
        check(s == 400, "a card put before another project's card: %r" % ((s, b),))
        call("PUT", S + "/now", {"card": home, "step": "the header"}, auth=claude)
        s, b = call("PUT", S + "/now", {"card": d2, "step": "x"})
        check(s == 404, "now said about another project's card: %r" % ((s, b),))
        s, b = call("GET", "/api/now")
        check(s == 200 and {n["project"]: n["card"] for n in b["now"]}.get("site") == home and len(b["now"]) == 2,
              "now across projects: %r" % b)
        s, b = call("GET", P + "/changes?since=1970-01-01T00:00:00Z")
        check(all(c["project"] == "kosmos" for c in b["changes"]), "another project's changes in this one's: %r" % b)
        s, b = call("GET", "/api/changes?since=1970-01-01T00:00:00Z")
        check({c["project"] for c in b["changes"]} >= {"kosmos", "site"}, "changes across projects: %r" % b)
        s, b = call("GET", "/api/waiting")
        check([x["project"] for x in b["person"]["cards"]] == ["kosmos"] and [x["project"] for x in b["claude"]["discussions"]] == ["kosmos"], "waiting across projects names its project: %r" % b)

        # A key limited to one project.
        sitefile = os.path.join(state, "site.key")
        keys("make", "Site", "--person", "test@neuratek.test", "--to", sitefile, "--project", "site")
        sk = open(sitefile).read().strip()
        s, b = call("GET", "/api/me", auth=sk)
        check(b.get("projects") == ["site"], "a limited key's projects: %r" % b)
        s, b = call("GET", "/api/projects", auth=sk)
        check([p["id"] for p in b["projects"]] == ["site"], "a limited key sees other projects: %r" % b)
        s, b = call("GET", P + "/cards", auth=sk)
        check(s == 404, "a limited key reached another project: %r" % ((s, b),))
        s, b = call("GET", S + "/cards", auth=sk)
        check(s == 200 and [c["id"] for c in b["cards"]] == [home], "a limited key in its own project: %r" % ((s, b),))
        s, b = call("POST", "/api/projects", {"name": "Mine"}, auth=sk)
        check(s == 403, "a limited key made a project: %r" % ((s, b),))
        s, b = call("GET", "/api/now", auth=sk)
        check([n["project"] for n in b["now"]] == ["site"], "a limited key's now across projects: %r" % b)
        sfile = put(S + "/cards/%s/files" % home, b"\x89PNG site", "image/png", "site.png")[1]["file"]["id"]
        s, _ = call("GET", "/api/files/" + sfile, auth=sk)
        check(s == 200, "a limited key could not read its own project's file")
        kfile = put(P + "/cards/%s/files" % d2, b"\x89PNG kosmos", "image/png", "k.png")[1]["file"]["id"]
        s, _ = call("GET", "/api/files/" + kfile, auth=sk)
        check(s == 404, "a limited key read another project's file")
        s, _ = call("DELETE", "/api/files/" + kfile, auth=sk)
        check(s == 404, "a limited key removed another project's file")

        # Renamed and put away: an archived project leaves the list unless asked for.
        s, b = call("PATCH", "/api/projects/site", {"name": "Neuratek website"})
        check(s == 200 and b["project"]["name"] == "Neuratek website", "a project renamed: %r" % ((s, b),))
        call("PATCH", "/api/projects/site", {"archived": True})
        check([p["id"] for p in call("GET", "/api/projects")[1]["projects"]] == ["kosmos"], "an archived project listed")
        check([p["id"] for p in call("GET", "/api/projects?archived=true")[1]["projects"]] == ["kosmos", "site"],
              "an archived project not listed when asked for")
        call("PATCH", "/api/projects/site", {"archived": False})

        # Signing in through Access: checked, not trusted.
        s, b = call("GET", "/api/me", access=token("ana@neuratek.test"))
        check(s == 200 and b["person"]["email"] == "ana@neuratek.test" and b["person"]["handle"] == "ana" and not b["admin"]
              and b["roles"] == {}, "someone signing in for the first time: %r" % ((s, b),))
        ana = b["person"]["id"]
        s, b = call("GET", "/api/projects", cookie=token("ana@neuratek.test"))
        check(s == 200 and b["projects"] == [], "a newcomer sees projects, or the cookie was not taken: %r" % ((s, b),))
        s, b = call("GET", P + "/cards", access=token("ana@neuratek.test"))
        check(s == 404, "a newcomer reached a project: %r" % ((s, b),))
        forged = token("test@neuratek.test")
        forged = forged[:-8] + ("AAAAAAAA" if not forged.endswith("AAAAAAAA") else "BBBBBBBB")
        for what, t in (("a forged signature", forged), ("another audience", token("ana@neuratek.test", aud="other")),
                        ("another issuer", token("ana@neuratek.test", iss="https://evil.example")),
                        ("an expired token", token("ana@neuratek.test", seconds=-60)),
                        ("another domain", token("ana@elsewhere.test")), ("nonsense", "a.b.c")):
            s, _ = call("GET", "/api/me", access=t)
            check(s == 401, "%s was taken: %r" % (what, s))
        s, b = call("POST", "/api/projects", {"name": "Ana's"}, access=token("ana@neuratek.test"), factory=False)
        check(s == 403 and "X-Factory" in b["error"], "a browser change without X-Factory: %r" % ((s, b),))
        s, b = call("POST", "/api/projects", {"name": "Ana's"}, access=token("ana@neuratek.test"))
        check(s == 403 and "admin" in b["error"], "someone not an admin made a project: %r" % ((s, b),))

        # People and members: a person in two projects, as a viewer in one.
        A = lambda: token("ana@neuratek.test")
        s, b = call("PUT", P + "/members/%d" % ana, {"role": "viewer"}, access=A())
        check(s == 404, "someone outside a project added people to it: %r" % ((s, b),))
        s, b = call("PUT", P + "/members/%d" % ana, {"role": "viewer"})
        check(s == 200 and [(m["handle"], m["role"]) for m in b["members"]] == [("ana", "viewer")], "a viewer added: %r" % ((s, b),))
        s, b = call("PUT", S + "/members/%d" % ana, {"role": "member"})
        s, b = call("PUT", S + "/members/%d" % ana, {"role": "owner"})
        check(s == 400 and "role" in b["error"], "an unknown role taken: %r" % ((s, b),))
        s, b = call("GET", "/api/projects", access=A())
        check([(p["id"], p["role"]) for p in b["projects"]] == [("kosmos", "viewer"), ("site", "member")],
              "a person in two projects: %r" % b)
        s, b = call("GET", P + "/cards", access=A())
        check(s == 200 and len(b["cards"]) > 0, "a viewer could not read: %r" % ((s, b),))
        s, b = call("POST", P + "/cards", {"title": "a viewer's card"}, access=A())
        check(s == 403 and "viewer" in b["error"], "a viewer made a card: %r" % ((s, b),))
        s, b = call("PUT", S + "/members/%d" % ana, {"role": "viewer"}, access=A())
        check(s == 403 and "admin" in b["error"], "a member added people: %r" % ((s, b),))
        call("PUT", S + "/members/%d" % ana, {"role": "member"})
        s, b = call("POST", S + "/cards", {"title": "Ana's card"}, access=A())
        check(s == 201 and b["card"]["owners"] == [], "a member made a card: %r" % ((s, b),))
        s, b = call("GET", "/api/people", access=A())
        check(sorted(p["handle"] for p in b["people"]) == ["ana", "test"], "whom a member sees: %r" % b)
        s, b = call("GET", "/api/people")
        check(sorted(p["handle"] for p in b["people"]) == ["ana", "other", "test"], "whom an admin sees: %r" % b)
        s, b = call("POST", "/api/people", {"email": "ben@neuratek.test", "name": "Ben"})
        check(s == 201 and b["person"]["handle"] == "ben", "an admin added someone: %r" % ((s, b),))
        ben = b["person"]["id"]

        # Owners, a question asked of someone, a mention: My work.
        s, b = call("PATCH", P + "/cards/%s" % d2, {"owners": [ana]})
        check(s == 200 and b["card"]["owners"] == [ana], "a card given an owner: %r" % ((s, b),))
        s, b = call("PATCH", P + "/cards/%s" % d2, {"owners": [ben]})
        check(s == 400 and "not in this project" in b["error"], "a card given to someone outside: %r" % ((s, b),))
        call("POST", P + "/decisions", {"card": d2, "question": "Ana, which split?", "options": ["A", "B"], "asks_of": ana}, auth=claude)
        call("POST", P + "/cards/%s/notes" % d2, {"text": "@ana could you look at this? and @nobody"})
        s, b = call("GET", "/api/mine", access=A())
        check(s == 200 and [c["id"] for c in b["owned"]] == [d2] and [d["question"] for d in b["decisions"]] == ["Ana, which split?"]
              and len(b["mentions"]) == 1 and b["mentions"][0]["card"] == d2, "Ana's work: %r" % ((s, b),))
        s, b = call("GET", "/api/mine")
        check(all(d["question"] != "Ana, which split?" for d in b["decisions"]) and b["mentions"] == [],
              "Ana's question or mention in someone else's work: %r" % b)
        call("PUT", P + "/members/%d" % ana, {"role": "member"})
        call("POST", P + "/cards/%s/notes" % d2, {"text": "Looking."}, access=A())
        s, b = call("GET", "/api/mine", access=A())
        check(b["mentions"] == [], "a mention not done once answered in its thread: %r" % b)
        call("POST", P + "/cards/%s/notes" % d2, {"text": "@ana and once more"})
        mid = call("GET", "/api/mine", access=A())[1]["mentions"][0]["id"]
        s, _ = call("POST", "/api/mentions/%d/done" % mid)
        check(s == 404, "someone else's mention marked seen")
        s, _ = call("POST", "/api/mentions/%d/done" % mid, access=A())
        check(s == 200 and call("GET", "/api/mine", access=A())[1]["mentions"] == [], "a mention marked seen")

        # Several Claudes in one project, each its own line in now.
        anaclaude = os.path.join(state, "ana-claude.key")
        keys("make", "Claude (Ana)", "--person", "ana@neuratek.test", "--to", anaclaude, "--agent")
        ak = open(anaclaude).read().strip()
        call("PUT", P + "/now", {"card": d2, "step": "reading", "state": "waiting", "waiting": "Ana's answer"}, auth=ak)
        call("PUT", P + "/now", {"step": "the split", "state": "working"}, auth=claude)
        s, b = call("GET", P + "/now")
        mine_now = {n["author"]: (n["state"], n["person"]) for n in b["now"]}
        check(mine_now.get("Claude (Ana)") == ("waiting", ana) and mine_now.get("Claude", ("",))[0] == "working",
              "two Claudes in one project: %r" % b)
        call("POST", P + "/cards/%s/notes" % cal, {"text": "Shall I take this?", "asks": True}, auth=ak)
        s, b = call("GET", "/api/waiting", access=A())
        check(cal in [c["id"] for c in b["person"]["cards"]], "Ana's Claude's question not waiting for Ana: %r" % b)
        s, b = call("GET", "/api/waiting")
        check(cal not in [c["id"] for c in b["person"]["cards"]], "Ana's Claude's question waiting for someone else: %r" % b)
        s, b = call("POST", P + "/cards/%s/notes" % cal, {"text": "a person cannot ask", "asks": True})
        check(b["note"]["asks"] is False, "a person's note asked")

        # Someone who leaves: neither their sign-in nor their keys answer.
        call("PATCH", "/api/people/%d" % ana, {"removed": True})
        s, _ = call("GET", "/api/me", access=A())
        check(s == 401, "a removed person still signed in")
        s, _ = call("GET", "/api/me", auth=ak)
        check(s == 401, "a removed person's Claude still answered")
        me_id = call("GET", "/api/me")[1]["person"]["id"]
        s, b = call("PATCH", "/api/people/%d" % me_id, {"admin": False})
        check(s == 400, "an admin took themselves out: %r" % ((s, b),))
        call("PATCH", "/api/people/%d" % ana, {"removed": False})

        subprocess.run([sys.executable, "keys.py", "--local", "--persist-to", state, "revoke", "Other"], cwd=HERE, capture_output=True)
        s, _ = call("GET", "/api/me", auth=open(other).read().strip())
        check(s == 401, "a withdrawn key still answered")
        s, _ = call("GET", "/api/me")
        check(s == 200, "withdrawing one key withdrew another")

        # The page itself, in headless Chrome: test_page.mjs says what it checks.
        page = subprocess.run(["node", os.path.join(HERE, "test_page.mjs"), base, key, open(claudefile).read().strip(), CHROME],
                              cwd=HERE, capture_output=True, text=True, timeout=180)
        said = page.stdout.strip().splitlines()
        for line in said:
            if line.startswith("FAIL "):
                check(False, "the page: " + line[5:])
        ran = [l for l in said if l.startswith("checks ")]
        check(page.returncode == 0 or any(l.startswith("FAIL ") for l in said),
              "the page's test did not finish: " + (page.stderr or page.stdout)[-600:])
        checks += int(ran[0].split()[1]) if ran else 0
    finally:
        dev.terminate()
        try:
            dev.wait(10)
        except subprocess.TimeoutExpired:
            dev.kill()
        team.shutdown()
        shutil.rmtree(state, ignore_errors=True)

    if fails:
        print("FAIL: %d of %d checks on Neuratek Factory's API:" % (len(fails), checks))
        for f in fails:
            print("  " + f)
        return 1

    print("PASS: %d checks on Neuratek Factory's API (no key and a withdrawn key refused; signing in through Access checked - a forged signature, another audience, issuer or domain, an expired token refused, a newcomer added to nothing, a browser change needing X-Factory; people in several projects as members and viewers, a viewer refused changes, owners, questions asked of someone, @mentions done when answered, My work, two Claudes in one project, someone who left refused; projects made, listed, renamed and put away, each unseen from another, a key limited to one refused the rest and its files; cards made, "
          "ordered, moved, edited, noted and removed; decisions asked and answered onto their card; "
          "changes since a time, signed; what Claude is doing now, its since held per card; Claude's queue fed, ordered, "
          "emptied and taken from; who owes a reply on a card; a discussion started, answered, shaped "
          "and made a card; files kept in pieces and read back whole, refused by type and size; the Markdown "
          "export; bad bodies refused; and the page in headless Chrome: a key asked for, cards dragged between "
          "columns and back and within one, a picture shown, a note sent, the queue dragged)." % checks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
