import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCalendlyAccounts, saveCalendlyAccount, deleteCalendlyAccount, registerCalendlyWebhook } from "@/lib/calendly.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2, Plus, Link2 } from "lucide-react";

export const Route = createFileRoute("/admin/calendly")({
  component: AdminCalendlyPage,
});

function AdminCalendlyPage() {
  const list = useServerFn(listCalendlyAccounts);
  const save = useServerFn(saveCalendlyAccount);
  const del = useServerFn(deleteCalendlyAccount);
  const registerWebhook = useServerFn(registerCalendlyWebhook);
  const { toast } = useToast();

  const q = useQuery({ queryKey: ["calendly-accounts"], queryFn: () => list() });

  const [displayName, setDisplayName] = useState("");
  const [userUri, setUserUri] = useState("");
  const [signingKey, setSigningKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [patPerRow, setPatPerRow] = useState<Record<string, string>>({});
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ display_name: string; calendly_user_uri: string; webhook_signing_key: string }>({ display_name: "", calendly_user_uri: "", webhook_signing_key: "" });
  const [savingEdit, setSavingEdit] = useState(false);


  const portalOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${portalOrigin}/api/public/calendly-webhook`;




  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await save({ data: { display_name: displayName, calendly_user_uri: userUri, webhook_signing_key: signingKey } });
      toast({ title: "Account gespeichert" });
      setDisplayName(""); setUserUri(""); setSigningKey("");
      q.refetch();
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("Account wirklich löschen?")) return;
    await del({ data: { id } });
    toast({ title: "Gelöscht" });
    q.refetch();
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} kopiert` });
  }

  const rows = (q.data as any)?.rows ?? [];

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Calendly-Integration</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bewerbungsgespräche per Calendly buchen lassen. Pro Account einen
          Webhook in Calendly registrieren, damit gebuchte Termine automatisch
          im Portal als "Termin gebucht" auftauchen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Webhook-URL</CardTitle>
          <CardDescription>
            Diese URL trägst du in Calendly als Webhook ein (Calendly → Integrations → Webhooks → "Create Webhook Subscription").
            Events: <strong>invitee.created</strong>, <strong>invitee.canceled</strong>, <strong>invitee_no_show.created</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" />
            <Button variant="outline" onClick={() => copy(webhookUrl, "URL")}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Calendly zeigt nach dem Anlegen einen <strong>Signing Key</strong> an —
            den unten als "Webhook Signing Key" hinterlegen. Damit verifizieren
            wir, dass eingehende Webhooks wirklich von Calendly stammen.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> Account hinzufügen</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>Bezeichnung</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="z.B. Sabine Schneider" required />
            </div>
            <div>
              <Label>Calendly-User-URI (optional)</Label>
              <Input value={userUri} onChange={(e) => setUserUri(e.target.value)} placeholder="https://api.calendly.com/users/..." />
            </div>
            <div>
              <Label>Webhook Signing Key</Label>
              <div className="flex gap-2">
                <Input value={signingKey} onChange={(e) => setSigningKey(e.target.value)} placeholder="aus Calendly nach Webhook-Erstellung (oder generieren)" required type="text" className="font-mono text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const bytes = new Uint8Array(32);
                    crypto.getRandomValues(bytes);
                    const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
                    setSigningKey(key);
                    try { await navigator.clipboard.writeText(key); } catch {}
                  }}
                >
                  Generieren
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Klick auf <strong>Generieren</strong> erstellt einen 64-Zeichen Key und kopiert ihn in die Zwischenablage. Diesen Key auch beim Calendly-Webhook eintragen (als <code>signing_key</code>).
              </p>
            </div>
            <Button type="submit" disabled={saving}>Speichern</Button>
          </form>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hinterlegte Accounts ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          {q.error && <p className="text-sm text-red-600">{(q.error as any)?.message ?? String(q.error)}</p>}
          {!q.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Accounts hinterlegt.</p>
          )}
          <ul className="space-y-2">
            {rows.map((r: any) => {
              const isEditing = editingId === r.id;
              return (
              <li key={r.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs">Bezeichnung</Label>
                          <Input value={editDraft.display_name} onChange={(e) => setEditDraft((d) => ({ ...d, display_name: e.target.value }))} />
                        </div>
                        <div>
                          <Label className="text-xs">Calendly-User-URI</Label>
                          <Input value={editDraft.calendly_user_uri} onChange={(e) => setEditDraft((d) => ({ ...d, calendly_user_uri: e.target.value }))} placeholder="https://api.calendly.com/users/..." />
                        </div>
                        <div>
                          <Label className="text-xs">Webhook Signing Key</Label>
                          <Input value={editDraft.webhook_signing_key} onChange={(e) => setEditDraft((d) => ({ ...d, webhook_signing_key: e.target.value }))} className="font-mono text-xs" />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={savingEdit}
                            onClick={async () => {
                              setSavingEdit(true);
                              try {
                                await save({ data: {
                                  id: r.id,
                                  display_name: editDraft.display_name,
                                  calendly_user_uri: editDraft.calendly_user_uri,
                                  webhook_signing_key: editDraft.webhook_signing_key,
                                }});
                                toast({ title: "Gespeichert" });
                                setEditingId(null);
                                q.refetch();
                              } catch (e: any) {
                                toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
                              } finally { setSavingEdit(false); }
                            }}
                          >{savingEdit ? "Speichere…" : "Speichern"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Abbrechen</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="font-medium">{r.display_name}</div>
                        {r.calendly_user_uri
                          ? <div className="text-xs text-muted-foreground truncate">{r.calendly_user_uri}</div>
                          : <div className="text-xs text-amber-600">Noch keine User-URI — Webhook registrieren füllt sie automatisch.</div>}
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => {
                        setEditingId(r.id);
                        setEditDraft({
                          display_name: r.display_name ?? "",
                          calendly_user_uri: r.calendly_user_uri ?? "",
                          webhook_signing_key: r.webhook_signing_key ?? "",
                        });
                      }}>Bearbeiten</Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    placeholder="Calendly PAT (nur einmal nötig)"
                    type="password"
                    className="font-mono text-xs"
                    value={patPerRow[r.id] ?? ""}
                    onChange={(e) => setPatPerRow((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={registeringId === r.id}
                    onClick={async () => {
                      const token = (patPerRow[r.id] ?? "").trim();
                      if (!token) { toast({ title: "PAT eingeben", variant: "destructive" }); return; }
                      setRegisteringId(r.id);
                      try {
                        const res: any = await registerWebhook({ data: {
                          personal_access_token: token,
                          webhook_url: webhookUrl,
                          signing_key: r.webhook_signing_key,
                        }});
                        if (res?.user_uri) {
                          await save({ data: {
                            id: r.id,
                            display_name: r.display_name,
                            calendly_user_uri: res.user_uri,
                            webhook_signing_key: r.webhook_signing_key,
                          }});
                        }
                        toast({ title: "Webhook registriert ✅", description: res?.user_uri });
                        setPatPerRow((p) => ({ ...p, [r.id]: "" }));
                        q.refetch();
                      } catch (e: any) {
                        toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
                      } finally { setRegisteringId(null); }
                    }}
                  >
                    {registeringId === r.id ? "Registriere…" : "Webhook in Calendly registrieren"}
                  </Button>
                </div>
              </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendly-Link pro Landing</CardTitle>
          <CardDescription>
            Den eigentlichen Buchungs-Link (z.B. <code>https://calendly.com/sabine-schneider/bewerbung</code>) trägst du im
            <strong> Landing-Generator</strong> ein — pro Landing eigenes Event-Type möglich.
            Sobald gesetzt, leitet die Bewerbung automatisch über die
            Zwischenseite "Sie werden mit … verbunden" zu Calendly weiter.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
