// Interne Test-Seite: legt eine Dummy-Bewerbung an und öffnet
// Chat- oder Voice-Interview aus Bewerber-Sicht.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/interview-test")({
  component: InterviewTest,
  head: () => ({
    meta: [
      { title: "Interview testen" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function InterviewTest() {
  const [firstName, setFirstName] = useState("Max");
  const [lastName, setLastName] = useState("Muster");
  const [email, setEmail] = useState(`test+${Date.now()}@example.com`);
  const [loading, setLoading] = useState<null | "chat" | "voice">(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (mode: "chat" | "voice") => {
    setLoading(mode);
    setError(null);
    try {
      const res = await fetch("/api/public/interview-test-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const data = await res.json();
      if (!res.ok || !data?.id) {
        throw new Error(data?.error || `Fehler ${res.status}`);
      }
      const path =
        mode === "voice"
          ? `/interview/voice/${data.id}`
          : `/interview/${data.id}`;
      window.location.href = path;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8 flex justify-center">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Bewerbungsgespräch testen</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Erzeugt eine Test-Bewerbung (<code>is_test=true</code>) und öffnet
            das KI-Gespräch aus Sicht des Bewerbers. Termin- und
            Geschäftszeiten-Gate werden für Test-Bewerbungen umgangen.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Vorname</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Nachname</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">E-Mail</label>
            <input
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => start("chat")}
            disabled={loading !== null}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading === "chat" ? "Starte…" : "KI-Chat starten"}
          </button>
          <button
            onClick={() => start("voice")}
            disabled={loading !== null}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading === "voice" ? "Starte…" : "KI-Telefon starten"}
          </button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
