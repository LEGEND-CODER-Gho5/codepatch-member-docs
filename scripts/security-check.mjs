// Unauthenticated access sweep against a running server.
//   BASE_URL=http://localhost:3000 npm run test:security
// Every protected page must redirect to a sign-in page, the event stream must
// refuse the request, and a forged session cookie must not grant access.
const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const fakeId = "00000000-0000-4000-8000-000000000000";

const checks = [
  ["/directory", "/login"],
  ["/welcome", "/login"],
  [`/members/${fakeId}`, "/login"],
  [`/members/${fakeId}/login`, "/login"],
  ["/admin", "/login"],
  ["/admin/members", "/login"],
  ["/admin/documentation", "/login"],
  [`/admin/documentation/${fakeId}`, "/login"],
  ["/admin/history", "/login"],
  ["/admin/history/1", "/login"],
  ["/admin/notifications", "/login"],
  ["/admin/departments", "/login"],
  ["/admin/settings", "/login"],
  ["/admin/backups", "/login"],
  ["/admin/backups/spreadsheet", "/login"],
  ["/admin/backups/full", "/login"],
  ["/admin/backups/saved?name=backups/20260101T000000Z-scheduled.json", "/login"],
  ["/admin/login", "/login"],
];

let failures = 0;
async function location(path, headers = {}) {
  const response = await fetch(base + path, { redirect: "manual", headers });
  return { status: response.status, location: response.headers.get("location") ?? "" };
}

for (const [path, expected] of checks) {
  const { status, location: target } = await location(path);
  const ok = status >= 300 && status < 400 && new URL(target, base).pathname === expected;
  console.log(`${ok ? "pass" : "FAIL"}  ${path} -> ${status} ${target}`);
  if (!ok) failures++;
}

for (const cookie of ["cps_admin=forged-token", "cps_site=forged; cps_member=forged; cps_admin=forged"]) {
  const { status, location: target } = await location("/admin/history", { cookie });
  const ok = status >= 300 && status < 400 && new URL(target, base).pathname === "/login";
  console.log(`${ok ? "pass" : "FAIL"}  forged cookies (${cookie.split(";").length}) on /admin/history -> ${status} ${target}`);
  if (!ok) failures++;
}

for (const cookie of ["cps_admin=forged-token", "cps_site=forged; cps_member=forged; cps_admin=forged"]) {
  const { status, location: target } = await location("/admin/backups/full", { cookie });
  const ok = status >= 300 && status < 400 && new URL(target, base).pathname === "/login";
  console.log(`${ok ? "pass" : "FAIL"}  forged cookies (${cookie.split(";").length}) on /admin/backups/full -> ${status} ${target}`);
  if (!ok) failures++;
}

const crossSite = await fetch(`${base}/admin/backups/full`, { redirect: "manual", headers: { "sec-fetch-site": "cross-site" } });
console.log(`${crossSite.status === 403 ? "pass" : "FAIL"}  /admin/backups/full started by another website -> ${crossSite.status}`);
if (crossSite.status !== 403) failures++;

// The nightly backup function answers only Vercel's scheduler: a plain request
// must never run it (400 = not a schedule dispatch; 404 = not publicly routed).
const scheduled = await fetch(`${base}/api/scheduled-backup`, { method: "POST", redirect: "manual" });
console.log(`${[400, 404, 405].includes(scheduled.status) ? "pass" : "FAIL"}  POST /api/scheduled-backup without a schedule dispatch -> ${scheduled.status}`);
if (![400, 404, 405].includes(scheduled.status)) failures++;

const stream = await fetch(`${base}/api/stream`);
console.log(`${stream.status === 401 ? "pass" : "FAIL"}  /api/stream without a session -> ${stream.status}`);
if (stream.status !== 401) failures++;
await stream.body?.cancel();

const headersResponse = await fetch(`${base}/login`);
for (const header of ["x-frame-options", "x-content-type-options", "referrer-policy"]) {
  const value = headersResponse.headers.get(header);
  console.log(`${value ? "pass" : "FAIL"}  security header ${header}: ${value}`);
  if (!value) failures++;
}
if (headersResponse.headers.get("x-powered-by")) {
  console.log("FAIL  x-powered-by header is exposed");
  failures++;
}

console.log(failures === 0 ? "\nAll unauthenticated access checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
