"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
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

type RowActionState = {
  renaming: boolean;
  deleting: boolean;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const EMPTY_ACTION_STATE: RowActionState = { renaming: false, deleting: false };

const OrderRow = memo(function OrderRow({
  order,
  onRename,
  onDelete,
  renaming,
  deleting,
  outlineSmBtn,
  dangerSmBtn,
}: {
  order: OrderSummary;
  onRename: (orderId: number, currentName: string) => Promise<void>;
  onDelete: (orderId: number) => Promise<void>;
  renaming: boolean;
  deleting: boolean;
  outlineSmBtn: string;
  dangerSmBtn: string;
}) {
  const rowBusy = renaming || deleting;
  return (
    <tr className="border-b">
      <td className="px-3 py-2">{order.order_name}</td>
      <td className="px-3 py-2">{fmtDate(order.created_at)}</td>
      <td className="px-3 py-2">{order.total_items}</td>
      <td className="px-3 py-2">
        <div className="flex gap-2">
          <Link className={outlineSmBtn} href={`/dashboard?orderId=${order.id}`} aria-disabled={rowBusy}>
            Open/Edit
          </Link>
          <button className={outlineSmBtn} onClick={() => void onRename(order.id, order.order_name)} disabled={rowBusy}>
            {renaming ? "Renaming..." : "Rename"}
          </button>
          <button className={dangerSmBtn} onClick={() => void onDelete(order.id)} disabled={rowBusy}>
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </td>
    </tr>
  );
});

export default function MyOrdersPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionStateById, setActionStateById] = useState<Record<number, RowActionState>>({});

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

  const refresh = useCallback(async function refresh() {
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setRowActionState = useCallback((orderId: number, patch: Partial<RowActionState>) => {
    setActionStateById((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] ?? EMPTY_ACTION_STATE),
        ...patch,
      },
    }));
  }, []);

  const deleteOrder = useCallback(async (orderId: number) => {
    const rowState = actionStateById[orderId] ?? EMPTY_ACTION_STATE;
    if (rowState.deleting || rowState.renaming) return;

    const ok = window.confirm("Delete this order? This cannot be undone.");
    if (!ok) return;

    const previousOrders = orders;
    setError(null);
    setRowActionState(orderId, { deleting: true });

    // Optimistic remove to keep UI responsive.
    setOrders((prev) => prev.filter((o) => o.id !== orderId));

    try {
      await apiFetch<void>(`/order/${orderId}`, { method: "DELETE" });
    } catch (e) {
      setOrders(previousOrders);
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to delete order");
    } finally {
      setRowActionState(orderId, { deleting: false });
    }
  }, [actionStateById, orders, setRowActionState]);

  const renameOrder = useCallback(async (orderId: number, currentName: string) => {
    const rowState = actionStateById[orderId] ?? EMPTY_ACTION_STATE;
    if (rowState.deleting || rowState.renaming) return;

    const match = /^(.*?)(\s-\s\d{2}-\d{2}-\d{4})$/.exec(currentName.trim());
    const base = match ? match[1].trim() : currentName.trim();
    const suffix = match ? match[2] : "";

    const nextBase = window.prompt("Rename order", base);
    if (nextBase === null) return;
    const trimmed = nextBase.trim();
    if (!trimmed) return;

    const nextName = suffix ? `${trimmed}${suffix}` : trimmed;

    setError(null);
    setRowActionState(orderId, { renaming: true });
    const previousOrders = orders;

    // Optimistic rename so row updates immediately.
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, order_name: nextName } : o)));

    try {
      await apiFetch(`/order/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ order_name: nextName }),
      });
    } catch (e) {
      setOrders(previousOrders);
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to rename order");
    } finally {
      setRowActionState(orderId, { renaming: false });
    }
  }, [actionStateById, orders, setRowActionState]);

  const outlineBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const outlineSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const dangerSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50";

  const renderedRows = useMemo(
    () =>
      orders.map((o) => {
        const state = actionStateById[o.id] ?? EMPTY_ACTION_STATE;
        return (
          <OrderRow
            key={o.id}
            order={o}
            onRename={renameOrder}
            onDelete={deleteOrder}
            renaming={state.renaming}
            deleting={state.deleting}
            outlineSmBtn={outlineSmBtn}
            dangerSmBtn={dangerSmBtn}
          />
        );
      }),
    [orders, actionStateById, renameOrder, deleteOrder, outlineSmBtn, dangerSmBtn]
  );

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
                  ) : renderedRows}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </RequireAuth>
  );
}
