"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("spareparts_token");
    router.replace(token ? "/dashboard" : "/login");
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-sm text-slate-600">Loading…</div>
    </div>
  );
}
