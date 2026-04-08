"use client";

import { apiFetch } from "@/lib/api";

export type InventoryRow = {
  id: number;
  user_id: number;
  manufacturer_id: number;
  manufacturer_name: string;
  model_id: number;
  model_name: string;
  spare_part_id: number;
  spare_part_name: string;
  stock_quantity: number;
  updated_at: string;
};

let inventoryPromise: Promise<InventoryRow[]> | null = null;
let inventoryValue: InventoryRow[] | null = null;

export async function loadInventoryCached(force = false): Promise<InventoryRow[]> {
  if (!force && inventoryValue) return inventoryValue;
  if (!force && inventoryPromise) return inventoryPromise;

  inventoryPromise = apiFetch<InventoryRow[]>("/inventory").then((rows) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[SPT] /inventory response:", rows);
    }
    inventoryValue = rows;
    inventoryPromise = null;
    return rows;
  });

  return inventoryPromise;
}

export function getInventoryMapCached(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of inventoryValue || []) {
    map[makeInventoryKey(row.manufacturer_id, row.model_id, row.spare_part_id)] = row.stock_quantity;
  }
  return map;
}

export function makeInventoryKey(manufacturerId: number, modelId: number, sparePartId: number): string {
  return `${manufacturerId}:${modelId}:${sparePartId}`;
}

export function updateInventoryCache(
  manufacturerId: number,
  modelId: number,
  sparePartId: number,
  stockQuantity: number
) {
  const normalized = Math.max(0, Math.floor(stockQuantity));
  if (!inventoryValue) inventoryValue = [];

  const key = makeInventoryKey(manufacturerId, modelId, sparePartId);
  const idx = inventoryValue.findIndex((r) => makeInventoryKey(r.manufacturer_id, r.model_id, r.spare_part_id) === key);
  if (idx >= 0) {
    inventoryValue[idx] = {
      ...inventoryValue[idx],
      stock_quantity: normalized,
      updated_at: new Date().toISOString(),
    };
  }
}

export async function upsertInventory(
  manufacturerId: number,
  modelId: number,
  sparePartId: number,
  stockQuantity: number
): Promise<InventoryRow> {
  const normalized = Math.max(0, Math.floor(stockQuantity));
  const row = await apiFetch<InventoryRow>("/inventory", {
    method: "PUT",
    body: JSON.stringify({ manufacturer_id: manufacturerId, model_id: modelId, spare_part_id: sparePartId, stock_quantity: normalized }),
  });

  if (!inventoryValue) inventoryValue = [];
  const key = makeInventoryKey(row.manufacturer_id, row.model_id, row.spare_part_id);
  const idx = inventoryValue.findIndex((r) => makeInventoryKey(r.manufacturer_id, r.model_id, r.spare_part_id) === key);
  if (idx >= 0) inventoryValue[idx] = row;
  else inventoryValue = [row, ...inventoryValue];

  return row;
}

export async function createInventoryItem(
  manufacturerName: string,
  modelName: string,
  sparePartName: string,
  stockQuantity: number
): Promise<InventoryRow> {
  const normalized = Math.max(0, Math.floor(stockQuantity));
  const row = await apiFetch<InventoryRow>("/inventory", {
    method: "POST",
    body: JSON.stringify({ manufacturer: manufacturerName, model: modelName, spare_part: sparePartName, stock_quantity: normalized }),
  });

  if (!inventoryValue) inventoryValue = [];
  const key = makeInventoryKey(row.manufacturer_id, row.model_id, row.spare_part_id);
  const idx = inventoryValue.findIndex((r) => makeInventoryKey(r.manufacturer_id, r.model_id, r.spare_part_id) === key);
  if (idx >= 0) inventoryValue[idx] = row;
  else inventoryValue = [row, ...inventoryValue];

  return row;
}

export async function updateInventoryItemById(id: number, stockQuantity: number): Promise<InventoryRow> {
  const normalized = Math.max(0, Math.floor(stockQuantity));
  const row = await apiFetch<InventoryRow>(`/inventory/${id}`, {
    method: "PUT",
    body: JSON.stringify({ stock_quantity: normalized }),
  });

  if (!inventoryValue) inventoryValue = [];
  const idx = inventoryValue.findIndex((r) => r.id === row.id);
  if (idx >= 0) inventoryValue[idx] = row;
  else inventoryValue = [row, ...inventoryValue];

  return row;
}
