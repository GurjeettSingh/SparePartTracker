"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api";
import { useAuth, type User } from "@/components/AuthProvider";

type AuthOut = { token: string; user: User };

export default function LoginPage() {
  const router = useRouter();
  const { token, login, loading } = useAuth();

  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && token) {
      router.replace("/dashboard");
    }
  }, [loading, token, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!mobileNumber.trim() || !password) {
      setError("Mobile number and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<AuthOut>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ mobile_number: mobileNumber.trim(), password }),
      });
      login(data.token, data.user);
      router.replace("/dashboard");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Login failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Login</h1>
        <p className="mb-6 text-sm text-gray-600">Sign in to your Spare Parts Tracker account.</p>

        {error ? (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
          <label className="mb-1 block text-sm font-medium">Mobile Number</label>
          <input
            className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            autoComplete="tel"
            inputMode="tel"
            placeholder="e.g. 9876543210"
          />

          <label className="mb-1 block text-sm font-medium">Password</label>
          <input
            className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="Your password"
          />

          <button
            className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in…" : "Login"}
          </button>
        </form>

        <div className="mt-4 text-sm text-gray-600">
          Don’t have an account?{" "}
          <Link className="underline" href="/signup">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
