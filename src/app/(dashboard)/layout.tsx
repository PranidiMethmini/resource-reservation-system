
import Sidebar from "@/components/Sidebar";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 md:flex-row">
      <Sidebar user={{ name: session.user.name?.trim() || session.user.email }} />

      <main className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
