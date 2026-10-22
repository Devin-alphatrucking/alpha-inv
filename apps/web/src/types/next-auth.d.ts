import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "ADMIN" | "STAFF";
    /** Company the user is working in (step 2b). */
    orgId: string;
    /** Role inside that company. */
    orgRole: "ADMIN" | "STAFF";
    /** Session version at sign-in (see User.sessionVersion). */
    sv?: number;
  }

  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "STAFF";
      orgId: string;
      orgRole: "ADMIN" | "STAFF";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: "ADMIN" | "STAFF";
    orgId?: string;
    orgRole?: "ADMIN" | "STAFF";
    sv?: number;
    /** When the session was last checked against the database (ms since epoch). */
    svAt?: number;
  }
}
