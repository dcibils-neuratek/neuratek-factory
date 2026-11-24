#  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
# The page's API view lists every route, and README.md's table is where
# they are written: this copies the table into `const ROUTES` in
# public/index.html. Run it after changing the table.
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROW = re.compile(r"^\| (GET|POST|PATCH|PUT|DELETE) \| `([^`]+)` \| (.*) \|$")

readme = open(os.path.join(HERE, "README.md"), encoding="utf-8").read()
routes = [list(m.groups()) for m in (ROW.match(l) for l in readme.splitlines()) if m]
page = os.path.join(HERE, "public", "index.html")
text = open(page, encoding="utf-8").read()
text, n = re.subn(r"^const ROUTES = .*$", lambda _: "const ROUTES = " + json.dumps(routes, ensure_ascii=False, separators=(",", ":")) + ";",
                  text, count=1, flags=re.M)
if n != 1:
    raise SystemExit("no `const ROUTES = ...` line in public/index.html")
open(page, "w", encoding="utf-8").write(text)
print("%d routes copied into the page" % len(routes))
