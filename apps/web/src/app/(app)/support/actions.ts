"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/permissions";
import { createTicket } from "@/lib/flows/support";

// The person and the company come from the signed session, never from the browser.
export async function createTicketAction(input: { subject: string; message: string }) {
  const user = await requireUser();
  const result = await createTicket({ id: user.id, name: user.name || user.email || "A customer", email: user.email || "", orgId: user.orgId }, input);
  if (result.ok) revalidatePath("/support");
  return result;
}
