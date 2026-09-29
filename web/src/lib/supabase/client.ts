import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);
let singleton: SupabaseClient | undefined;

const sessionStorageAdapter = {
  getItem(key: string) {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
  },
  removeItem(key: string) {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
  },
};

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error("Supabase public configuration is missing.");
  singleton ??= createClient(url!, anonKey!, {
    auth: { storage: sessionStorageAdapter, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return singleton;
}
