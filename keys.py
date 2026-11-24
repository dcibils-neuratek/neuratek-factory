#!/usr/bin/env python3
#  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
"""People and keys for Neuratek Factory.

People sign in with Google through Cloudflare Access and are added the first
time they do; an admin is made here, and the rest is done in the page.
Keys are for what does not sign in through a browser - each person's Claude,
a script - and each belongs to a person and acts for them.

    keys.py person add EMAIL [--name N] [--admin]   someone added; the first admin this way
    keys.py person list                             everyone, and whether an admin
    keys.py make NAME --person EMAIL --to FILE      a key into FILE (made private), never printed
    keys.py make NAME --person EMAIL --show         a key printed once, for pasting
      --agent                                       a Claude's: "Claude (Ana)"
      --project ID                                  (repeatable) narrower than its person
    keys.py revoke NAME                             every key of that name withdrawn
    keys.py list                                    keys: name, person, made, last used

`--local` (and `--persist-to DIR`) works on the copy `wrangler dev` uses;
without it, on the database on Cloudflare. Only a key's SHA-256 goes into
the database: the key itself exists in the one place it is given to, and
a lost key is withdrawn and made again, never recovered.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
# Which Cloudflare account holds the Factory: kept on this Mac, not in the
# public repository, and handed to wrangler when nobody else has said.
ACCOUNT = os.path.expanduser("~/.config/neuratek-factory/account")


def d1(args, sql, as_json=False):
    """One statement on the Factory's database, through wrangler; its output."""
    cmd = ["wrangler", "d1", "execute", "neuratek-factory", "--command", sql]
    if as_json:
        cmd.append("--json")
    cmd.append("--local" if args.local else "--remote")
    if args.persist_to:
        cmd += ["--persist-to", args.persist_to]
    env = dict(os.environ)
    if not args.local and "CLOUDFLARE_ACCOUNT_ID" not in env and os.path.exists(ACCOUNT):
        env["CLOUDFLARE_ACCOUNT_ID"] = open(ACCOUNT).read().strip()
    out = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, env=env)
    if out.returncode != 0:
        sys.exit("keys: wrangler refused: " + (out.stderr or out.stdout)[-800:])
    return out.stdout


def d1_json(args, sql):
    """The rows a query gives, through wrangler's JSON."""
    out = d1(args, sql, as_json=True)
    return json.loads(out)[0]["results"]


def person(args):
    if args.what == "list":
        print(d1(args, "SELECT id, email, name, handle, admin, removed FROM people ORDER BY name"))
        return
    email = args.email.lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        sys.exit("keys: %s is not an address" % email)
    if d1_json(args, "SELECT id FROM people WHERE email = %s" % quoted(email)):
        if args.admin:
            d1(args, "UPDATE people SET admin = 1 WHERE email = %s" % quoted(email))
            print("keys: %s is an admin" % email)
        else:
            print("keys: %s is here already" % email)
        return
    handle = re.sub(r"[^a-z0-9._-]", "", email.split("@")[0])[:30] or "person"
    base, n = handle, 2
    while d1_json(args, "SELECT 1 FROM people WHERE handle = %s" % quoted(handle)):
        handle, n = base + str(n), n + 1
    at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    d1(args, "INSERT INTO people (email, name, handle, admin, created) VALUES (%s, %s, %s, %d, %s)"
       % (quoted(email), quoted(args.name or email.split("@")[0]), quoted(handle), 1 if args.admin else 0, quoted(at)))
    print("keys: %s added%s, @%s" % (email, " as an admin" if args.admin else "", handle))


def quoted(s):
    return "'" + s.replace("'", "''") + "'"


def make(args):
    key = "kb_" + secrets.token_hex(20)
    digest = hashlib.sha256(key.encode()).hexdigest()
    at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    who = d1_json(args, "SELECT id FROM people WHERE email = %s AND removed IS NULL" % quoted(args.person.lower()))
    if not who:
        sys.exit("keys: nobody is %s; add them with keys.py person add, or let them sign in first" % args.person)
    for pid in args.project or []:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,39}", pid):
            sys.exit("keys: %s is not a project's id" % pid)
    projects = quoted(json.dumps(args.project)) if args.project else "NULL"
    d1(args, "INSERT INTO keys (name, hash, person, agent, projects, created) VALUES (%s, %s, %d, %d, %s, %s)"
       % (quoted(args.name), quoted(digest), who[0]["id"], 1 if args.agent else 0, projects, quoted(at)))

    if args.to:
        path = os.path.expanduser(args.to)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(key + "\n")
        print("keys: a key named %s, kept in %s" % (args.name, path))
    else:
        print("keys: a key named %s - shown once, paste it where it is used:" % args.name)
        print(key)


def main():
    p = argparse.ArgumentParser(description="Keys for Neuratek Factory's API.")
    p.add_argument("--local", action="store_true", help="the local copy wrangler dev uses")
    p.add_argument("--persist-to", help="where that local copy is kept")
    sub = p.add_subparsers(dest="verb", required=True)
    pe = sub.add_parser("person")
    pe.add_argument("what", choices=["add", "list"])
    pe.add_argument("email", nargs="?")
    pe.add_argument("--name")
    pe.add_argument("--admin", action="store_true")
    m = sub.add_parser("make")
    m.add_argument("name")
    m.add_argument("--person", required=True, help="whose key it is: their address")
    m.add_argument("--agent", action="store_true", help="a Claude's key")
    where = m.add_mutually_exclusive_group(required=True)
    where.add_argument("--to", help="a file to keep it in, made readable by its owner only")
    where.add_argument("--show", action="store_true", help="print it once")
    m.add_argument("--project", action="append", help="a project the key may reach; repeat for more")
    r = sub.add_parser("revoke")
    r.add_argument("name")
    sub.add_parser("list")
    args = p.parse_args()

    if args.verb == "person":
        if args.what == "add" and not args.email:
            sys.exit("keys: person add needs an address")
        person(args)
    elif args.verb == "make":
        make(args)
    elif args.verb == "revoke":
        at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        d1(args, "UPDATE keys SET revoked = %s WHERE name = %s AND revoked IS NULL" % (quoted(at), quoted(args.name)))
        print("keys: every key named %s withdrawn" % args.name)
    else:
        print(d1(args, "SELECT k.name, p.email, k.agent, k.projects, k.created, k.last_used, k.revoked FROM keys k LEFT JOIN people p ON p.id = k.person ORDER BY k.created"))


if __name__ == "__main__":
    main()
