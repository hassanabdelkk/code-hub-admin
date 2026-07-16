// Admin-UI für Fast-Track-Firmen (Vermittlungs-Profile, broker flow).
import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listPartnerCompanies,
  savePartnerCompany,
  deletePartnerCompany,
} from "@/lib/partner-companies.functions";
import { listCalendlyAccounts } from "@/lib/calendly.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Pencil, X } from "lucide-react";

export const Route = createFileRoute("/admin/partner-companies")({
  component: PartnerCompaniesPage,
});

type Row = {
  id: string;
  tenant_id: string | null;
  name: string;
  logo_url: string | null;
  calendly_url: string;
  calendly_account_id: string | null;
  portal_register_url: string | null;
  intro_headline: string | null;
  intro_subline: string | null;
  button_label: string;
  redirect_delay_ms: number;
};

const EMPTY: Omit<Row, "id"> & { id?: string } = {
  tenant_id: null,
  name: "",
  logo_url: "",
  calendly_url: "",
  calendly_account_id: null,
  portal_register_url: "",
  intro_headline: "",
  intro_subline: "",
  button_label: "Jetzt Termin buchen",
  redirect_delay_ms: 2500,
};

function PartnerCompaniesPage() {
  const list = useServerFn(listPartnerCompanies);
  const save = useServerFn(savePartnerCompany);
  const del = useServerFn(deletePartnerCompany);
  const listAccounts = useServerFn(listCalendlyAccounts);
  const { toast } = useToast();

  const q = useQuery({ queryKey: ["partner-companies"], queryFn: () => list() });
  const accQ = useQuery({ queryKey: ["calendly-accounts"], queryFn: () => listAccounts() });

  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const rows = ((q.data as any)?.rows ?? []) as Row[];
  const accounts = ((accQ.data as any)?.rows ?? []) as Array<{ id: string; display_name: string }>;

  function startEdit(r: Row) {
    setForm({
      id: r.id,
      tenant_id: r.tenant_id,
      name: r.name,
      logo_url: r.logo_url ?? "",
      calendly_url: r.calendly_url,
      calendly_account_id: r.calendly_account_id,
      portal_register_url: r.portal_register_url ?? "",
      intro_headline: r.intro_headline ?? "",
      intro_subline: r.intro_subline ?? "",
      button_label: r.button_label,
      redirect_delay_ms: r.redirect_delay_ms,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.calendly_url.trim()) {
      toast({ title: "Pflichtfelder fehlen", description: "Name und Calendly-URL sind Pflicht.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await save({ data: {
        id: form.id,
        tenant_id: form.tenant_id ?? null,
        name: form.name,
        logo_url: form.logo_url ?? "",
        calendly_url: form.calendly_url,
        calendly_account_id: form.calendly_account_id ?? null,
        portal_register_url: form.portal_register_url ?? "",
        intro_headline: form.intro_headline ?? "",
        intro_subline: form.intro_subline ?? "",
        button_label: form.button_label || "Jetzt Termin buchen",
        redirect_delay_ms: form.redirect_delay_ms ?? 2500,
      } });
      toast({ title: form.id ? "Aktualisiert" : "Fast-Track-Firma angelegt" });
      setForm(EMPTY);
      q.refetch();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Fast-Track-Firma wirklich löschen? Landings, die diese Firma referenzieren, verlieren die Zuordnung.")) return;
    await del({ data: { id } });
    toast({ title: "Gelöscht" });
    q.refetch();
  }

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fast-Track-Firmen (Vermittlung)</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Wiederverwendbare Vermittlungs-Profile für den <strong>Vermittlungs-Flow</strong> (AZB-Style):
          Bewerber sieht „Sie werden mit <em>[Firma]</em> verbunden" → bucht Termin in deren Calendly →
          Webhook setzt Status auf <code>scheduled</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {form.id ? <Pencil className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            {form.id ? "Fast-Track-Firma bearbeiten" : "Neue Fast-Track-Firma"}
          </CardTitle>
          <CardDescription>
            Diese Firma kannst du anschließend im Landing-Generator je Landing-Page auswählen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Firmenname *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Equal Experts Germany GmbH" required />
              </div>
              <div>
                <Label>Logo-URL (optional)</Label>
                <Input value={form.logo_url ?? ""} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…/logo.png" />
              </div>
              <div className="sm:col-span-2">
                <Label>Calendly-Buchungslink *</Label>
                <Input value={form.calendly_url} onChange={(e) => setForm({ ...form, calendly_url: e.target.value })} placeholder="https://calendly.com/sabine-schneider/bewerbung" required />
              </div>
              <div>
                <Label>Calendly-Account (für Webhook-Verify)</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={form.calendly_account_id ?? ""}
                  onChange={(e) => setForm({ ...form, calendly_account_id: e.target.value || null })}
                >
                  <option value="">— keiner —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.display_name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Anlegen unter <a href="/admin/calendly" className="underline">/admin/calendly</a>.
                </p>
              </div>
              <div>
                <Label>Portal-Registrierungs-URL</Label>
                <Input value={form.portal_register_url ?? ""} onChange={(e) => setForm({ ...form, portal_register_url: e.target.value })} placeholder="https://portal.digital-dgigmbh.com/register" />
                <p className="text-[10px] text-muted-foreground mt-1">Wird nach gebuchtem Termin per E-Mail an den Bewerber geschickt.</p>
              </div>
              <div>
                <Label>Loader-Delay (ms)</Label>
                <Input type="number" min={0} max={60000} step={500} value={form.redirect_delay_ms ?? 2500} onChange={(e) => setForm({ ...form, redirect_delay_ms: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <Label>Button-Label</Label>
                <Input value={form.button_label} onChange={(e) => setForm({ ...form, button_label: e.target.value })} placeholder="Jetzt Termin buchen" />
              </div>
              <div className="sm:col-span-2">
                <Label>Zwischenseiten-Headline (optional)</Label>
                <Input value={form.intro_headline ?? ""} onChange={(e) => setForm({ ...form, intro_headline: e.target.value })} placeholder="Sie werden mit [Firma] verbunden…" />
              </div>
              <div className="sm:col-span-2">
                <Label>Zwischenseiten-Subline (optional)</Label>
                <Textarea rows={2} value={form.intro_subline ?? ""} onChange={(e) => setForm({ ...form, intro_subline: e.target.value })} placeholder="Bitte wählen Sie einen Termin für das Bewerbungsgespräch." />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{form.id ? "Aktualisieren" : "Anlegen"}</Button>
              {form.id && (
                <Button type="button" variant="ghost" onClick={() => setForm(EMPTY)}>
                  <X className="h-4 w-4 mr-1" /> Abbrechen
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hinterlegte Fast-Track-Firmen ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {q.error && <p className="text-sm text-red-600">{(q.error as any)?.message ?? String(q.error)}</p>}
          {!q.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Fast-Track-Firmen angelegt.</p>
          )}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between border rounded-md p-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {r.logo_url && <img src={r.logo_url} alt="" className="h-10 w-10 object-contain rounded" />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.calendly_url}</div>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => startEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
