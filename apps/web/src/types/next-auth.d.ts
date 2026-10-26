import type { DefaultSession } from "next-auth";
import type { RoleName } from "@/lib/roles";

declare module "next-auth" {
  interface User {
    role: RoleName;
    /** Company the user is working in (step 2b). */
    orgId: string;
    /** Role inside that company. */
    orgRole: RoleName;
    /** Session version at sign-in (see User.sessionVersion). */
    sv?: number;
  }

  interface Session {
    user: {
      id: string;
      role: RoleName;
      orgId: string;
      orgRole: RoleName;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: RoleName;
    orgId?: string;
    orgRole?: RoleName;
    sv?: number;
    /** When the session was last checked against the database (ms since epoch). */
    svAt?: number;
  }
}
