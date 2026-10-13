import { auth } from "@/auth";
import AuthForm from "@/components/AuthForm";
import AuthShell from "@/components/AuthShell";
import { redirect } from "next/navigation";

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user?.email) redirect("/");

  return <AuthShell><AuthForm mode="register" /></AuthShell>;
}
