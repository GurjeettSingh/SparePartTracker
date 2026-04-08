"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, loading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!loading && !token) {
      router.replace("/login");
    }
  }, [mounted, loading, token, router]);

  if (!mounted || loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-sm text-slate-600">Loading…</div>
      </div>
    );
  }

  if (!token) {
    return null;
  }

  return <>{children}</>;
}
