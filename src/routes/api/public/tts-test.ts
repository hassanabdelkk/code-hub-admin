import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/tts-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { text, voiceId, modelId } = (await request.json()) as {
          text: string;
          voiceId?: string;
          modelId?: string;
        };
        if (!text || typeof text !== "string") {
          return new Response("text required", { status: 400 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { data, error } = await supabaseAdmin
          .from("system_settings")
          .select("elevenlabs_api_key, default_voice_id")
          .eq("id", 1)
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });

        const apiKey = (data as any)?.elevenlabs_api_key?.trim?.();
        if (!apiKey) {
          return new Response(
            "ElevenLabs API Key fehlt (Admin → AI Settings).",
            { status: 500 },
          );
        }
        const voice =
          voiceId?.trim() ||
          (data as any)?.default_voice_id?.trim?.() ||
          "EXAVITQu4vr4xnSDxMaL"; // Sarah

        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: text.slice(0, 4000),
              model_id: modelId || "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.3,
                use_speaker_boost: true,
              },
            }),
          },
        );
        if (!upstream.ok) {
          const err = await upstream.text().catch(() => "");
          return new Response(err || "elevenlabs failed", {
            status: upstream.status,
          });
        }
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
