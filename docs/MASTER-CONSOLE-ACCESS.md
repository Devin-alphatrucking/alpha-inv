# Keeping the master console on its own address

If the `/master` address leaks, or many people start hitting a login page, the console should not be reachable through the customers' site at all. This puts it on an address of its own with its own sign-in.

## Turn it on
Set these in the server settings and restart:

| Setting | Example | Meaning |
|---|---|---|
| `MASTER_HOST` | `admin.yourdomain.com` | The only address where the console exists. Leave empty to keep the old behaviour (console at `/master` on the same address). |
| `SECURITY_ALERT_EMAIL` | `you@yourdomain.com` | Who is told about unusual console sign-ins, besides the operator themself. Several addresses can be separated by commas. Optional. |

Point the `admin` address at the same app (a second domain name on the same server). Customers keep using the normal address.

## What changes with `MASTER_HOST` set
- **On the master address** only these exist: the console (`/master`), its sign-in (`/operator-login`), the Account page (to turn on two-step) and the sign-in service itself. Everything else, including the customers' sign-in, sign-up, dashboard and the mobile API, answers a plain 404. Opening the bare address goes to the console; signing out lands on the operator sign-in.
- **On the customer address** the console and the operator sign-in answer a plain 404, so they cannot be found or hammered through the customer site.
- **Operator sign-in** accepts only platform operators who have two-step sign-in on. Email, password and the authenticator code (or a recovery code) are asked together, and every failure shows the same message, so nothing says which part was wrong or whether an address belongs to an operator. A deleted operator or one whose operator flag was removed is refused at once.
- **Its own limits**, separate from customers': 6 attempts per email address and 12 per network address in 15 minutes. Customer traffic cannot lock an operator out, and a crowd on the master address cannot slow customers.
- **Alerts by email:** the operator and `SECURITY_ALERT_EMAIL` are told when an operator signs in from a network address not seen before, and when there are 5 failed attempts for an address within an hour (once per hour; for an address that is not an operator only `SECURITY_ALERT_EMAIL` is told). Sign-ins and the failure alarm are also written to the activity log.
- Sessions on the two addresses are separate (cookies are per address), so a customer session never opens the console.

## What this does not replace
An address that nobody knows is not a lock. To stop floods and guessing before they reach the app, also do these where the site is hosted (not in code):
- Put the site behind a firewall/CDN such as Cloudflare (rate limiting, bot blocking).
- Optionally allow the master address only from your office or VPN (Cloudflare Access, Tailscale or an IP allow-list). The code does not need to know about IP lists.
- Make sure the real visitor address reaches the app (Cloudflare sends it in `cf-connecting-ip`; otherwise set `TRUSTED_PROXY_HOPS`). The limits above count per visitor address.

## Under the hood
`src/lib/master/gate.ts` (address rules, unit-tested) is applied in `src/proxy.ts`; `src/lib/flows/operator-login.ts` (sign-in, limits, alerts; `tests/operator-login.test.ts`, 8 checks) is the `operator` sign-in provider in `src/lib/auth.ts`; the screen is `src/app/operator-login`. In production without `MASTER_HOST` the operator sign-in is switched off, so there is never a second login surface by accident.

Local testing: `MASTER_HOST=admin.localhost:3000` and open `http://admin.localhost:3000` (most browsers resolve `*.localhost` to your own machine).
