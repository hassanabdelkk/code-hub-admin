import { createFileRoute } from "@tanstack/react-router";
import { pollAnosimSmsInternal } from "@/lib/sms-poll.functions";

// Pollt Anosim-SMS und schreibt sie in sms_messages.
// Aufruf alle 30 s via Cron auf VPS 2:
//   * * * * * curl -fsS "https://portal.../api/public/sms-poll-cron?key=<CRON_SECRET>" >/dev/null
//   * * * * * sleep 30; curl -fsS "https://portal.../api/public/sms-poll-cron?key=<CRON_SECRET>" >/dev/null

export const Route = createFileRoute("/api/public/sms-poll-cron")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        const expected = process.env.CRON_SECRET;
        if (!expected || key !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const result = await pollAnosimSmsInternal();
          return Response.json({ ok: true, ...result });
        } catch (e: any) {
          return Response.json(
            { ok: false, error: String(e?.message ?? e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
