"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api";

type OrderSummary = {
  id: number;
  order_name: string;
  created_at: string;
  total_items: number;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function MyOrdersPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user?.workshop_name) return;
    document.title = `Spare Parts Tracker - ${user.workshop_name}`;
  }, [user?.workshop_name]);

  useEffect(() => {
    const onClick = () => setMenuOpen(false);
    if (!menuOpen) return;
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [menuOpen]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<OrderSummary[]>("/orders");
      setOrders(data);
    } catch (e) {
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function deleteOrder(orderId: number) {
    const ok = window.confirm("Delete this order? This cannot be undone.");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<void>(`/order/${orderId}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to delete order");
    }
  }

  async function renameOrder(orderId: number, currentName: string) {
    const match = /^(.*?)(\s-\s\d{2}-\d{2}-\d{4})$/.exec(currentName.trim());
    const base = match ? match[1].trim() : currentName.trim();
    const suffix = match ? match[2] : "";

    const nextBase = window.prompt("Rename order", base);
    if (nextBase === null) return;
    const trimmed = nextBase.trim();
    if (!trimmed) return;

    const nextName = suffix ? `${trimmed}${suffix}` : trimmed;

    setError(null);
    try {
      await apiFetch(`/order/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ order_name: nextName }),
      });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to rename order");
    }
  }

  const outlineBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const outlineSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const dangerSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <RequireAuth>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <div className="bg-indigo-950">
          <div className="mx-auto max-w-4xl px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-white">
                Spare Parts Tracker
                {user?.workshop_name ? (
                  <span className="ml-2 text-sm font-medium text-indigo-100">{user.workshop_name}</span>
                ) : null}
              </div>

              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="rounded-xl border border-indigo-800 bg-indigo-900 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  Menu
                </button>

                {menuOpen ? (
                  <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                    <Link className="block px-3 py-2 text-sm hover:bg-gray-50" href="/dashboard">
                      Dashboard
                    </Link>
                    <Link className="block px-3 py-2 text-sm hover:bg-gray-50" href="/profile">
                      My Profile
                    </Link>
                    <button
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        logout();
                        router.replace("/login");
                      }}
                    >
                      Logout
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-4xl px-4 py-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold">My Orders</h1>
              <p className="text-sm text-gray-600">Open/edit or delete your saved orders.</p>
            </div>
            <button className={outlineBtn} onClick={() => void refresh()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {error ? (
            <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50">
                    <th className="px-3 py-2 font-medium">Order Name</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Total Items</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center" colSpan={4}>
                        <div className="mx-auto max-w-md rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-gray-700">
                          <div className="mb-1 text-sm font-semibold">No saved orders yet</div>
                          <div className="text-sm text-gray-600">
                            Create a draft in the dashboard and click “Save Order”.
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id} className="border-b">
                        <td className="px-3 py-2">{o.order_name}</td>
                        <td className="px-3 py-2">{fmtDate(o.created_at)}</td>
                        <td className="px-3 py-2">{o.total_items}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <Link className={outlineSmBtn} href={`/dashboard?orderId=${o.id}`}>
                              Open/Edit
                            </Link>
                            <button className={outlineSmBtn} onClick={() => void renameOrder(o.id, o.order_name)}>
                              Rename
                            </button>
                            <button className={dangerSmBtn} onClick={() => void deleteOrder(o.id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </RequireAuth>
  );
}
