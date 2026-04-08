"use client";

import { Combobox } from "@headlessui/react";
import type React from "react";
import { useMemo, useState } from "react";

type Key = string | number;

export type SearchableSelectItem<T> = {
  key: Key;
  value: T;
  label: string;
  keywords?: string[];
};

export function SearchableSelect<T>(props: {
  label: string;
  items: SearchableSelectItem<T>[];
  selected: SearchableSelectItem<T> | null;
  onChange: (item: SearchableSelectItem<T> | null) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
}) {
  const {
    label,
    items,
    selected,
    onChange,
    placeholder,
    disabled,
    loading,
    required,
  } = props;

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const terms = q.split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      const label = it.label.toLowerCase();
      const keywords = (it.keywords || []).map((k) => k.toLowerCase());
      return terms.every((term) => {
        if (label.includes(term)) return true;
        return keywords.some((k) => k.includes(term));
      });
    });
  }, [items, query]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>

      <div className="flex gap-2">
        <div
          className="relative flex-1"
          onFocusCapture={() => setActive(true)}
          onBlurCapture={(e) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
              setActive(false);
              setQuery("");
            }
          }}
        >
          <Combobox
            value={selected}
            onChange={(next: SearchableSelectItem<T> | null) => {
              setQuery("");
              onChange(next);
            }}
            disabled={disabled}
          >
            <div className="relative">
              <Combobox.Input
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-gray-50"
                displayValue={(it: SearchableSelectItem<T> | null) => it?.label ?? ""}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setQuery(event.target.value)
                }
                onFocus={() => setActive(true)}
                placeholder={loading ? "Loading…" : placeholder}
              />
              <Combobox.Button
                className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-gray-500"
                aria-label={`Toggle ${label}`}
              >
                ▾
              </Combobox.Button>

              {active ? (
                <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-md">
                  {loading ? (
                    <div className="px-3 py-2 text-gray-500">Loading…</div>
                  ) : items.length === 0 ? (
                    <div className="px-3 py-2 text-gray-500">No options</div>
                  ) : filtered.length === 0 ? (
                    <div className="px-3 py-2 text-gray-500">
                      {query.trim() ? "No results found" : "Start typing to search"}
                    </div>
                  ) : (
                    filtered.map((it) => (
                      <Combobox.Option
                        key={it.key}
                        value={it}
                        className={({ active }: { active: boolean }) =>
                          `cursor-pointer px-3 py-2 ${active ? "bg-gray-100" : "bg-white"}`
                        }
                      >
                        {it.label}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              ) : null}
            </div>
          </Combobox>
        </div>

        <button
          type="button"
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setQuery("");
            onChange(null);
          }}
          disabled={disabled || !selected}
          aria-label={`Clear ${label}`}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
