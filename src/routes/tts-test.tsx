import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";

export const Route = createFileRoute("/tts-test")({
  component: TtsTest,
  head: () => ({
    meta: [{ title: "TTS Test" }, { name: "robots", content: "noindex" }],
  }),
});

const VOICES: Array<{ id: string; label: string }> = [
  { id: "", label: "Standard (aus AI Settings)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (weiblich, warm)" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda (weiblich, freundlich)" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice (weiblich, klar)" },
  { id: "FGY2WhTYpPnrIDTdsKH5", label: "Laura (weiblich)" },
  { id: "cgSgspJ2msm6clMCkdW9", label: "Jessica (weiblich)" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George (männlich)" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (männlich)" },
];

function TtsTest() {
  const [text, setText] = useState(
    "Hallo, hier spricht Sabine Schneider vom Personal-Team. Schön, dass Sie sich bei uns beworben haben.",
  );
  const [voice, setVoice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/tts-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: voice }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8 flex justify-center">
      <div className="w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">TTS Test</h1>
        <p className="text-sm text-muted-foreground">
          Text eingeben → KI spricht (Lovable AI Gateway, OpenAI gpt-4o-mini-tts).
        </p>
        <textarea
          className="w-full min-h-[160px] rounded-md border border-input bg-background p-3 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <label className="text-sm">Stimme:</label>
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            onClick={speak}
            disabled={loading || !text.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {loading ? "Generiere…" : "Sprechen"}
          </button>
        </div>
        <audio ref={audioRef} controls className="w-full" />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
