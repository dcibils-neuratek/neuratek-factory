#  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
# The README's pictures, taken from the demo project: a database of its own
# made from schema.sql and demo.sql, served by `wrangler dev`, and
# photographed in headless Chrome by screenshots.mjs, light and dark.
#
#     python3 screenshots.py            # into docs/screenshots/
#
# Nothing here touches the deployed Factory.
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
OUT = os.path.join(HERE, "docs", "screenshots")


def main():
    state = tempfile.mkdtemp(prefix="factory-shots-")
    try:
        run = lambda *a: subprocess.run(["wrangler", "d1", "execute", "neuratek-factory", "--local", "--persist-to", state, *a],
                                        cwd=HERE, capture_output=True, text=True, check=True)
        run("--file", "schema.sql")
        run("--file", "demo.sql")
        keys = lambda *a: subprocess.run([sys.executable, "keys.py", "--local", "--persist-to", state, *a],
                                         cwd=HERE, capture_output=True, text=True, check=True)
        keys("person", "add", "lucia@example.com", "--name", "Lucía Pérez", "--admin")
        keyfile = os.path.join(state, "shots.key")
        keys("make", "Lucía's browser", "--person", "lucia@example.com", "--to", keyfile)

        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        dev = subprocess.Popen(["wrangler", "dev", "--local", "--persist-to", state, "--port", str(port), "--ip", "127.0.0.1"],
                               cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = "http://127.0.0.1:%d" % port
        try:
            for _ in range(120):
                try:
                    urllib.request.urlopen(base + "/", timeout=2)
                    break
                except Exception:
                    time.sleep(0.5)
            os.makedirs(OUT, exist_ok=True)
            return subprocess.run(["node", os.path.join(HERE, "screenshots.mjs"), base, open(keyfile).read().strip(), CHROME, OUT],
                                  cwd=HERE).returncode
        finally:
            dev.terminate()
            dev.wait()
    finally:
        shutil.rmtree(state, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
