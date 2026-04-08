"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { API_BASE_URL, ApiError, apiFetch, downloadFile, getAuthHeaders } from "@/lib/api";
import { SearchableSelect, type SearchableSelectItem } from "@/components/SearchableSelect";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { getInventoryMapCached, loadInventoryCached, makeInventoryKey, upsertInventory } from "@/lib/inventoryCache";
import { deriveKeywords, parseQuickAdd } from "@/lib/quickAdd";

type Manufacturer = { id: number; name: string };
type Model = { id: number; name: string; manufacturer_id: number };
type SparePart = { id: number; name: string; category: string };

type OrderSummary = {
  id: number;
  order_name: string;
  created_at: string;
  total_items: number;
  status?: "Draft" | "Purchased";
  supplier_name?: string | null;
};

type SavedOrder = {
  id: number;
  order_name: string | null;
  status: "Draft" | "Purchased";
  supplier_name?: string | null;
  created_at: string;
  items: OrderItem[];
};

type OrderItem = {
  id: number;
  order_id: number;
  manufacturer_id: number;
  manufacturer_name: string;
  model_id: number;
  model_name: string;
  spare_part_id: number;
  spare_part_name: string;
  spare_part_category?: string;
  quantity: number;
  available_stock: number;
  to_purchase: number;
  typical_specification?: string | null;
  oem_part_number?: string | null;
};

type DraftItem = {
  key: string;
  manufacturer_id: number;
  manufacturer_name: string;
  model_id: number;
  model_name: string;
  spare_part_id: number;
  spare_part_name: string;
  quantity: number;
  available_stock: number;
};

type Toast = { kind: "success" | "error"; message: string };

type RecentItem = {
  manufacturer_id: number;
  manufacturer_name: string;
  model_id: number;
  model_name: string;
  spare_part_id: number;
  spare_part_name: string;
};

type DraftOrderStorage = {
  version: 1;
  manufacturer_id: number | null;
  model_id: number | null;
  spare_part_id: number | null;
  quantity: number;
  builder_available_stock: number;
  items: DraftItem[];
  updated_at: string;
};

function fmtDDMMYYYY(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}-${mm}-${yyyy}`;
}

function withDateSuffix(name: string) {
  const trimmed = name.trim();
  const today = fmtDDMMYYYY(new Date());
  if (!trimmed) return `Order - ${today}`;
  if (/\s-\s\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
  return `${trimmed} - ${today}`;
}

function safeDownloadFilename(base: string, ext: "pdf" | "xlsx") {
  const cleaned = (base || "order").replace(/[\\/:*?"<>|\n\r\t]/g, "_").trim() || "order";
  const withoutExt = cleaned.replace(/\.(pdf|xlsx)$/i, "");
  return `${withoutExt}.${ext}`;
}

const DRAFT_STORAGE_KEY = "draft_order";
const RECENT_ITEMS_KEY = "recent_items";

const FALLBACK_MANUFACTURERS: Manufacturer[] = [
  { id: 1, name: "Maruti Suzuki" },
  { id: 2, name: "Hyundai" },
  { id: 3, name: "Tata" },
];

const FALLBACK_MODELS_BY_MANUFACTURER: Record<number, Model[]> = {
  1: [
    { id: 101, name: "Swift", manufacturer_id: 1 },
    { id: 102, name: "Baleno", manufacturer_id: 1 },
  ],
  2: [
    { id: 201, name: "i20", manufacturer_id: 2 },
    { id: 202, name: "Creta", manufacturer_id: 2 },
  ],
  3: [
    { id: 301, name: "Nexon", manufacturer_id: 3 },
    { id: 302, name: "Punch", manufacturer_id: 3 },
  ],
};

const FALLBACK_SPARE_PARTS: SparePart[] = [
  { id: 1, name: "Oil Filter", category: "Filters" },
  { id: 2, name: "Air Filter", category: "Filters" },
  { id: 3, name: "Brake Pads", category: "Brakes" },
  { id: 4, name: "Spark Plug", category: "Engine" },
];

const CATEGORY_ORDER: Array<"Filters" | "Engine" | "Brakes" | "Transmission" | "Others"> = [
  "Filters",
  "Engine",
  "Brakes",
  "Transmission",
  "Others",
];

function calcToPurchase(requiredQty: number, availableStock: number): number {
  if (!Number.isFinite(requiredQty) || requiredQty <= 0) return 0;
  if (!Number.isFinite(availableStock) || availableStock <= 0) return requiredQty;
  return Math.max(0, requiredQty - availableStock);
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <div className="h-9 w-9 rounded-full bg-indigo-700 text-white flex items-center justify-center text-sm font-semibold">
      {initials || "U"}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [allModels, setAllModels] = useState<Model[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);

  const [manufacturerId, setManufacturerId] = useState<number | null>(null);
  const [modelId, setModelId] = useState<number | null>(null);
  const [sparePartId, setSparePartId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);

  const [currentOrder, setCurrentOrder] = useState<SavedOrder | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);

  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [recentReady, setRecentReady] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const suppressCascadeResetsRef = useRef(false);
  const [repeatingLastOrder, setRepeatingLastOrder] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  const [editingItemId, setEditingItemId] = useState<number | string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState<number>(1);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);

  const [quickAddText, setQuickAddText] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);

  const [supplierName, setSupplierName] = useState("");
  const [markingPurchased, setMarkingPurchased] = useState(false);
  const [savingStockById, setSavingStockById] = useState<Record<number, boolean>>({});
  const [addToInventoryOnPurchase, setAddToInventoryOnPurchase] = useState(false);

  const [inventoryMap, setInventoryMap] = useState<Record<string, number>>({});
  const [builderAvailableStock, setBuilderAvailableStock] = useState<number>(0);

  const [menuOpen, setMenuOpen] = useState(false);

  const isSavedOrder = currentOrder !== null;
  const canSelectModel = manufacturerId !== null;
  const canSelectPart = modelId !== null;

  const currentItems: Array<OrderItem | DraftItem> = isSavedOrder ? currentOrder.items : draftItems;

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

  function suppressCascadeResetsNextTick() {
    suppressCascadeResetsRef.current = true;
    window.setTimeout(() => {
      suppressCascadeResetsRef.current = false;
    }, 50);
  }

  function clearDraftStorage() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    // Load recently used items from localStorage.
    try {
      const raw = localStorage.getItem(RECENT_ITEMS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .filter(Boolean)
            .slice(0, 10)
            .map((x) => x as RecentItem)
            .filter((x) =>
              typeof x.manufacturer_id === "number" &&
              typeof x.model_id === "number" &&
              typeof x.spare_part_id === "number" &&
              typeof x.manufacturer_name === "string" &&
              typeof x.model_name === "string" &&
              typeof x.spare_part_name === "string"
            );
          setRecentItems(cleaned);
        }
      }
    } catch {
      // ignore
    } finally {
      setRecentReady(true);
    }
  }, []);

  function clearDraft() {
    let hadDraft = false;
    try {
      hadDraft = !!localStorage.getItem(DRAFT_STORAGE_KEY);
    } catch {
      hadDraft = false;
    }
    if (!hadDraft) return;

    clearDraftStorage();
    suppressCascadeResetsNextTick();
    setCurrentOrder(null);
    setDraftItems([]);
    setManufacturerId(null);
    setModelId(null);
    setSparePartId(null);
    setQuantity(1);
    setBuilderAvailableStock(0);
    setSupplierName("");
    setAddToInventoryOnPurchase(false);
    showToast("success", "Draft cleared");
  }

  function startNewOrder() {
    clearDraftStorage();
    suppressCascadeResetsNextTick();
    setCurrentOrder(null);
    setDraftItems([]);
    setManufacturerId(null);
    setModelId(null);
    setSparePartId(null);
    setQuantity(1);
    setBuilderAvailableStock(0);
    setSupplierName("");
    setAddToInventoryOnPurchase(false);
    try {
      if (window.location.search) {
        router.replace("/dashboard");
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    // Auto-save draft to localStorage (debounced).
    if (!draftReady) return;
    if (isSavedOrder) return;

    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      const hasAny =
        !!manufacturerId ||
        !!modelId ||
        !!sparePartId ||
        draftItems.length > 0 ||
        (Number.isFinite(quantity) && quantity !== 1) ||
        (Number.isFinite(builderAvailableStock) && builderAvailableStock !== 0);

      if (!hasAny) {
        clearDraftStorage();
        return;
      }

      const payload: DraftOrderStorage = {
        version: 1,
        manufacturer_id: manufacturerId,
        model_id: modelId,
        spare_part_id: sparePartId,
        quantity: Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1,
        builder_available_stock: Number.isFinite(builderAvailableStock) ? Math.max(0, Math.floor(builderAvailableStock)) : 0,
        items: draftItems,
        updated_at: new Date().toISOString(),
      };

      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }
    }, 500);

    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [draftReady, isSavedOrder, manufacturerId, modelId, sparePartId, quantity, builderAvailableStock, draftItems]);

  function pushRecentItem(next: RecentItem) {
    setRecentItems((prev) => {
      const key = `${next.manufacturer_id}:${next.model_id}:${next.spare_part_id}`;
      const deduped = prev.filter((it) => `${it.manufacturer_id}:${it.model_id}:${it.spare_part_id}` !== key);
      return [next, ...deduped].slice(0, 10);
    });
  }

  useEffect(() => {
    if (!recentReady) return;
    try {
      localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(recentItems.slice(0, 10)));
    } catch {
      // ignore
    }
  }, [recentItems, recentReady]);

  useEffect(() => {
    // Restore draft from localStorage.
    const params = new URLSearchParams(window.location.search);
    if (params.get("orderId")) {
      setDraftReady(true);
      return;
    }

    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) {
        setDraftReady(true);
        return;
      }
      const parsed = JSON.parse(raw) as DraftOrderStorage;
      if (!parsed || parsed.version !== 1) {
        setDraftReady(true);
        return;
      }

      const restoredItems = Array.isArray(parsed.items)
        ? parsed.items
            .filter(Boolean)
            .map((it) => ({
              ...it,
              key: typeof it.key === "string" && it.key ? it.key : crypto.randomUUID(),
              quantity: Number.isFinite(it.quantity) ? Math.max(0, Math.floor(it.quantity)) : 0,
              available_stock: Number.isFinite(it.available_stock) ? Math.max(0, Math.floor(it.available_stock)) : 0,
            }))
        : [];

      suppressCascadeResetsNextTick();
      setManufacturerId(parsed.manufacturer_id ?? null);
      setModelId(parsed.model_id ?? null);
      setSparePartId(parsed.spare_part_id ?? null);
      setQuantity(Number.isFinite(parsed.quantity) ? Math.max(1, Math.floor(parsed.quantity)) : 1);
      setBuilderAvailableStock(
        Number.isFinite(parsed.builder_available_stock) ? Math.max(0, Math.floor(parsed.builder_available_stock)) : 0
      );
      setDraftItems(restoredItems);
    } catch {
      // ignore
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      setUsingFallback(false);
      try {
        let showApiWarning = false;

        const mfrs = await apiFetch<Manufacturer[]>("/manufacturers").catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] manufacturers API failed, using fallback", e);
          }
          return FALLBACK_MANUFACTURERS;
        });

        const parts = await apiFetch<SparePart[]>("/spare-parts").catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] spare-parts API failed, using fallback", e);
          }
          return FALLBACK_SPARE_PARTS;
        });

        const savedOrders = await apiFetch<OrderSummary[]>("/orders").catch((e: unknown) => {
          showApiWarning = true;
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] orders API failed, showing empty list", e);
          }
          return [];
        });

        const all = await Promise.all(
          mfrs.map((m) =>
            apiFetch<Model[]>(`/models?manufacturer_id=${m.id}`).catch((e: unknown) => {
              if (process.env.NODE_ENV !== "production") {
                console.log("[SPT] models API failed during prefetch, using fallback", e);
              }
              return FALLBACK_MODELS_BY_MANUFACTURER[m.id] || [];
            })
          )
        );
        const flatModels = all.flat();

        await loadInventoryCached().catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] inventory API failed, using empty inventory", e);
          }
          return [];
        });

        if (cancelled) return;
        setManufacturers(mfrs);
        setSpareParts(parts);
        setOrders(savedOrders);
        setAllModels(flatModels);
        setInventoryMap(getInventoryMapCached());

        if (showApiWarning) {
          setUsingFallback(true);
          showToast("error", "Failed to load some data from the API.");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to initialize");
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
    const id = new URLSearchParams(window.location.search).get("orderId");
    if (!id) return;
    const orderId = Number(id);
    if (!Number.isFinite(orderId) || orderId <= 0) return;
    void openOrder(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      if (manufacturerId === null) {
        setModels([]);
        return;
      }
      setLoadingModels(true);
      setError(null);
      try {
        const data = await apiFetch<Model[]>(`/models?manufacturer_id=${manufacturerId}`).catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.log("[SPT] models API failed, using fallback", e);
          }
          setUsingFallback(true);
          showToast("error", "Failed to load models. Using fallback.");
          return FALLBACK_MODELS_BY_MANUFACTURER[manufacturerId] || [];
        });
        if (cancelled) return;
        setModels(data);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load models");
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }

    if (!suppressCascadeResetsRef.current) {
      setModelId(null);
      setSparePartId(null);
    }
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [manufacturerId]);

  useEffect(() => {
    if (suppressCascadeResetsRef.current) return;
    setSparePartId(null);
  }, [modelId]);

  useEffect(() => {
    if (!manufacturerId || !modelId || !sparePartId) {
      setBuilderAvailableStock(0);
      return;
    }
    const key = makeInventoryKey(manufacturerId, modelId, sparePartId);
    setBuilderAvailableStock(inventoryMap[key] ?? 0);
  }, [manufacturerId, modelId, sparePartId, inventoryMap]);

  const manufacturerOptions: SearchableSelectItem<number>[] = useMemo(
    () => manufacturers.map((m) => ({ key: m.id, value: m.id, label: m.name })),
    [manufacturers]
  );
  const modelOptions: SearchableSelectItem<number>[] = useMemo(
    () => models.map((m) => ({ key: m.id, value: m.id, label: m.name })),
    [models]
  );
  const sparePartOptions: SearchableSelectItem<number>[] = useMemo(
    () =>
      spareParts.map((p) => ({
        key: p.id,
        value: p.id,
        label: p.name,
        keywords: deriveKeywords(p.name),
      })),
    [spareParts]
  );

  const selectedManufacturerOption = useMemo(
    () => (manufacturerId ? manufacturerOptions.find((it) => it.key === manufacturerId) ?? null : null),
    [manufacturerId, manufacturerOptions]
  );
  const selectedModelOption = useMemo(
    () => (modelId ? modelOptions.find((it) => it.key === modelId) ?? null : null),
    [modelId, modelOptions]
  );
  const selectedPartOption = useMemo(
    () => (sparePartId ? sparePartOptions.find((it) => it.key === sparePartId) ?? null : null),
    [sparePartId, sparePartOptions]
  );

  const selectedManufacturer = useMemo(
    () => (manufacturerId ? manufacturers.find((m) => m.id === manufacturerId) ?? null : null),
    [manufacturers, manufacturerId]
  );
  const selectedModel = useMemo(
    () => (modelId ? models.find((m) => m.id === modelId) ?? null : null),
    [models, modelId]
  );
  const selectedPart = useMemo(
    () => (sparePartId ? spareParts.find((p) => p.id === sparePartId) ?? null : null),
    [spareParts, sparePartId]
  );

  function parseQuickAddInput(input: string): { model: Model; part: SparePart; quantity: number } | null {
    const modelsToSearch = allModels.length ? allModels : models;
    const parsed = parseQuickAdd(input, modelsToSearch, spareParts);
    if (!parsed) return null;
    return { model: parsed.model as Model, part: parsed.sparePart as SparePart, quantity: parsed.quantity };
  }

  async function addItemByIds(args: {
    manufacturer_id: number;
    model_id: number;
    spare_part_id: number;
    quantity: number;
    available_stock?: number;
    manufacturer_name: string;
    model_name: string;
    spare_part_name: string;
  }) {
    if (!isSavedOrder) {
      setDraftItems((prev) => {
        const existing = prev.find((it) => it.model_id === args.model_id && it.spare_part_id === args.spare_part_id);
        if (existing) {
          return prev.map((it) => (it.key === existing.key ? { ...it, quantity: it.quantity + args.quantity } : it));
        }
        return [
          {
            key: crypto.randomUUID(),
            manufacturer_id: args.manufacturer_id,
            manufacturer_name: args.manufacturer_name,
            model_id: args.model_id,
            model_name: args.model_name,
            spare_part_id: args.spare_part_id,
            spare_part_name: args.spare_part_name,
            quantity: args.quantity,
            available_stock: Math.max(0, Math.floor(args.available_stock ?? 0)),
          },
          ...prev,
        ];
      });

      pushRecentItem({
        manufacturer_id: args.manufacturer_id,
        manufacturer_name: args.manufacturer_name,
        model_id: args.model_id,
        model_name: args.model_name,
        spare_part_id: args.spare_part_id,
        spare_part_name: args.spare_part_name,
      });
      return;
    }

    const existing = currentOrder.items.find((it) => it.model_id === args.model_id && it.spare_part_id === args.spare_part_id);
    const newItem = existing
      ? await apiFetch<OrderItem>(`/order-item/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity: existing.quantity + args.quantity }),
        })
      : await apiFetch<OrderItem>("/order-item", {
          method: "POST",
          body: JSON.stringify({
            order_id: currentOrder.id,
            manufacturer_id: args.manufacturer_id,
            model_id: args.model_id,
            spare_part_id: args.spare_part_id,
            quantity: args.quantity,
            available_stock: Math.max(0, Math.floor(args.available_stock ?? 0)),
          }),
        });

    setCurrentOrder((prev) => {
      if (!prev) return prev;
      const exists = prev.items.find((it) => it.id === newItem.id);
      const nextItems = exists ? prev.items.map((it) => (it.id === newItem.id ? newItem : it)) : [newItem, ...prev.items];
      return { ...prev, items: nextItems };
    });

    pushRecentItem({
      manufacturer_id: args.manufacturer_id,
      manufacturer_name: args.manufacturer_name,
      model_id: args.model_id,
      model_name: args.model_name,
      spare_part_id: args.spare_part_id,
      spare_part_name: args.spare_part_name,
    });
    await refreshOrders();
  }

  async function onQuickAdd() {
    setError(null);
    const parsed = parseQuickAddInput(quickAddText);
    if (!parsed) {
      setError("Couldn't match a model and spare part. Try 'Swift brake pads 2'");
      return;
    }

    const manufacturer = manufacturers.find((m) => m.id === parsed.model.manufacturer_id);
    if (!manufacturer) {
      setError("Could not understand input. Try 'Swift brake pads 2'");
      return;
    }

    setQuickAdding(true);
    try {
      await addItemByIds({
        manufacturer_id: manufacturer.id,
        manufacturer_name: manufacturer.name,
        model_id: parsed.model.id,
        model_name: parsed.model.name,
        spare_part_id: parsed.part.id,
        spare_part_name: parsed.part.name,
        quantity: parsed.quantity,
        available_stock: inventoryMap[makeInventoryKey(manufacturer.id, parsed.model.id, parsed.part.id)] ?? 0,
      });
      setQuickAddText("");
      showToast("success", "Item added");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Quick Add failed");
      }
    } finally {
      setQuickAdding(false);
    }
  }

  function showToast(kind: Toast["kind"], message: string) {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 2500);
  }

  async function refreshOrders() {
    const savedOrders = await apiFetch<OrderSummary[]>("/orders");
    setOrders(savedOrders);
  }

  async function openOrder(orderId: number) {
    setError(null);
    setLoading(true);
    try {
      const order = await apiFetch<SavedOrder>(`/order/${orderId}`);
      setCurrentOrder(order);
      setSupplierName(order.supplier_name ?? "");
      setDraftItems([]);
      showToast("success", `Opened: ${order.order_name ?? `Order ${order.id}`}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open order");
    } finally {
      setLoading(false);
    }
  }

  function updateDraftStock(key: string, next: number) {
    const normalized = Math.max(0, Number.isFinite(next) ? Math.floor(next) : 0);
    setDraftItems((prev) => prev.map((it) => (it.key === key ? { ...it, available_stock: normalized } : it)));
  }

  function updateSavedStockLocal(itemId: number, next: number) {
    const normalized = Math.max(0, Number.isFinite(next) ? Math.floor(next) : 0);
    setCurrentOrder((prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.map((it) => (it.id === itemId ? { ...it, available_stock: normalized } : it)) };
    });
  }

  async function persistInventoryForPart(manufacturerId: number, modelId: number, sparePartId: number, stockQuantity: number) {
    const normalized = Math.max(0, Math.floor(stockQuantity));
    await upsertInventory(manufacturerId, modelId, sparePartId, normalized);
    setInventoryMap(getInventoryMapCached());
  }

  async function persistSavedStock(itemId: number) {
    if (!isSavedOrder) return;
    const item = currentOrder.items.find((it) => it.id === itemId);
    if (!item) return;
    setSavingStockById((prev) => ({ ...prev, [itemId]: true }));
    try {
      const updated = await apiFetch<OrderItem>(`/order-item/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ available_stock: item.available_stock }),
      });
      setCurrentOrder((prev) => (prev ? { ...prev, items: prev.items.map((it) => (it.id === itemId ? updated : it)) } : prev));
      await persistInventoryForPart(updated.manufacturer_id, updated.model_id, updated.spare_part_id, updated.available_stock);
      showToast("success", "Stock updated");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to update stock");
      }
    } finally {
      setSavingStockById((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
    }
  }

  async function renameOrder(orderId: number, currentName: string) {
    const next = window.prompt("Enter new order name", currentName);
    if (!next) return;
    setError(null);
    try {
      await apiFetch(`/order/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ order_name: next }),
      });
      await refreshOrders();
      if (currentOrder?.id === orderId) {
        setCurrentOrder({ ...currentOrder, order_name: next });
      }
      showToast("success", "Order renamed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename order");
    }
  }

  async function deleteOrder(orderId: number) {
    const ok = window.confirm("Delete this order? This cannot be undone.");
    if (!ok) return;
    setError(null);
    try {
      await apiFetch<void>(`/order/${orderId}`, { method: "DELETE" });
      await refreshOrders();
      if (currentOrder?.id === orderId) {
        setCurrentOrder(null);
        setDraftItems([]);
      }
      showToast("success", "Order deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete order");
    }
  }

  async function handleAddItem() {
    setError(null);
    if (!selectedManufacturer || !selectedModel || !selectedPart) {
      setError("Please select manufacturer, model, and spare part.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }

    if (!Number.isFinite(builderAvailableStock) || builderAvailableStock < 0) {
      setError("Stock cannot be negative.");
      return;
    }

    if (!isSavedOrder) {
      setDraftItems((prev) => {
        const existing = prev.find((it) => it.model_id === selectedModel.id && it.spare_part_id === selectedPart.id);
        if (existing) {
          return prev.map((it) => (it.key === existing.key ? { ...it, quantity: it.quantity + quantity } : it));
        }
        return [
          {
            key: crypto.randomUUID(),
            manufacturer_id: selectedManufacturer.id,
            manufacturer_name: selectedManufacturer.name,
            model_id: selectedModel.id,
            model_name: selectedModel.name,
            spare_part_id: selectedPart.id,
            spare_part_name: selectedPart.name,
            quantity,
            available_stock: Math.max(0, Math.floor(builderAvailableStock)),
          },
          ...prev,
        ];
      });

      pushRecentItem({
        manufacturer_id: selectedManufacturer.id,
        manufacturer_name: selectedManufacturer.name,
        model_id: selectedModel.id,
        model_name: selectedModel.name,
        spare_part_id: selectedPart.id,
        spare_part_name: selectedPart.name,
      });
      setSparePartId(null);
      setQuantity(1);
      setBuilderAvailableStock(0);
      showToast("success", "Item added");
      return;
    }

    setSavingItem(true);
    try {
      const newItem = await apiFetch<OrderItem>("/order-item", {
        method: "POST",
        body: JSON.stringify({
          order_id: currentOrder.id,
          manufacturer_id: selectedManufacturer.id,
          model_id: selectedModel.id,
          spare_part_id: selectedPart.id,
          quantity,
          available_stock: Math.max(0, Math.floor(builderAvailableStock)),
        }),
      });

      setCurrentOrder((prev) => {
        if (!prev) return prev;
        const exists = prev.items.find((it) => it.id === newItem.id);
        const nextItems = exists ? prev.items.map((it) => (it.id === newItem.id ? newItem : it)) : [newItem, ...prev.items];
        return { ...prev, items: nextItems };
      });

      pushRecentItem({
        manufacturer_id: selectedManufacturer.id,
        manufacturer_name: selectedManufacturer.name,
        model_id: selectedModel.id,
        model_name: selectedModel.name,
        spare_part_id: selectedPart.id,
        spare_part_name: selectedPart.name,
      });

      setSparePartId(null);
      setQuantity(1);
      setBuilderAvailableStock(0);
      showToast("success", "Item saved");
      await refreshOrders();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to add item");
      }
    } finally {
      setSavingItem(false);
    }
  }

  async function repeatLastOrder() {
    setError(null);
    setRepeatingLastOrder(true);
    try {
      const latest = await apiFetch<SavedOrder>("/orders/latest");

      startNewOrder();
      setDraftItems(
        latest.items.map((it) => ({
          key: crypto.randomUUID(),
          manufacturer_id: it.manufacturer_id,
          manufacturer_name: it.manufacturer_name,
          model_id: it.model_id,
          model_name: it.model_name,
          spare_part_id: it.spare_part_id,
          spare_part_name: it.spare_part_name,
          quantity: it.quantity,
          available_stock: Math.max(0, Math.floor(it.available_stock ?? 0)),
        }))
      );
      showToast("success", "Last order loaded");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        showToast("error", "No previous order found");
      } else if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load last order");
      }
    } finally {
      setRepeatingLastOrder(false);
    }
  }

  function startEdit(item: OrderItem | DraftItem) {
    setEditingItemId("id" in item ? item.id : item.key);
    setEditingQuantity(item.quantity);
  }

  function cancelEdit() {
    setEditingItemId(null);
    setEditingQuantity(1);
  }

  async function saveEdit(item: OrderItem | DraftItem) {
    setError(null);
    if (!Number.isFinite(editingQuantity) || editingQuantity <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }

    if (!isSavedOrder || !("id" in item)) {
      const key = "key" in item ? item.key : null;
      if (!key) return;
      setDraftItems((prev) => prev.map((it) => (it.key === key ? { ...it, quantity: editingQuantity } : it)));
      cancelEdit();
      showToast("success", "Quantity updated");
      return;
    }

    try {
      const updated = await apiFetch<OrderItem>(`/order-item/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ quantity: editingQuantity }),
        }
      );
      setCurrentOrder((prev) => (prev ? { ...prev, items: prev.items.map((it) => (it.id === item.id ? updated : it)) } : prev));
      cancelEdit();
      showToast("success", "Quantity updated");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update item");
    }
  }

  async function handleDeleteItem(item: OrderItem | DraftItem) {
    setError(null);
    if (!isSavedOrder || !("id" in item)) {
      const key = "key" in item ? item.key : null;
      if (!key) return;
      setDraftItems((prev) => prev.filter((it) => it.key !== key));
      showToast("success", "Item removed");
      return;
    }

    try {
      await apiFetch<void>(`/order-item/${item.id}`, { method: "DELETE" });
      setCurrentOrder((prev) => (prev ? { ...prev, items: prev.items.filter((it) => it.id !== item.id) } : prev));
      await refreshOrders();
      showToast("success", "Item deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete item");
    }
  }

  async function saveOrder() {
    if (isSavedOrder) {
      setError("This order is already saved.");
      return;
    }
    if (draftItems.length === 0) {
      setError("Add at least one item before saving.");
      return;
    }

    const nameInput = window.prompt("Enter order name (optional)", "");
    if (nameInput === null) return;
    const name = withDateSuffix(nameInput);

    setSavingOrder(true);
    setError(null);
    try {
      const order = await apiFetch<{ id: number; order_name: string | null; created_at: string }>("/order", {
        method: "POST",
        body: JSON.stringify({
          order_name: name,
          items: draftItems.map((it) => ({
            manufacturer_id: it.manufacturer_id,
            model_id: it.model_id,
            spare_part_id: it.spare_part_id,
            quantity: it.quantity,
            available_stock: it.available_stock,
          })),
        }),
      });
      const full = await apiFetch<SavedOrder>(`/order/${order.id}`);
      setCurrentOrder(full);
      setDraftItems([]);
      clearDraftStorage();
      await refreshOrders();
      showToast("success", "Order saved");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to save order");
      }
    } finally {
      setSavingOrder(false);
    }
  }

  async function exportOrder(kind: "pdf" | "excel") {
    if (!isSavedOrder) {
      setError("Save the order before exporting.");
      return;
    }
    setError(null);
    setExporting(kind);
    try {
      const baseName = currentOrder.order_name ?? `Order ${currentOrder.id}`;
      if (kind === "pdf") {
        await downloadFile(`/export/pdf/${currentOrder.id}`, safeDownloadFilename(baseName, "pdf"));
      } else {
        await downloadFile(`/export/excel/${currentOrder.id}`, safeDownloadFilename(baseName, "xlsx"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  }

  async function markAsPurchased() {
    if (!isSavedOrder) {
      setError("Save the order before marking as purchased.");
      return;
    }
    setError(null);
    setMarkingPurchased(true);
    try {
      const updated = await apiFetch<{ id: number; order_name: string | null; created_at: string; status: "Draft" | "Purchased"; supplier_name?: string | null }>(
        `/order/${currentOrder.id}/purchase`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: "Purchased",
            supplier_name: supplierName.trim() ? supplierName.trim() : null,
          }),
        }
      );

      if (addToInventoryOnPurchase) {
        for (const it of currentOrder.items) {
          const requiredQty = Number.isFinite(it.quantity) ? Math.max(0, Math.floor(it.quantity)) : 0;
          const baseline =
            inventoryMap[makeInventoryKey(it.manufacturer_id, it.model_id, it.spare_part_id)] ?? Math.max(0, Math.floor(it.available_stock ?? 0));
          const delta = calcToPurchase(requiredQty, baseline);
          if (delta > 0) {
            await persistInventoryForPart(it.manufacturer_id, it.model_id, it.spare_part_id, baseline + delta);
          }
        }
      }
      setCurrentOrder((prev) =>
        prev
          ? {
              ...prev,
              status: updated.status,
              supplier_name: updated.supplier_name ?? null,
            }
          : prev
      );
      await refreshOrders();
      showToast("success", "Marked as purchased");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to mark as purchased");
      }
    } finally {
      setMarkingPurchased(false);
    }
  }

  async function importOrder() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Select a .xlsx or .json file to import.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE_URL}/import-order`, {
        method: "POST",
        body: form,
        headers: {
          ...getAuthHeaders(),
        },
      });
      if (!res.ok) {
        const data = (await res.json()) as { detail?: unknown };
        const detail = Array.isArray(data.detail) ? data.detail.join("\n") : String(data.detail || "Import failed");
        throw new Error(detail);
      }
      const data = (await res.json()) as { items: Array<Omit<DraftItem, "key">> };
      setCurrentOrder(null);
      setSupplierName("");
      setDraftItems(
        data.items.map((it) => ({
          key: crypto.randomUUID(),
          ...it,
          available_stock: Math.max(0, Math.floor(it.available_stock ?? 0)),
        }))
      );
      showToast("success", "Imported into draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
      setImportFileName(null);
    }
  }

  const totalQty = useMemo(
    () => currentItems.reduce((sum, it) => sum + (Number.isFinite(it.quantity) ? it.quantity : 0), 0),
    [currentItems]
  );

  const summary = useMemo(() => {
    const byCategory: Record<string, { items: number; requiredQty: number; toPurchase: number }> = {};

    let totalRequiredQty = 0;
    let totalToPurchase = 0;

    for (const it of currentItems) {
      const key = "id" in it ? it.id : it.key;
      const effectiveQty = editingItemId === key ? editingQuantity : it.quantity;
      const stock = "available_stock" in it ? (it.available_stock ?? 0) : 0;

      const sparePart = spareParts.find((p) => p.id === it.spare_part_id);
      const category = ("spare_part_category" in it && it.spare_part_category) || sparePart?.category || "Others";

      const requiredQty = Number.isFinite(effectiveQty) ? Math.max(0, Math.floor(effectiveQty)) : 0;
      const availableStock = Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
      const toPurchase = calcToPurchase(requiredQty, availableStock);

      totalRequiredQty += requiredQty;
      totalToPurchase += toPurchase;

      if (!byCategory[category]) byCategory[category] = { items: 0, requiredQty: 0, toPurchase: 0 };
      byCategory[category].items += 1;
      byCategory[category].requiredQty += requiredQty;
      byCategory[category].toPurchase += toPurchase;
    }

    const orderedCategories = CATEGORY_ORDER.filter((c) => (byCategory[c]?.items ?? 0) > 0);
    const categoryRows = orderedCategories.map((c) => ({ category: c, ...byCategory[c] }));

    return {
      totalItems: currentItems.length,
      totalRequiredQty,
      totalToPurchase,
      categories: categoryRows,
    };
  }, [currentItems, editingItemId, editingQuantity, spareParts]);

  const primaryBtn =
    "inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryBtn =
    "inline-flex items-center justify-center rounded-xl bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const outlineBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const primarySmBtn =
    "inline-flex items-center justify-center rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const outlineSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";
  const dangerSmBtn =
    "inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <RequireAuth>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <div className="bg-indigo-950">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-3">
                <div className="text-lg font-semibold text-white">
                  Spare Parts Tracker
                  {user?.workshop_name ? (
                    <span className="ml-2 text-sm font-medium text-indigo-100">{user.workshop_name}</span>
                  ) : null}
                </div>
                
              </div>

              <div className="flex items-center gap-3">

                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Profile menu"
                  >
                    <Avatar name={`${user?.first_name ?? "User"} ${user?.last_name ?? ""}`.trim()} />
                  </button>

                  {menuOpen ? (
                    <div className="absolute right-0 mt-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                      <Link className="block px-3 py-2 text-sm hover:bg-gray-50" href="/profile">
                        My Profile
                      </Link>
                      <Link className="block px-3 py-2 text-sm hover:bg-gray-50" href="/my-orders">
                        My Orders
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
        </div>

        <div className="mx-auto max-w-6xl px-4 py-6">
          {toast ? (
            <div
              className={`mb-4 rounded-lg border px-3 py-2 text-sm ${
                toast.kind === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {toast.message}
            </div>
          ) : null}

          {usingFallback ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Failed to load some data from the API. Using fallback data.
            </div>
          ) : null}

          {error ? (
            <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-md">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Order Builder</h2>
                  <p className="text-sm text-gray-600">
                    {isSavedOrder
                      ? `${currentOrder.order_name ?? `Order ${currentOrder.id}`} • ${fmtDate(currentOrder.created_at)}`
                      : "Draft (not saved yet)"}
                  </p>
                  {isSavedOrder ? (
                    <div className="mt-1 text-sm">
                      <span className="text-gray-600">Status: </span>
                      <span className={currentOrder.status === "Purchased" ? "font-semibold text-green-700" : "font-semibold text-gray-900"}>
                        {currentOrder.status}
                      </span>
                      {currentOrder.supplier_name ? <span className="text-gray-600"> • Supplier: {currentOrder.supplier_name}</span> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    className={outlineSmBtn}
                    type="button"
                    onClick={() => void repeatLastOrder()}
                    disabled={loading || repeatingLastOrder}
                    title="Load the most recent saved order"
                  >
                    {repeatingLastOrder ? "Loading…" : "Repeat Last Order"}
                  </button>

                  <button
                    className={outlineSmBtn}
                    type="button"
                    onClick={() => {
                      startNewOrder();
                      showToast("success", "Started new order");
                    }}
                    disabled={loading}
                    title="Clear current state and start fresh"
                  >
                    Start New Order
                  </button>

                  {!isSavedOrder ? (
                    <button
                      className={dangerSmBtn}
                      type="button"
                      onClick={() => clearDraft()}
                      disabled={loading}
                      title="Remove the saved draft from this browser"
                    >
                      Clear Draft
                    </button>
                  ) : null}

                  <button
                    className={primaryBtn}
                    onClick={() => void handleAddItem()}
                    disabled={loading || savingItem || !selectedManufacturer || !selectedModel || !selectedPart || quantity <= 0}
                  >
                    {savingItem ? "Saving…" : "Add Item"}
                  </button>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <label className="mb-1 block text-sm font-medium">Quick Add</label>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    placeholder="Type e.g. Swift brake pads 2"
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
                    className={primaryBtn}
                    type="button"
                    onClick={() => void onQuickAdd()}
                    disabled={loading || quickAdding || !quickAddText.trim()}
                  >
                    {quickAdding ? "Adding…" : "Quick Add"}
                  </button>
                </div>
              </div>

              {recentReady && recentItems.length ? (
                <div className="mb-4">
                  <div className="mb-2 text-sm font-medium text-gray-700">Recently Used</div>
                  <div className="flex flex-wrap gap-2">
                    {recentItems.slice(0, 10).map((it) => (
                      <button
                        key={`${it.manufacturer_id}:${it.model_id}:${it.spare_part_id}`}
                        type="button"
                        className={outlineSmBtn}
                        onClick={() => {
                          suppressCascadeResetsNextTick();
                          setManufacturerId(it.manufacturer_id);
                          setModelId(it.model_id);
                          setSparePartId(it.spare_part_id);
                          setQuantity(1);
                          setBuilderAvailableStock(
                            inventoryMap[makeInventoryKey(it.manufacturer_id, it.model_id, it.spare_part_id)] ?? 0
                          );
                        }}
                        title={`${it.manufacturer_name} / ${it.model_name} / ${it.spare_part_name}`}
                      >
                        {it.model_name} • {it.spare_part_name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <SearchableSelect
                  label="Manufacturer"
                  items={manufacturerOptions}
                  selected={selectedManufacturerOption}
                  onChange={(opt) => setManufacturerId(opt?.value ?? null)}
                  placeholder="Type to search…"
                  disabled={loading}
                  required
                />

                <SearchableSelect
                  label="Model"
                  items={modelOptions}
                  selected={selectedModelOption}
                  onChange={(opt) => setModelId(opt?.value ?? null)}
                  placeholder={canSelectModel ? "Type to search…" : "Select manufacturer first"}
                  disabled={!canSelectModel || loadingModels}
                  loading={loadingModels}
                  required
                />

                <SearchableSelect
                  label="Spare Part"
                  items={sparePartOptions}
                  selected={selectedPartOption}
                  onChange={(opt) => setSparePartId(opt?.value ?? null)}
                  placeholder={canSelectPart ? "Type to search…" : "Select model first"}
                  disabled={!canSelectPart}
                  required
                />

                <div>
                  <label className="mb-1 block text-sm font-medium">Quantity</label>
                  <input
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                    type="number"
                    min={1}
                    value={quantity}
                    disabled={!selectedPart}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium">Available Stock</label>
                  <input
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                    type="number"
                    min={0}
                    value={builderAvailableStock}
                    disabled={!selectedPart}
                    onChange={(e) => setBuilderAvailableStock(Math.max(0, Math.floor(Number(e.target.value))))}
                  />
                </div>
              </div>

              <div className="mt-4 text-sm text-gray-600">
                {selectedManufacturer && selectedModel && selectedPart ? (
                  <span>
                    Adding: <span className="font-medium">{selectedManufacturer.name}</span> /{" "}
                    <span className="font-medium">{selectedModel.name}</span> /{" "}
                    <span className="font-medium">{selectedPart.name}</span>
                  </span>
                ) : (
                  <span>Select all fields to add an item.</span>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
              <div className="mb-3">
                <h2 className="text-lg font-semibold">Actions</h2>
                <p className="text-sm text-gray-600">Exports include: Required Qty, Stock, To Purchase</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button className={secondaryBtn} onClick={() => void saveOrder()} disabled={savingOrder || loading || isSavedOrder}>
                  {savingOrder ? "Saving…" : "Save Order"}
                </button>
                <button className={outlineBtn} onClick={() => void exportOrder("pdf")} disabled={!isSavedOrder || exporting !== null}>
                  {exporting === "pdf" ? "Downloading…" : "PDF"}
                </button>
                <button className={outlineBtn} onClick={() => void exportOrder("excel")} disabled={!isSavedOrder || exporting !== null}>
                  {exporting === "excel" ? "Downloading…" : "Excel"}
                </button>

                <button
                  className={secondaryBtn}
                  onClick={() => void markAsPurchased()}
                  disabled={!isSavedOrder || markingPurchased || currentOrder?.status === "Purchased"}
                >
                  {currentOrder?.status === "Purchased" ? "Purchased" : markingPurchased ? "Marking…" : "Mark as Purchased"}
                </button>

                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  <input
                    id="addToInventoryOnPurchase"
                    type="checkbox"
                    checked={addToInventoryOnPurchase}
                    onChange={(e) => setAddToInventoryOnPurchase(e.target.checked)}
                    disabled={!isSavedOrder || currentOrder?.status === "Purchased"}
                  />
                  <label htmlFor="addToInventoryOnPurchase" className="text-gray-700">
                    Add to inventory
                  </label>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.json"
                  className="hidden"
                  onChange={() => setImportFileName(fileRef.current?.files?.[0]?.name ?? null)}
                />
                <button className={outlineBtn} type="button" onClick={() => fileRef.current?.click()}>
                  Choose File
                </button>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium">Supplier Name (optional)</label>
                <input
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="e.g. Local Parts Store"
                  disabled={!isSavedOrder || currentOrder?.status === "Purchased"}
                />
              </div>

              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {importFileName ? <span className="truncate">{importFileName} selected</span> : <span className="text-gray-500">No import file selected</span>}
              </div>

              <button className={`${secondaryBtn} mt-3 w-full`} onClick={() => void importOrder()} disabled={importing || !importFileName}>
                {importing ? "Importing…" : "Import Order"}
              </button>

              <div className="mt-3 text-sm text-gray-600">
                <Link className="underline" href="/my-orders">
                  View My Orders
                </Link>
                <span className="mx-2 text-gray-400">•</span>
                <Link className="underline" href="/inventory">
                  Inventory
                </Link>
              </div>
            </section>
          </div>

          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Items</h2>
                <p className="text-sm text-gray-600">
                  {currentItems.length} items • Total qty {totalQty}
                </p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium text-gray-500">Total Items</div>
                <div className="text-lg font-semibold">{summary.totalItems}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium text-gray-500">Total Required Quantity</div>
                <div className="text-lg font-semibold">{summary.totalRequiredQty}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-xs font-medium text-gray-500">Total To Purchase</div>
                <div className={`text-lg font-semibold ${summary.totalToPurchase > 0 ? "text-red-700" : "text-green-700"}`}>
                  {summary.totalToPurchase}
                </div>
              </div>
            </div>

            {summary.categories.length > 0 ? (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white">
                <div className="border-b bg-zinc-50 px-3 py-2 text-sm font-medium">By Category</div>
                <div className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-2">
                  {summary.categories.map((c) => (
                    <div key={c.category} className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
                      <div className="font-medium">{c.category}</div>
                      <div className="text-gray-700">
                        Items {c.items} • To Purchase{" "}
                        <span className={c.toPurchase > 0 ? "font-semibold text-red-700" : "font-semibold text-green-700"}>
                          {c.toPurchase}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b bg-zinc-50">
                    <th className="px-3 py-2 font-medium">Manufacturer</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Spare Part</th>
                    <th className="px-3 py-2 font-medium">Required Qty</th>
                    <th className="px-3 py-2 font-medium">Stock</th>
                    <th className="px-3 py-2 font-medium">To Purchase</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentItems.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center" colSpan={7}>
                        <div className="mx-auto max-w-md rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-gray-700">
                          <div className="mb-1 text-sm font-semibold">No items added yet</div>
                          <div className="text-sm text-gray-600">Start by selecting a manufacturer, model, and spare part.</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    CATEGORY_ORDER.flatMap((category) => {
                      const itemsInCategory = currentItems
                        .filter((it) => {
                          const sparePart = spareParts.find((p) => p.id === it.spare_part_id);
                          const cat = ("spare_part_category" in it && it.spare_part_category) || sparePart?.category || "Others";
                          return cat === category;
                        })
                        .slice()
                        .sort((a, b) =>
                          `${a.manufacturer_name}/${a.model_name}/${a.spare_part_name}`.localeCompare(
                            `${b.manufacturer_name}/${b.model_name}/${b.spare_part_name}`
                          )
                        );

                      if (itemsInCategory.length === 0) return [];

                      return [
                        (
                          <tr key={`cat-${category}`} className="border-b bg-gray-50">
                            <td className="px-3 py-2 text-xs font-semibold text-gray-700" colSpan={7}>
                              {category}
                            </td>
                          </tr>
                        ),
                        ...itemsInCategory.map((item) => {
                          const rowKey = "id" in item ? item.id : item.key;
                          const isEditing = editingItemId === rowKey;
                          const effectiveQty = isEditing ? editingQuantity : item.quantity;
                          const stock = "available_stock" in item ? (item.available_stock ?? 0) : 0;
                          const requiredQty = Number.isFinite(effectiveQty) ? Math.max(0, Math.floor(effectiveQty)) : 0;
                          const availableStock = Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0;
                          const toPurchase = calcToPurchase(requiredQty, availableStock);

                          return (
                            <tr key={String(rowKey)} className="border-b">
                              <td className="px-3 py-2">{item.manufacturer_name}</td>
                              <td className="px-3 py-2">{item.model_name}</td>
                              <td className="px-3 py-2">{item.spare_part_name}</td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <input
                                    className="w-20 rounded-md border px-2 py-1"
                                    type="number"
                                    min={1}
                                    value={editingQuantity}
                                    onChange={(e) => setEditingQuantity(Number(e.target.value))}
                                  />
                                ) : (
                                  <span>{item.quantity}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {"id" in item ? (
                                  <input
                                    className="w-20 rounded-md border px-2 py-1"
                                    type="number"
                                    min={0}
                                    value={availableStock}
                                    disabled={!!savingStockById[item.id]}
                                    onChange={(e) => updateSavedStockLocal(item.id, Number(e.target.value))}
                                    onBlur={() => void persistSavedStock(item.id)}
                                  />
                                ) : (
                                  <input
                                    className="w-20 rounded-md border px-2 py-1"
                                    type="number"
                                    min={0}
                                    value={availableStock}
                                    onChange={(e) => updateDraftStock(item.key, Number(e.target.value))}
                                    onBlur={() =>
                                      void (async () => {
                                        try {
                                          await persistInventoryForPart(item.manufacturer_id, item.model_id, item.spare_part_id, availableStock);
                                          showToast("success", "Stock updated");
                                        } catch (e) {
                                          if (e instanceof ApiError) {
                                            setError(e.detail || e.message);
                                          } else {
                                            setError(e instanceof Error ? e.message : "Failed to update inventory");
                                          }
                                        }
                                      })()
                                    }
                                  />
                                )}
                              </td>
                              <td className={`px-3 py-2 font-semibold ${toPurchase > 0 ? "text-red-700" : "text-green-700"}`}>
                                {toPurchase}
                              </td>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <div className="flex gap-2">
                                    <button className={primarySmBtn} onClick={() => void saveEdit(item)}>
                                      Save
                                    </button>
                                    <button className={outlineSmBtn} onClick={cancelEdit}>
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex gap-2">
                                    <button className={outlineSmBtn} onClick={() => startEdit(item)}>
                                      Edit
                                    </button>
                                    <button className={dangerSmBtn} onClick={() => void handleDeleteItem(item)}>
                                      Delete
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        }),
                      ];
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Saved Orders</h2>
                <p className="text-sm text-gray-600">Open, rename, or delete saved orders.</p>
              </div>
              <button className={outlineBtn} onClick={() => void refreshOrders()} disabled={loading}>
                Refresh
              </button>
            </div>

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
                          <div className="text-sm text-gray-600">Create a draft and click “Save Order”.</div>
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
                            <button className={outlineSmBtn} onClick={() => void openOrder(o.id)}>
                              Open/Edit
                            </button>
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
