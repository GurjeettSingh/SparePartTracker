export type Manufacturer = { id: number; name: string };
export type Model = { id: number; name: string; manufacturer_id: number };
export type SparePart = { id: number; name: string; category: string };

export const FALLBACK_MANUFACTURERS: Manufacturer[] = [
  { id: 1, name: "Maruti Suzuki" },
  { id: 2, name: "Hyundai" },
  { id: 3, name: "Tata" },
];

export const FALLBACK_MODELS_BY_MANUFACTURER: Record<number, Model[]> = {
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

export const FALLBACK_SPARE_PARTS: SparePart[] = [
  { id: 1, name: "Oil Filter", category: "Filters" },
  { id: 2, name: "Air Filter", category: "Filters" },
  { id: 3, name: "Brake Pads", category: "Brakes" },
  { id: 4, name: "Spark Plug", category: "Engine" },
];
