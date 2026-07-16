import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { updateLastSeen } from "@/lib/presence.functions";

/**
 * Modul-globaler Store für die Menge an aktuell online User-IDs.
 * Wird vom Broadcast-Channel befüllt und von useOnlineUsers gelesen.
 * So vermeiden wir, denselben Realtime-Channel zweimal zu abonnieren
 * (Supabase verbietet .on() nach subscribe() auf derselben Instanz).
 */
let currentOnline: Set<string> = new Set();
const listeners = new Set<(s: Set<string>) => void>();

function setOnlineGlobal(next: Set<string>) {
  currentOnline = next;
  listeners.forEach((l) => l(next));
}

/**
 * Mountet einen globalen Realtime-Presence-Channel und einen DB-Heartbeat
 * (profiles.last_seen_at). Einmal pro App-Session im Root mounten.
 */
export function usePresenceBroadcast() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    try {
      // Eindeutiger Topic pro Mount, damit StrictMode / re-mount nicht
      // dieselbe (bereits subscribte) Channel-Instanz zurückbekommt
      // ("cannot add 'presence' callbacks after 'subscribe()'").
      const topic = `online-users:${user.id}:${Math.random().toString(36).slice(2, 8)}`;
      channel = supabase.channel(topic, {
        config: { presence: { key: user.id } },
      });

      const sync = () => {
        if (!channel) return;
        try {
          const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
          const ids = new Set<string>();
          for (const key of Object.keys(state)) {
            if (key.startsWith("viewer-")) continue;
            ids.add(key);
            for (const meta of state[key] ?? []) {
              if (meta?.user_id) ids.add(meta.user_id);
            }
          }
          setOnlineGlobal(ids);
        } catch {
          /* noop */
        }
      };

      channel
        .on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe(async (status) => {
          if (cancelled || !channel) return;
          if (status === "SUBSCRIBED") {
            try {
              await channel.track({ user_id: user.id, online_at: new Date().toISOString() });
            } catch {}
          }
        });
    } catch (err) {
      // Realtime nicht verfügbar (z. B. self-hosted ohne Realtime / 400) —
      // App darf deswegen nicht crashen.
      console.warn("[presence] realtime channel setup failed", err);
    }

    // DB-Heartbeat (last_seen_at) alle 60s
    const beat = async () => {
      try {
        await updateLastSeen({ data: undefined as any });
      } catch {}
    };
    beat();
    const iv = window.setInterval(beat, 60_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) {
        try { channel.untrack(); } catch {}
        try { supabase.removeChannel(channel); } catch {}
      }
      setOnlineGlobal(new Set());
    };
  }, [user?.id]);
}

/**
 * Hook für Admin-Views: liefert ein Set mit aktuell online User-IDs.
 * Liest aus dem geteilten Store, den usePresenceBroadcast befüllt.
 */
export function useOnlineUsers(): Set<string> {
  const [online, setOnline] = useState<Set<string>>(currentOnline);

  useEffect(() => {
    const l = (s: Set<string>) => setOnline(s);
    listeners.add(l);
    setOnline(currentOnline);
    return () => { listeners.delete(l); };
  }, []);

  return online;
}
