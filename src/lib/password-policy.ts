/**
 * The one definition of an acceptable password.
 *
 * The minimum was **6** and it was written out four separate times - the signup
 * form, the reset form, and both matching API routes - so raising it meant
 * finding all four, and any one missed would either reject passwords the UI had
 * promised were fine or accept ones it had refused.
 *
 * 12 follows OWASP's application-security guidance. Length is the only rule:
 * composition requirements (a digit, a symbol, mixed case) push people toward
 * `Password1!` and away from the long passphrases that are actually stronger, so
 * there is deliberately no character-class check and deliberately no maximum
 * short enough to matter - a `maxLength` on the input would silently truncate
 * whatever a password manager generated.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Why a password is unacceptable, or null when it is fine.
 *
 * Returns the message rather than a boolean so the server and the client cannot
 * describe the same rule differently.
 */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Enter a password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
