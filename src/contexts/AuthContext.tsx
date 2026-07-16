import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  // Cache: only re-check admin role when user.id actually changes
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkAdminRole = async (userId: string): Promise<boolean> => {
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .eq("role", "admin")
          .maybeSingle();
        return !!data;
      } catch {
        return false;
      }
    };

    const applySession = async (nextSession: Session | null) => {
      const nextUserId = nextSession?.user?.id ?? null;

      // Same user as before → just refresh the session token reference, skip role re-check.
      // This avoids tree-wide rerenders + DB roundtrips on TOKEN_REFRESHED / tab focus.
      if (nextUserId && nextUserId === lastCheckedUserIdRef.current) {
        if (cancelled) return;
        setSession(nextSession);
        if (!cancelled) setLoading(false);
        return;
      }

      if (nextSession?.user) {
        const admin = await checkAdminRole(nextSession.user.id);
        if (cancelled) return;
        lastCheckedUserIdRef.current = nextSession.user.id;
        setSession(nextSession);
        setIsAdmin(admin);
      } else {
        if (cancelled) return;
        lastCheckedUserIdRef.current = null;
        setSession(null);
        setIsAdmin(false);
      }
      if (!cancelled) setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        // Filter noisy events that would otherwise rerender the whole tree
        // and resubscribe every realtime channel every few seconds:
        // - INITIAL_SESSION: handled by getSession() below
        // - TOKEN_REFRESHED: same user, no identity change
        if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
        // Fire and forget – never await inside the listener.
        void applySession(nextSession);
      }
    );

    supabase.auth.getSession()
      .then(({ data: { session: initialSession } }) => applySession(initialSession))
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
