"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { apiFetch, ApiError } from "@/lib/api";
import { useAuth, type User } from "@/components/AuthProvider";

type AuthOut = { token: string; user: User };

export default function SignupPage() {
  const router = useRouter();
  const { token, login, loading } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [workshopName, setWorkshopName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

    if (!firstName.trim() || !lastName.trim() || !workshopName.trim() || !mobileNumber.trim()) {
      setError("First name, last name, workshop name, and mobile number are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await apiFetch<AuthOut>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          workshop_name: workshopName.trim(),
          mobile_number: mobileNumber.trim(),
          email: email.trim() ? email.trim() : null,
          password,
          confirm_password: confirmPassword,
        }),
      });
      login(data.token, data.user);
      router.replace("/dashboard");
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || e.message);
      } else {
        setError(e instanceof Error ? e.message : "Signup failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Sign up</h1>
        <p className="mb-6 text-sm text-gray-600">Create your Spare Parts Tracker account.</p>

        {error ? (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-md">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">First name</label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Last name</label>
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">Workshop name</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={workshopName}
              onChange={(e) => setWorkshopName(e.target.value)}
              autoComplete="organization"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">Mobile number</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">Email (optional)</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium">Confirm password</label>
            <input
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-sm text-gray-600">
          Already have an account?{" "}
          <Link className="underline" href="/login">
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
