"use client";

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { SearchableSelect, type SearchableSelectItem } from "@/components/SearchableSelect";
import { createInventoryItem, loadInventoryCached, updateInventoryItemById, type InventoryRow } from "@/lib/inventoryCache";
import { FALLBACK_MANUFACTURERS, FALLBACK_MODELS_BY_MANUFACTURER, FALLBACK_SPARE_PARTS } from "@/lib/fallbackData";
import { deriveKeywords, parseQuickAdd } from "@/lib/quickAdd";

type Manufacturer = { id: number; name: string };
type Model = { id: number; name: string; manufacturer_id: number };
type SparePart = { id: number; name: string; category: string };

type Toast = { kind: "success" | "error"; message: string };

const InventoryCard = memo(function InventoryCard({
  row,
  effective,
  saving,
  onChange,
  onCommit,
}: {
  row: InventoryRow;
  effective: number;
  saving: boolean;
  onChange: (next: number) => void;
  onCommit: () => void;
}) {
  const low = effective === 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-900">{row.spare_part_name}</div>
      <div className="mt-0.5 text-xs text-gray-600">
        {row.manufacturer_name} • {row.model_name}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-medium text-gray-600">Stock</div>
          <input
            className={`mt-1 w-full rounded-xl border px-3 py-2 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50 ${
              low ? "border-amber-200" : "border-gray-200"
            }`}
            type="number"
            min={0}
            value={effective}
            disabled={saving}
            onChange={(e) => onChange(Number(e.target.value))}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommit();
              }
            }}
          />
        </div>

        <div>
          <div className="text-xs font-medium text-gray-600">Last Updated</div>
          <div className="mt-2 text-sm text-gray-700">{fmtDate(row.updated_at)}</div>
          <div className="mt-1 text-xs text-gray-600">{saving ? "Saving…" : "Auto"}</div>
        </div>
      </div>
    </div>
  );
});

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function InventoryPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(50);
  const [editing, setEditing] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const [manufacturerId, setManufacturerId] = useState<number | null>(null);
  const [modelId, setModelId] = useState<number | null>(null);
  const [sparePartId, setSparePartId] = useState<number | null>(null);
  const [addStock, setAddStock] = useState<number>(0);
  const [adding, setAdding] = useState(false);

  const [quickAddText, setQuickAddText] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);

  const addFormRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        let didFallback = false;

        const mfrs = await apiFetch<Manufacturer[]>("/manufacturers").catch((e: unknown) => {
          didFallback = true;
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] manufacturers API failed, using fallback", e);
          }
          return FALLBACK_MANUFACTURERS;
        });

        const parts = await apiFetch<SparePart[]>("/spare-parts").catch((e: unknown) => {
          didFallback = true;
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] spare-parts API failed, using fallback", e);
          }
          return FALLBACK_SPARE_PARTS;
        });

        const modelsAll = await Promise.all(
          mfrs.map((m) =>
            apiFetch<Model[]>(`/models?manufacturer_id=${m.id}`).catch((e: unknown) => {
              didFallback = true;
              if (process.env.NODE_ENV !== "production") {
                console.log("[SPT] models API failed during prefetch, using fallback", e);
              }
              return FALLBACK_MODELS_BY_MANUFACTURER[m.id] || [];
            })
          )
        );

        const inv = await loadInventoryCached(true).catch((e: unknown) => {
          didFallback = true;
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] inventory API failed, using empty inventory", e);
          }
          return [];
        });

        if (cancelled) return;
        setManufacturers(mfrs);
        setSpareParts(parts);
        setAllModels(modelsAll.flat());
        setInventory(inv);

        if (didFallback) {
          showToast("error", "Failed to load some data from the API.");
        }
      } catch (e) {
        if (process.env.NODE_ENV !== "production") {
          console.log("[SPT] inventory page init failed", e);
        }
        if (e instanceof ApiError) setError(e.detail || e.message);
        else setError(e instanceof Error ? e.message : "Failed to load inventory");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadModelsForManufacturer() {
      if (!manufacturerId) {
        setModels([]);
        return;
      }
      try {
        const data = await apiFetch<Model[]>(`/models?manufacturer_id=${manufacturerId}`).catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] models API failed, using fallback", e);
          }
          return FALLBACK_MODELS_BY_MANUFACTURER[manufacturerId] || [];
        });
        if (!cancelled) setModels(data);
      } catch {
        if (!cancelled) setModels([]);
      }
    }
    setModelId(null);
    setSparePartId(null);
    void loadModelsForManufacturer();
    return () => {
      cancelled = true;
    };
  }, [manufacturerId]);

  function showToast(kind: Toast["kind"], message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 2500);
  }

  function focusAddForm() {
    const el = addFormRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      const input = el.querySelector("input") as HTMLInputElement | null;
      input?.focus();
    }, 0);
  }

  const manufacturerOptions: SearchableSelectItem<number>[] = useMemo(
    () => manufacturers.map((m) => ({ key: m.id, value: m.id, label: m.name })),
    [manufacturers]
  );
  const modelOptions: SearchableSelectItem<number>[] = useMemo(
    () => models.map((m) => ({ key: m.id, value: m.id, label: m.name })),
    [models]
  );
  const sparePartOptions: SearchableSelectItem<number>[] = useMemo(
    () => spareParts.map((p) => ({ key: p.id, value: p.id, label: p.name, keywords: deriveKeywords(p.name) })),
    [spareParts]
  );

  const selectedManufacturerOption = useMemo(
    () => (manufacturerId ? manufacturerOptions.find((o) => o.value === manufacturerId) ?? null : null),
    [manufacturerId, manufacturerOptions]
  );
  const selectedModelOption = useMemo(
    () => (modelId ? modelOptions.find((o) => o.value === modelId) ?? null : null),
    [modelId, modelOptions]
  );
  const selectedSparePartOption = useMemo(
    () => (sparePartId ? sparePartOptions.find((o) => o.value === sparePartId) ?? null : null),
    [sparePartId, sparePartOptions]
  );

  const filteredInventory = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const rows = inventory.slice().sort((a, b) => a.spare_part_name.localeCompare(b.spare_part_name));
    if (!q) return rows;
    return rows.filter((r) => `${r.manufacturer_name} ${r.model_name} ${r.spare_part_name}`.toLowerCase().includes(q));
  }, [inventory, deferredQuery]);

  useEffect(() => {
    setVisibleCount(50);
  }, [deferredQuery]);

  const visibleInventory = useMemo(() => filteredInventory.slice(0, visibleCount), [filteredInventory, visibleCount]);
  const hasMoreInventory = filteredInventory.length > visibleCount;

  async function addToInventory() {
    if (!manufacturerId || !modelId || !sparePartId) {
      setError("Select manufacturer, model, and spare part");
      return;
    }
    if (!Number.isFinite(addStock) || addStock < 0) {
      setError("Stock cannot be negative");
      return;
    }
    const mfr = manufacturers.find((m) => m.id === manufacturerId);
    const model = models.find((m) => m.id === modelId) || allModels.find((m) => m.id === modelId);
    const part = spareParts.find((p) => p.id === sparePartId);
    if (!mfr || !model || !part) {
      setError("Invalid selection");
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const payload = {
        manufacturer: mfr.name,
        model: model.name,
        spare_part: part.name,
        stock_quantity: Math.max(0, Math.floor(addStock)),
      };
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] POST /inventory payload:", payload);
      }
      const row = await createInventoryItem(payload.manufacturer, payload.model, payload.spare_part, payload.stock_quantity);
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] POST /inventory response:", row);
      }
      setInventory((prev) => {
        const idx = prev.findIndex((r) => r.id === row.id);
        if (idx >= 0) {
          return prev.map((r) => (r.id === row.id ? row : r));
        }
        return [row, ...prev];
      });
      setManufacturerId(null);
      setModelId(null);
      setSparePartId(null);
      setAddStock(0);
      showToast("success", "Item added to inventory");
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] add inventory failed", e);
      }
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to add inventory");
    } finally {
      setAdding(false);
    }
  }

  async function onQuickAdd() {
    setError(null);
    const parsed = parseQuickAdd(quickAddText, allModels.length ? allModels : models, spareParts);
    if (!parsed) {
      setError("Couldn't match a model and spare part. Try 'Swift brake pads 5'");
      return;
    }
    setQuickAdding(true);
    try {
      const mfr = manufacturers.find((m) => m.id === parsed.model.manufacturer_id);
      if (!mfr) {
        throw new Error("Could not resolve manufacturer for matched model");
      }

      const payload = { manufacturer: mfr.name, model: parsed.model.name, spare_part: parsed.sparePart.name, stock_quantity: parsed.quantity };
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] Quick Add payload:", payload);
      }
      const row = await createInventoryItem(payload.manufacturer, payload.model, payload.spare_part, payload.stock_quantity);
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] Quick Add response:", row);
      }
      setInventory((prev) => {
        const idx = prev.findIndex((r) => r.id === row.id);
        if (idx >= 0) {
          return prev.map((r) => (r.id === row.id ? row : r));
        }
        return [row, ...prev];
      });
      setQuickAddText("");
      showToast("success", "Item added to inventory");
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] quick add failed", e);
      }
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Quick Add failed");
    } finally {
      setQuickAdding(false);
    }
  }

  async function saveRow(rowId: number) {
    const next = editing[rowId];
    if (!Number.isFinite(next) || next < 0) {
      setError("Stock cannot be negative");
      return;
    }

    const current = inventory.find((r) => r.id === rowId);
    if (current && Math.max(0, Math.floor(next)) === current.stock_quantity) {
      setEditing((prev) => {
        const copy = { ...prev };
        delete copy[rowId];
        return copy;
      });
      return;
    }

    setSaving((prev) => ({ ...prev, [rowId]: true }));
    setError(null);
    try {
      const updated = await updateInventoryItemById(rowId, next);
      setInventory((prev) => prev.map((r) => (r.id === rowId ? updated : r)));
      setEditing((prev) => {
        const copy = { ...prev };
        delete copy[rowId];
        return copy;
      });
      showToast("success", "Inventory updated");
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.log("[SPT] update inventory failed", e);
      }
      if (e instanceof ApiError) setError(e.detail || e.message);
      else setError(e instanceof Error ? e.message : "Failed to update inventory");
    } finally {
      setSaving((prev) => {
        const copy = { ...prev };
        delete copy[rowId];
        return copy;
      });
    }
  }

  const outlineBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <RequireAuth>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <div className="bg-indigo-950">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-white">
                Spare Parts Tracker
                {user?.workshop_name ? <span className="ml-2 text-sm font-medium text-indigo-100">{user.workshop_name}</span> : null}
              </div>

              <div className="flex items-center gap-2">
                <Link className="text-sm font-medium text-indigo-100 underline" href="/dashboard">
                  Dashboard
                </Link>
                <button
                  className="text-sm font-medium text-indigo-100 underline"
                  onClick={() => {
                    logout();
                    router.replace("/login");
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-6">
          {toast ? (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                toast.kind === "success" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {toast.message}
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-lg font-semibold">Inventory</h1>
                <p className="text-sm text-gray-600">Adjust stock quantities for spare parts.</p>
              </div>

              <input
                className="w-full md:w-72 rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="Search inventory…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <label className="mb-1 block text-sm font-medium">Quick Add</label>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="Type e.g. brake pads 5"
                  value={quickAddText}
                  onChange={(e) => setQuickAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onQuickAdd();
                    }
                  }}
                  disabled={loading || quickAdding}
                />
                <button
                  className={outlineBtn}
                  type="button"
                  onClick={() => void onQuickAdd()}
                  disabled={loading || quickAdding || !quickAddText.trim()}
                >
                  {quickAdding ? "Adding…" : "Quick Add"}
                </button>
              </div>
            </div>

            <div ref={addFormRef} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              <SearchableSelect
                label="Manufacturer"
                items={manufacturerOptions}
                selected={selectedManufacturerOption}
                onChange={(opt) => setManufacturerId(opt?.value ?? null)}
                placeholder="Type to search…"
                disabled={loading || adding}
              />

              <SearchableSelect
                label="Model"
                items={modelOptions}
                selected={selectedModelOption}
                onChange={(opt) => setModelId(opt?.value ?? null)}
                placeholder={manufacturerId ? "Type to search…" : "Select manufacturer first"}
                disabled={loading || adding || !manufacturerId}
              />

              <SearchableSelect
                label="Spare Part"
                items={sparePartOptions}
                selected={selectedSparePartOption}
                onChange={(opt) => setSparePartId(opt?.value ?? null)}
                placeholder={modelId ? "Type to search…" : "Select model first"}
                disabled={loading || adding || !modelId}
              />

              <div>
                <label className="mb-1 block text-sm font-medium">Stock Quantity</label>
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                  type="number"
                  min={0}
                  value={addStock}
                  disabled={loading || adding}
                  onChange={(e) => setAddStock(Math.max(0, Math.floor(Number(e.target.value))))}
                />
              </div>

              <div className="flex items-end">
                <button
                  className={outlineBtn}
                  type="button"
                  onClick={() => void addToInventory()}
                  disabled={loading || adding || !manufacturerId || !modelId || !sparePartId}
                >
                  {adding ? "Adding…" : "Add to Inventory"}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="px-3 py-10">
                <div className="flex items-center justify-center gap-2 text-gray-700">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
                  <div>Loading…</div>
                </div>
              </div>
            ) : inventory.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <div className="mx-auto max-w-md rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-gray-700">
                  <div className="mb-1 text-sm font-semibold">No inventory yet</div>
                  <div className="mb-3 text-sm text-gray-600">Use “Add to Inventory” above to create your first item.</div>
                  <button className={outlineBtn} type="button" onClick={focusAddForm}>
                    Add Inventory Item
                  </button>
                </div>
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className="px-3 py-10 text-center">No matching inventory items.</div>
            ) : (
              <>
                {/* Mobile/Tablet: Cards */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
                  {visibleInventory.map((row) => {
                    const draft = editing[row.id];
                    const effective = Number.isFinite(draft) ? Math.max(0, Math.floor(draft)) : row.stock_quantity;
                    return (
                      <InventoryCard
                        key={row.id}
                        row={row}
                        effective={effective}
                        saving={!!saving[row.id]}
                        onChange={(next) => setEditing((prev) => ({ ...prev, [row.id]: next }))}
                        onCommit={() => {
                          if (row.id in editing) {
                            void saveRow(row.id);
                          }
                        }}
                      />
                    );
                  })}
                </div>

                {/* Desktop: Table */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b bg-zinc-50">
                        <th className="px-3 py-2 font-medium">Manufacturer</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Spare Part</th>
                        <th className="px-3 py-2 font-medium">Stock</th>
                        <th className="px-3 py-2 font-medium">Last Updated</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleInventory.map((row) => {
                        const draft = editing[row.id];
                        const effective = Number.isFinite(draft) ? Math.max(0, Math.floor(draft)) : row.stock_quantity;
                        const low = effective === 0;
                        return (
                          <tr key={row.id} className="border-b">
                            <td className="px-3 py-2">{row.manufacturer_name}</td>
                            <td className="px-3 py-2">{row.model_name}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.spare_part_name}</div>
                            </td>
                            <td className={`px-3 py-2 ${low ? "text-amber-800" : ""}`}>
                              <input
                                className="w-24 rounded-md border px-2 py-1"
                                type="number"
                                min={0}
                                value={effective}
                                disabled={!!saving[row.id]}
                                onChange={(e) => setEditing((prev) => ({ ...prev, [row.id]: Number(e.target.value) }))}
                                onBlur={() => {
                                  if (row.id in editing) {
                                    void saveRow(row.id);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void saveRow(row.id);
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-gray-600">{fmtDate(row.updated_at)}</td>
                            <td className="px-3 py-2">
                              {saving[row.id] ? <span className="text-xs text-gray-600">Saving…</span> : <span className="text-xs text-gray-500">Auto</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {hasMoreInventory ? (
                  <div className="mt-4 flex justify-center">
                    <button className={outlineBtn} type="button" onClick={() => setVisibleCount((v) => v + 50)}>
                      Load more
                    </button>
                  </div>
                ) : null}
              </>
            )}

            <div className="mt-4 flex justify-end">
              <Link className={outlineBtn} href="/dashboard">
                Back to Dashboard
              </Link>
            </div>
          </section>
        </div>
      </div>
    </RequireAuth>
  );
}
