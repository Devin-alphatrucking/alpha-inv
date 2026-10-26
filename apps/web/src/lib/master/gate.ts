/**
 * Keeps the master console on an address of its own (MASTER_HOST, for example admin.example.com).
 *
 * With MASTER_HOST set:
 *  - on that address only the console, its sign-in, the account page (to turn on two-step) and Auth.js itself exist; every other path is a plain 404,
 *    so customers' pages, sign-in and sign-up are not there at all;
 *  - on every other address the console and the operator sign-in do not exist (404), so nobody finds them through the customer site.
 * With MASTER_HOST empty (local work) nothing changes.
 *
 * This is a pure function so the rules can be tested without a server.
 */

export type GateDecision = { action: "pass" } | { action: "not_found" } | { action: "redirect"; to: string };

const CONSOLE_PREFIXES = ["/master", "/api/master", "/operator-login"];
const MASTER_HOST_ALSO = ["/account", "/api/auth", "/api/project-scope", "/robots.txt", "/favicon.ico", "/apple-icon.png", "/manifest.webmanifest"];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Lower-case address without a trailing dot; the port is kept (admin.local:3000 differs from admin.local). */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

export function masterGate(input: { masterHost: string | null | undefined; host: string | null | undefined; pathname: string; signedIn: boolean }): GateDecision {
  const master = normalizeHost(input.masterHost);
  if (!master) return { action: "pass" };
  const onMaster = normalizeHost(input.host) === master;
  const { pathname } = input;
  const isConsole = CONSOLE_PREFIXES.some((p) => under(pathname, p));

  if (!onMaster) return isConsole ? { action: "not_found" } : { action: "pass" };

  if (pathname === "/") return { action: "redirect", to: "/master" };
  if (pathname === "/login") return { action: "redirect", to: "/operator-login" }; // after signing out
  const allowed = isConsole || MASTER_HOST_ALSO.some((p) => under(pathname, p));
  if (!allowed) return { action: "not_found" };
  // Signed-out visitors to the console go to the operator sign-in (never to the customer sign-in, which does not exist here).
  if (!input.signedIn && (under(pathname, "/master") || under(pathname, "/account") || under(pathname, "/api/master") || under(pathname, "/api/project-scope"))) {
    return pathname.startsWith("/api/") ? { action: "not_found" } : { action: "redirect", to: `/operator-login?callbackUrl=${encodeURIComponent(pathname)}` };
  }
  return { action: "pass" };
}
