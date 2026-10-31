import { signUp } from "@/lib/flows/signup";
import { apiError, json, readJson, route } from "@/lib/mobile/http";
import { clientIp } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Create a company from the app: same rules as the website. The answer is the same whether or not the address already has an account. */
export const POST = route("/api/v1/auth/signup", async (req) => {
  const r = await signUp(await readJson(req), { ip: clientIp(req.headers) });
  if (!r.ok) return apiError(400, r.field ?? "invalid_input", r.error);
  return json({ checkEmail: true });
});
