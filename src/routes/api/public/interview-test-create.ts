// Testendpoint: legt eine Dummy-Bewerbung an, damit Admin das Interview
// (Chat oder Voice) aus Bewerber-Sicht testen kann. Nur zum internen Testen.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/interview-test-create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            firstName?: string;
            lastName?: string;
            email?: string;
          };
          const firstName = (body.firstName || "Test").trim();
          const lastName = (body.lastName || "Bewerber").trim();
          const email =
            (body.email || `test+${Date.now()}@example.com`).trim();

          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );
          const { data: tenant, error: tErr } = await supabaseAdmin
            .from("tenants")
            .select("id")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (tErr || !tenant) {
            return new Response(
              JSON.stringify({ error: "Kein Tenant vorhanden" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const id = crypto.randomUUID();
          const { error } = await supabaseAdmin.from("applications").insert({
            id,
            full_name: `${firstName} ${lastName}`.trim(),
            first_name: firstName,
            last_name: lastName,
            email,
            tenant_id: (tenant as any).id,
            status: "neu",
            flow_type: "classic",
            is_test: true,
            booking_status: "none",
          } as any);
          if (error) {
            return new Response(
              JSON.stringify({ error: error.message }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ ok: true, id }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          return new Response(
            JSON.stringify({ error: e?.message || "unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
