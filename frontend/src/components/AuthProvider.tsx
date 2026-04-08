"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";

export type User = {
  id: number;
  first_name: string;
  last_name: string;
  workshop_name: string;
  mobile_number: string;
  email?: string | null;
  created_at: string;
};

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "spareparts_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
    } catch {
      // ignore
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await apiFetch<User>("/user/profile");
      setUser(profile);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
      }
      throw e;
    }
  }, [logout]);

  // Hydrate token from localStorage on the client only.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TOKEN_KEY);
      setToken(stored);
    } catch {
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!token) return;
    refreshProfile().catch(() => {
      // handled in refreshProfile
    });
  }, [token, loading, refreshProfile]);

  const value: AuthContextValue = { token, user, loading, login, logout, refreshProfile };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
