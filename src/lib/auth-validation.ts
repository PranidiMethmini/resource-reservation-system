import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));
const utf8Length = (value: string) => Array.from(value).reduce((length, character) => {
  const codePoint = character.codePointAt(0)!;
  return length + (codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4);
}, 0);
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.") });
export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name (2–100 characters).").max(100, "Enter your full name (2–100 characters)."),
  email: emailSchema,
  password: z.string().min(8, "Your password must contain at least 8 characters.").max(128, "Your password is too long.").refine((value) => utf8Length(value) <= 72, "Password must be at most 72 UTF-8 bytes."),
});
type AuthField = "name" | "email" | "password" | "confirmPassword";
export function validateAuthFields(mode: "login" | "register", values: Record<AuthField, string>): Partial<Record<AuthField, string>> {
  const errors: Partial<Record<AuthField, string>> = {};
  const parsed = (mode === "register" ? registerSchema : loginSchema).safeParse(values);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "email" || field === "password") && !errors[field]) errors[field] = issue.message;
  }
  if (mode === "register") {
    if (!values.confirmPassword) errors.confirmPassword = "Confirm your password.";
    else if (values.password !== values.confirmPassword) errors.confirmPassword = "Your passwords do not match.";
  }
  return errors;
}
