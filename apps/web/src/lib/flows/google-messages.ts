// Words shown to a person when Google sign-in did not work. Kept apart from the server code so the sign-in page can use them.

export type GoogleFailure = "unverified" | "two_step" | "deleted" | "no_company" | "busy" | "bad_profile";

/** What a person is told when Google sign-in did not work (never says whether an account exists). */
export const GOOGLE_MESSAGES: Record<GoogleFailure | "failed", string> = {
  unverified: "Google says that email address is not confirmed. Confirm it with Google, or sign in with your password.",
  two_step: "This account uses two-step sign-in. Sign in with your password and authenticator code instead.",
  deleted: "That account cannot sign in.",
  no_company: "Your company is not active right now, so you cannot sign in.",
  busy: "Too many new accounts are being created right now. Please try again in a few minutes.",
  bad_profile: "Google did not share an email address, so we cannot sign you in.",
  failed: "Google sign-in did not work. Please try again, or use your email and password.",
};
