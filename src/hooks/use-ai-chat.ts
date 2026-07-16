import { useState, useCallback, useRef } from "react";

// Non-streaming: eigener TanStack-Route-Endpoint statt Supabase-Edge-Function.
// Vermeidet Cloudflare-524-Timeouts und läuft direkt auf dem Portal-Server.
const CHAT_URL = "/api/public/ai-chat";

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export function useAiChat() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (input: string) => {
    const userMsg: AiMessage = { role: "user", content: input };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setIsStreaming(true);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated }),
        signal: controller.signal,
      });

      const data = await resp.json().catch(() => ({} as any));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      let content: string = data.content ?? "";
      if (content.includes("[ESCALATE]")) {
        setEscalated(true);
        content = content.replace("[ESCALATE]", "").trim();
      }
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    } catch (e: any) {
      if (e.name !== "AbortError") {
        const msg = /429/.test(e.message)
          ? "⏳ Zu viele Anfragen. Bitte kurz warten."
          : /402/.test(e.message)
          ? "💳 AI-Kontingent aufgebraucht. Bitte Admin kontaktieren."
          : "⚠️ Der KI-Assistent ist gerade nicht erreichbar. Dein Teamleiter hilft dir gerne weiter.";
        setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setEscalated(false);
    setIsStreaming(false);
  }, []);

  return { messages, isStreaming, escalated, send, reset, setEscalated };
}
