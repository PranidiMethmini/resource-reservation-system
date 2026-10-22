"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateAuthFields } from "@/lib/auth-validation";

const inputStyle = "block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 motion-safe:transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50 disabled:text-slate-500 aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/10";
const linkStyle = "rounded font-semibold text-indigo-600 underline-offset-4 hover:text-indigo-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600";
type Field = "name" | "email" | "password" | "confirmPassword";

function PasswordField({ id, label, value, onChange, error, register = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; error?: string; register?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <input id={id} name={id} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : undefined} maxLength={register ? 128 : undefined} aria-invalid={Boolean(error)} aria-describedby={[error ? `${id}-error` : "", register && id === "password" ? "password-hint" : ""].filter(Boolean).join(" ") || undefined} className={`${inputStyle} pr-20`} placeholder={register ? "Create a password" : "Enter your password"} />
        <button type="button" onClick={() => setVisible(!visible)} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-controls={id} aria-pressed={visible} className="absolute inset-y-1 right-1 rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600">
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {register && id === "password" && <p id="password-hint" className="mt-2 text-xs leading-5 text-slate-500">Use at least 8 characters, up to 72 UTF-8 bytes. A unique password is best.</p>}
      {error && <p id={`${id}-error`} className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({ name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => router.replace("/login"), 1200);
    return () => clearTimeout(timer);
  }, [success, router]);

  function update(field: Field, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const nextErrors = validateAuthFields(mode, values);
    const email = values.email.trim();
    const name = values.name.trim();
    setErrors(nextErrors);
    setError("");
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      const field = event.currentTarget.elements.namedItem(firstError);
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }

    pending.current = true;
    setLoading(true);
    let completed = false;
    try {
      if (registering) {
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password: values.password }),
        });
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) {
            setError(response.status === 429 ? "Too many registration attempts. Please wait before trying again." : "Registration is temporarily unavailable. Please try again shortly.");
            return;
          }
          setError(response.status === 400
              ? "Please check your details and try again."
              : "We couldn’t create your account right now. Please try again shortly.");
          return;
        }
        completed = true;
        setValues({ name: "", email: "", password: "", confirmPassword: "" });
        setSuccess(true);
      } else {
        const result = await signIn("credentials", { email, password: values.password, redirect: false });
        if (result?.status === 429 || result?.status === 503) {
          setError(result.status === 429 ? "Too many sign-in attempts. Please wait before trying again." : "Sign-in is temporarily unavailable. Please try again shortly.");
          return;
        }
        if (result?.error === "CredentialsSignin") {
          setError("The email or password is incorrect. Please try again.");
          return;
        }
        if (!result?.ok || result.error) {
          setError("We couldn’t sign you in right now. Please try again shortly.");
          return;
        }
        completed = true;
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally {
      if (!completed) {
        pending.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <>
      <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-indigo-600">{registering ? "GET STARTED" : "WELCOME BACK"}</p>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{registering ? "Create your account" : "Sign in to ReserveHub"}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">{registering ? "A little less planning. A lot more getting things done." : "Your next reservation starts here. Let’s get you signed in."}</p>

      <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_12px_40px_-20px_rgba(15,23,42,0.2)] sm:p-7">
        <form onSubmit={handleSubmit} noValidate aria-busy={loading}>
          <fieldset disabled={loading} className="min-w-0 space-y-5">
            <legend className="sr-only">{registering ? "Create a ReserveHub account" : "Sign in with your email and password"}</legend>
            {registering && (
              <div>
                <label htmlFor="name" className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
                <input id="name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={values.name} onChange={(event) => update("name", event.target.value)} placeholder="Your full name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} className={inputStyle} />
                {errors.name && <p id="name-error" className="mt-2 text-xs text-red-700">{errors.name}</p>}
              </div>
            )}
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">Email address</label>
              <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={values.email} onChange={(event) => update("email", event.target.value)} placeholder="you@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} className={inputStyle} />
              {errors.email && <p id="email-error" className="mt-2 text-xs text-red-700">{errors.email}</p>}
            </div>
            <PasswordField id="password" label="Password" value={values.password} onChange={(value) => update("password", value)} error={errors.password} register={registering} />
            {registering && <PasswordField id="confirmPassword" label="Confirm password" value={values.confirmPassword} onChange={(value) => update("confirmPassword", value)} error={errors.confirmPassword} register />}
          </fieldset>

          {Object.keys(errors).some((key) => errors[key as Field]) && <p role="alert" className="mt-4 text-sm text-red-700">Please check the highlighted fields.</p>}
          {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{error}</p>}
          {success && <p role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">Registration processed. Taking you to Sign In…</p>}

          <button type="submit" disabled={loading} className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 motion-safe:transition hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-70">
            {loading && !success && <svg aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" /><path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
            {success ? "Continue to Sign In" : loading ? registering ? "Creating your account…" : "Signing you in…" : registering ? "Create Account" : "Sign In"}
            {!loading && <span aria-hidden="true">→</span>}
          </button>
        </form>
      </div>

      <p className="mt-7 text-center text-sm leading-6 text-slate-600">
        {registering ? "Already have an account?" : "New to ReserveHub?"}{" "}
        <Link href={registering ? "/login" : "/register"} className={linkStyle}>{registering ? "Sign In" : "Create an account"}</Link>
      </p>
      {registering && <p className="mt-3 text-center text-xs leading-5 text-slate-500">After creating your account, sign in to start reserving.</p>}
    </>
  );
}
