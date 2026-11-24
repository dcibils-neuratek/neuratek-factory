//  Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
// Cloudflare Access, as test_board.py needs it: a signing key, its
// certificates as Access serves them, and tokens signed with it.
//
//     node test_access.mjs keys DIR                     a key into DIR, its certs as DIR/certs.json
//     node test_access.mjs sign DIR EMAIL AUD ISS [SECONDS]   a token, printed; SECONDS to expiry, -60 for an expired one

import { generateKeyPairSync, createPrivateKey, createSign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [verb, dir, email, aud, iss, seconds] = process.argv.slice(2);
const url = (b) => Buffer.from(b).toString("base64url");

if (verb === "keys") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(join(dir, "access.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));
  const jwk = publicKey.export({ format: "jwk" });
  writeFileSync(join(dir, "certs.json"), JSON.stringify({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] }));
} else if (verb === "sign") {
  const key = createPrivateKey(readFileSync(join(dir, "access.pem")));
  const t = Math.floor(Date.now() / 1000);
  const head = url(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" }));
  const body = url(JSON.stringify({ aud: [aud], email, iss, iat: t, exp: t + Number(seconds || 600), sub: email }));
  const sig = createSign("RSA-SHA256").update(head + "." + body).sign(key);
  process.stdout.write(head + "." + body + "." + url(sig));
} else {
  console.error("node test_access.mjs keys DIR | sign DIR EMAIL AUD ISS [SECONDS]");
  process.exit(2);
}
