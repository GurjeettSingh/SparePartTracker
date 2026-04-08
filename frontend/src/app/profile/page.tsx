"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api";

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout, refreshProfile } = useAuth();

  const [workshopName, setWorkshopName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    setWorkshopName(user.workshop_name ?? "");
    setEmail(user.email ?? "");
  }, [user]);

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

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!workshopName.trim()) {
      setError("Workshop name is required.");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/user/profile", {
        method: "PUT",
        body: JSON.stringify({
          workshop_name: workshopName.trim(),
          email: email.trim() ? email.trim() : null,
        }),
      });
      await refreshProfile();
      setSuccess("Profile updated");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to update profile");
      }
    } finally {
      setSaving(false);
    }
  }

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

        <div className="mx-auto max-w-4xl px-4 py-6">
          <h1 className="mb-1 text-2xl font-semibold">My Profile</h1>
          <p className="mb-6 text-sm text-gray-600">Update your workshop name and email.</p>

          {error ? (
            <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              {success}
            </div>
          ) : null}

          <form onSubmit={onSave} className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">First name</label>
                <input
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm"
                  value={user?.first_name ?? ""}
                  readOnly
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Last name</label>
                <input
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm"
                  value={user?.last_name ?? ""}
                  readOnly
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium">Mobile number</label>
              <input
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm shadow-sm"
                value={user?.mobile_number ?? ""}
                readOnly
              />
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium">Workshop name</label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={workshopName}
                onChange={(e) => setWorkshopName(e.target.value)}
              />
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="mt-5 flex gap-3">
              <button
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <Link
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
                href="/dashboard"
              >
                Back
              </Link>
            </div>
          </form>
        </div>
      </div>
    </RequireAuth>
  );
}
