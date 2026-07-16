import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/chat")({
  component: AdminChatPage,
});

import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useChatNotifications } from "@/hooks/use-chat-notifications";
import { Send, Bot, UserCheck, Search, MessageCircle, Building2, EyeOff, ChevronRight, MailOpen, StickyNote, AlertCircle, Lock, Pencil, Trash2, Check, X, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLastSignIns } from "@/lib/last-sign-ins.functions";
import { useOnlineUsers } from "@/hooks/use-presence";
import { useSearchParams } from "@/lib/router-compat";
import { useNavigate } from "@/lib/router-compat";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ChatAttachmentButton, AttachmentPreview, type ChatAttachment } from "@/components/ChatAttachmentButton";

interface Conversation {
  user_id: string;
  full_name: string;
  status: string;
  escalated_at: string | null;
  unread: number;
  lastMessage?: string;
  lastAt?: string;
  lastSignInAt?: string | null;
  lastSeenAt?: string | null;
  tenantName?: string | null;
  tenantId?: string | null;
  adminUnread?: boolean;
  adminNote?: string | null;
  lastFromEmployeeAt?: string | null;
  hiddenAt?: string | null;
}

const UNANSWERED_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4h
const isUnanswered = (c: Conversation) =>
  !!c.lastFromEmployeeAt &&
  Date.now() - new Date(c.lastFromEmployeeAt).getTime() > UNANSWERED_THRESHOLD_MS;

interface ChatMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  read: boolean;
  created_at: string;
  is_ai?: boolean;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
}

function AdminChatPage() {
  const { user } = useAuth();
  const onlineUsers = useOnlineUsers();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterTab] = useState<"all" | "escalated" | "open">("all");
  const [viewTab, setViewTab] = useState<"active" | "hidden">("active");
  const [tenantFilter, setTenantFilter] = useState<string>("all"); // tenant_id oder "all"
  const [hiding, setHiding] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingChannelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Browser-Notification + Sound + Tab-Title-Blink
  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + (c.unread || 0), 0),
    [conversations]
  );
  const { trigger: notifyChat, requestPermission } = useChatNotifications({
    unread: totalUnread,
    enabled: true,
  });
  useEffect(() => { requestPermission(); }, [requestPermission]);

  // Optional: ?user=<id> aus URL übernehmen (Deep-Link aus Mitarbeiter-Detail)
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const u = searchParams.get("user");
    if (u) setSelectedUserId(u);
  }, [searchParams]);

  useEffect(() => {
    if (!user) return;
    loadConversations();
  }, [user]);

  const loadConversations = async () => {
    const [profilesRes, convsRes, msgsRes, tenantsRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, tenant_id"),
      supabase.from("chat_conversations").select("user_id, status, escalated_at, admin_hidden_at, admin_unread, admin_note"),
      supabase
        .from("chat_messages")
        .select("sender_id, receiver_id, message, read, created_at")
        .or(`sender_id.eq.${user!.id},receiver_id.eq.${user!.id}`)
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("tenants").select("id, name"),
    ]);

    const profiles = profilesRes.data ?? [];
    if (!profiles.length) { setLoading(false); return; }
    const tenantMap = new Map<string, string>(((tenantsRes.data ?? []) as any[]).map((t) => [t.id, t.name]));
    const profileMap = new Map(profiles.map((p: any) => [p.user_id, { name: p.full_name as string, tenant_id: p.tenant_id as string | null }]));
    const convMap = new Map<string, any>((convsRes.data ?? []).map((c: any) => [c.user_id, c]));

    type Agg = { lastMessage: string; lastAt: string; unread: number; lastFromEmployeeAt: string | null };
    const agg = new Map<string, Agg>();
    // msgs are ordered DESC → first entry per partner is the newest
    for (const m of (msgsRes.data ?? []) as any[]) {
      const partnerId = m.sender_id === user!.id ? m.receiver_id : m.sender_id;
      if (!profileMap.has(partnerId)) continue;
      let entry = agg.get(partnerId);
      if (!entry) {
        entry = {
          lastMessage: m.message,
          lastAt: m.created_at,
          unread: 0,
          lastFromEmployeeAt: m.sender_id === partnerId ? m.created_at : null,
        };
        agg.set(partnerId, entry);
      }
      if (m.sender_id === partnerId && !m.read) entry.unread += 1;
    }

    const list: Conversation[] = [];
    for (const [partnerId, a] of agg) {
      const conv = convMap.get(partnerId);
      const prof = profileMap.get(partnerId);
      list.push({
        user_id: partnerId,
        full_name: prof?.name ?? "Mitarbeiter",
        status: conv?.status ?? "direct",
        escalated_at: conv?.escalated_at ?? null,
        unread: a.unread,
        lastMessage: a.lastMessage,
        lastAt: a.lastAt,
        tenantId: prof?.tenant_id ?? null,
        tenantName: prof?.tenant_id ? tenantMap.get(prof.tenant_id) ?? null : null,
        adminUnread: !!conv?.admin_unread,
        adminNote: conv?.admin_note ?? null,
        lastFromEmployeeAt: a.lastFromEmployeeAt,
        hiddenAt: conv?.admin_hidden_at ?? null,
      });
    }

    list.sort((a, b) => {
      if (a.status === "escalated" && b.status !== "escalated") return -1;
      if (a.status !== "escalated" && b.status === "escalated") return 1;
      const aFlag = a.unread || a.adminUnread ? 1 : 0;
      const bFlag = b.unread || b.adminUnread ? 1 : 0;
      if (aFlag !== bFlag) return bFlag - aFlag;
      return (b.lastAt ?? "").localeCompare(a.lastAt ?? "");
    });

    setConversations(list);
    setLoading(false);

    if (list.length > 0) {
      try {
        const map = await getLastSignIns({ data: { user_ids: list.map((c) => c.user_id) } });
        setConversations((prev) => prev.map((c) => ({
          ...c,
          lastSignInAt: map[c.user_id]?.last_sign_in_at ?? null,
          lastSeenAt: map[c.user_id]?.last_seen_at ?? null,
        })));
      } catch (e) {
        console.warn("Last sign-ins konnten nicht geladen werden:", e);
      }
    }
  };

  const formatLastActive = (ts?: string | null) => {
    if (!ts) return "Noch nie eingeloggt";
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 2) return "Gerade aktiv";
    if (m < 60) return `Aktiv vor ${m} Min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `Aktiv vor ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `Aktiv vor ${d} Tagen`;
    return `Aktiv am ${new Date(ts).toLocaleDateString("de-DE")}`;
  };

  const selectConversation = async (userId: string) => {
    setSelectedUserId(userId);
    const { data: msgs } = await supabase
      .from("chat_messages").select("*")
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${user!.id}),and(sender_id.eq.${user!.id},receiver_id.eq.${userId})`)
      .order("created_at", { ascending: true });
    setMessages((msgs ?? []) as ChatMessage[]);

    await supabase
      .from("chat_messages").update({ read: true } as any)
      .eq("sender_id", userId).eq("receiver_id", user!.id).eq("read", false);

    // Beim Öffnen: ungelesen-Flag zurücksetzen
    await supabase
      .from("chat_conversations")
      .upsert({ user_id: userId, admin_unread: false, updated_at: new Date().toISOString() } as any, { onConflict: "user_id" });

    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, unread: 0, adminUnread: false } : c));
    setNoteDraft(conversations.find((c) => c.user_id === userId)?.adminNote ?? "");
  };

  const markUnread = async (userId: string) => {
    const { error } = await supabase
      .from("chat_conversations")
      .upsert({ user_id: userId, admin_unread: true, updated_at: new Date().toISOString() } as any, { onConflict: "user_id" });
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, adminUnread: true } : c));
    if (selectedUserId === userId) setSelectedUserId(null);
    toast({ title: "Als ungelesen markiert" });
  };

  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const saveNote = async (userId: string) => {
    setSavingNote(true);
    const value = noteDraft.trim() || null;
    const { error } = await supabase
      .from("chat_conversations")
      .upsert({
        user_id: userId,
        admin_note: value,
        admin_note_updated_at: new Date().toISOString(),
        admin_note_updated_by: user!.id,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: "user_id" });
    setSavingNote(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, adminNote: value } : c));
    toast({ title: "Notiz gespeichert" });
  };


  const takeOver = async (userId: string) => {
    await supabase
      .from("chat_conversations")
      .update({ status: "human", updated_at: new Date().toISOString() } as any)
      .eq("user_id", userId);
    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, status: "human" } : c));
    toast({ title: "Chat übernommen" });
  };

  // resolveChat entfernt – kein "Gelöst"-Status mehr, da KI-Eskalationen aktuell nicht aktiv sind.


  const hideConversation = async (userId: string) => {
    setHiding(true);
    const hiddenAt = new Date().toISOString();
    const { error } = await supabase
      .from("chat_conversations")
      .upsert({ user_id: userId, admin_hidden_at: hiddenAt, updated_at: hiddenAt } as any, { onConflict: "user_id" });
    setHiding(false);
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, hiddenAt } : c));
    if (selectedUserId === userId) setSelectedUserId(null);
    toast({ title: "Chat ausgeblendet", description: "Im Tab 'Ausgeblendet' weiter sichtbar." });
  };

  const unhideConversation = async (userId: string) => {
    const { error } = await supabase
      .from("chat_conversations")
      .upsert({ user_id: userId, admin_hidden_at: null, updated_at: new Date().toISOString() } as any, { onConflict: "user_id" });
    if (error) {
      toast({ title: "Fehler", description: error.message, variant: "destructive" });
      return;
    }
    setConversations((prev) => prev.map((c) => c.user_id === userId ? { ...c, hiddenAt: null } : c));
    toast({ title: "Chat wieder eingeblendet" });
  };

  const [remindingId, setRemindingId] = useState<string | null>(null);
  const [reminderHistory, setReminderHistory] = useState<{ count: number; lastAt: string | null }>({ count: 0, lastAt: null });

  // Verlauf laden wenn Konversation geöffnet wird
  useEffect(() => {
    if (!selectedUserId) { setReminderHistory({ count: 0, lastAt: null }); return; }
    (async () => {
      // E-Mail des ausgewählten Users via profiles -> users RPC ist nicht da; wir filtern über metadata
      const { data, error } = await supabase
        .from("email_send_log")
        .select("created_at, recipient_email, metadata")
        .eq("template_name", "chat_reminder")
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error || !data) return;
      // Filter auf diesen User über metadata.user_id falls vorhanden, sonst über recipient_email-Match per profiles
      const mine = data.filter((r: any) => (r.metadata?.user_id ?? null) === selectedUserId);
      // Fallback: wenn keine user_id in metadata, fragen wir profile-Email ab
      if (mine.length === 0) {
        const { data: prof } = await supabase.from("profiles").select("email").eq("user_id", selectedUserId).maybeSingle();
        const email = (prof as any)?.email?.toLowerCase();
        if (email) {
          const matched = data.filter((r: any) => (r.recipient_email ?? "").toLowerCase() === email);
          setReminderHistory({ count: matched.length, lastAt: matched[0]?.created_at ?? null });
          return;
        }
      }
      setReminderHistory({ count: mine.length, lastAt: mine[0]?.created_at ?? null });
    })();
  }, [selectedUserId, remindingId]);

  const sendReminder = async (userId: string) => {
    setRemindingId(userId);
    const { data, error } = await supabase.functions.invoke("send-chat-reminder", {
      body: { userId, leaderName: user?.user_metadata?.full_name || user?.email || undefined },
    });
    setRemindingId(null);
    if (error || (data as any)?.error) {
      const msg = (data as any)?.error || error?.message || "Unbekannter Fehler";
      const skipped = (data as any)?.skipped;
      const suppressed = (data as any)?.suppressed;
      toast({
        title: suppressed ? "⚠️ Adresse gesperrt" : skipped ? "Nicht gesendet" : "Erinnerung fehlgeschlagen",
        description: msg,
        variant: suppressed || !skipped ? "destructive" : "default",
      });
      return;
    }
    toast({ title: "Erinnerung verschickt", description: `E-Mail an Mitarbeiter wurde gesendet.` });
  };


  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const startEdit = (msg: ChatMessage) => {
    setEditingId(msg.id);
    setEditDraft(msg.message);
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(""); };
  const saveEdit = async (msg: ChatMessage) => {
    const next = editDraft.trim();
    if (!next || next === msg.message) { cancelEdit(); return; }
    const { error } = await supabase
      .from("chat_messages")
      .update({ message: next, edited_at: new Date().toISOString() } as any)
      .eq("id", msg.id);
    if (error) { toast({ title: "Fehler", description: error.message, variant: "destructive" }); return; }
    setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, message: next } : m));
    cancelEdit();
  };
  const deleteMessage = async (msg: ChatMessage) => {
    if (!confirm("Nachricht wirklich löschen?")) return;
    const { error } = await supabase.from("chat_messages").delete().eq("id", msg.id);
    if (error) { toast({ title: "Fehler", description: error.message, variant: "destructive" }); return; }
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  };

  const sendMessage = async () => {
    if ((!newMessage.trim() && !pendingAttachment) || !selectedUserId || !user) return;
    setSending(true);
    await supabase.from("chat_messages").insert({
      sender_id: user.id,
      receiver_id: selectedUserId,
      message: newMessage.trim() || (pendingAttachment ? `📎 ${pendingAttachment.name}` : ""),
      attachment_url: pendingAttachment?.url ?? null,
      attachment_name: pendingAttachment?.name ?? null,
      attachment_type: pendingAttachment?.type ?? null,
    } as any);
    setNewMessage("");
    setPendingAttachment(null);
    setSending(false);
  };

  // Realtime
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("admin-chat-unified")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async (payload) => {
        const msg = payload.new as ChatMessage;
        if (msg.receiver_id !== user.id && msg.sender_id !== user.id) return;

        // Nachricht zum offenen Chat hinzufügen
        if (selectedUserId && (
          (msg.sender_id === selectedUserId && msg.receiver_id === user.id) ||
          (msg.sender_id === user.id && msg.receiver_id === selectedUserId)
        )) {
          setMessages((prev) => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (msg.sender_id === selectedUserId) {
            await supabase.from("chat_messages").update({ read: true } as any).eq("id", msg.id);
          }
        }

        // Conversation-Liste live aktualisieren
        if (msg.sender_id !== user.id) {
          const partnerId = msg.sender_id;
          setConversations((prev) => {
            const existing = prev.find(c => c.user_id === partnerId);
            if (existing) {
              return prev.map((c) =>
                c.user_id === partnerId
                  ? { ...c, unread: c.user_id === selectedUserId ? 0 : c.unread + 1, lastMessage: msg.message, lastAt: msg.created_at, lastFromEmployeeAt: msg.created_at }
                  : c
              );
            }
            return prev;
          });

          // Neuer Mitarbeiter-Chat: Profil + Conversation laden und einfügen
          const exists = conversations.some(c => c.user_id === partnerId);
          let partnerName = exists ? (conversations.find(c => c.user_id === partnerId)?.full_name ?? "Mitarbeiter") : "Mitarbeiter";
          if (!exists) {
            const { data: prof } = await supabase
              .from("profiles").select("user_id, full_name").eq("user_id", partnerId).maybeSingle();
            const { data: conv } = await supabase
              .from("chat_conversations").select("status, escalated_at").eq("user_id", partnerId).maybeSingle();
            if (prof) {
              partnerName = prof.full_name;
              setConversations((prev) => prev.some(c => c.user_id === partnerId) ? prev : [{
                user_id: prof.user_id,
                full_name: prof.full_name,
                status: conv?.status ?? "direct",
                escalated_at: conv?.escalated_at ?? null,
                unread: 1,
                lastMessage: msg.message,
                lastAt: msg.created_at,
              }, ...prev]);
            }
          }

          // Browser-Notification + Ping (nur wenn nicht der gerade offene Chat)
          if (partnerId !== selectedUserId) {
            notifyChat({ body: msg.message, senderName: partnerName });
          }
        } else {
          // Eigene Nachricht → lastMessage in Liste updaten + Unanswered-Flag löschen
          setConversations((prev) => prev.map((c) =>
            c.user_id === msg.receiver_id
              ? { ...c, lastMessage: msg.message, lastAt: msg.created_at, lastFromEmployeeAt: null }
              : c
          ));
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_conversations" }, (payload) => {
        const conv = payload.new as { user_id: string; status: string; escalated_at: string | null };
        setConversations((prev) => prev.map((c) =>
          c.user_id === conv.user_id ? { ...c, status: conv.status, escalated_at: conv.escalated_at } : c
        ));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, selectedUserId, conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Typing-Indicator: Channel pro selectedUserId (spiegelbild zu FloatingChat)
  useEffect(() => {
    if (!user || !selectedUserId) {
      setPartnerTyping(false);
      return;
    }
    const channelName = `typing-${[user.id, selectedUserId].sort().join("-")}`;
    const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.userId === selectedUserId) {
          setPartnerTyping(true);
          if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = window.setTimeout(() => setPartnerTyping(false), 3000);
        }
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
      setPartnerTyping(false);
    };
  }, [user, selectedUserId]);

  const broadcastTyping = () => {
    if (!typingChannelRef.current || !user) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: user.id },
    });
  };


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const tenantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) {
      if (c.tenantId && c.tenantName) map.set(c.tenantId, c.tenantName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations]);

  const activeCount = conversations.filter((c) => !c.hiddenAt).length;
  const hiddenCount = conversations.filter((c) => !!c.hiddenAt).length;

  const filteredConversations = conversations.filter((c) => {
    if (viewTab === "active" ? !!c.hiddenAt : !c.hiddenAt) return false;
    if (!c.full_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tenantFilter !== "all" && c.tenantId !== tenantFilter) return false;
    if (filterTab === "escalated") return c.status === "escalated";
    if (filterTab === "open") return c.status !== "resolved";
    return true;
  });

  const selectedConv = conversations.find((c) => c.user_id === selectedUserId);
  const selectedName = selectedConv?.full_name ?? "";
  const selectedInitials = selectedName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  

  const statusBadge = (_status: string) => null;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-pulse text-muted-foreground">Laden…</div></div>;
  }

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Conversation list */}
      <div className="w-80 border-r border-border bg-card flex flex-col shrink-0">
        <div className="p-3 border-b border-border space-y-2">
          <h2 className="text-sm font-semibold">Chat</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Suchen…" className="pl-9 h-9 text-sm" />
          </div>
          {/* Aktiv / Ausgeblendet */}
          <div className="flex gap-1">
            <button
              onClick={() => setViewTab("active")}
              className={cn(
                "flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors",
                viewTab === "active" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              Aktiv ({activeCount})
            </button>
            <button
              onClick={() => setViewTab("hidden")}
              className={cn(
                "flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors flex items-center justify-center gap-1",
                viewTab === "hidden" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
            >
              <EyeOff className="h-3 w-3" /> Ausgeblendet ({hiddenCount})
            </button>
          </div>
          {/* Tenant-Tabs */}
          {tenantOptions.length > 1 && (
            <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              <button
                onClick={() => setTenantFilter("all")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                  tenantFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
              >
                Alle ({conversations.length})
              </button>
              {tenantOptions.map((t) => {
                const count = conversations.filter((c) => c.tenantId === t.id).length;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTenantFilter(t.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors",
                      tenantFilter === t.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t.name} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Keine Chats</p>
          )}
          {filteredConversations.map((conv) => {
            const initials = conv.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
            return (
              <button
                key={conv.user_id}
                onClick={() => selectConversation(conv.user_id)}
                className={cn(
                  "w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/50 transition-colors border-b border-border/50",
                  selectedUserId === conv.user_id && "bg-primary/5 border-l-2 border-l-primary",
                  conv.status === "escalated" && "bg-destructive/[0.02]"
                )}
              >
                <div className={cn(
                  "h-9 w-9 rounded-full flex items-center justify-center shrink-0 relative",
                  conv.status === "escalated" ? "bg-destructive/10" : "bg-primary/10"
                )}>
                  <span className={cn("text-xs font-bold", conv.status === "escalated" ? "text-destructive" : "text-primary")}>{initials}</span>
                  {onlineUsers.has(conv.user_id) && (
                    <span
                      title="Aktuell online"
                      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-background"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{conv.full_name}</p>
                    {statusBadge(conv.status)}
                    {isUnanswered(conv) && !conv.adminNote && (
                      <span
                        title="Unbeantwortet seit > 4 h"
                        className="h-2 w-2 rounded-full bg-red-500 shrink-0"
                      />
                    )}
                    {conv.adminNote && (
                      <StickyNote className="h-3 w-3 text-amber-500 shrink-0" aria-label="Admin-Notiz vorhanden" />
                    )}
                  </div>
                  {conv.tenantName && (
                    <p className="text-[10px] text-primary/80 mt-0.5 flex items-center gap-1 truncate">
                      <Building2 className="h-2.5 w-2.5 shrink-0" /> {conv.tenantName}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {onlineUsers.has(conv.user_id)
                      ? <span className="text-green-600 font-medium">● Online</span>
                      : formatLastActive(conv.lastSeenAt ?? conv.lastSignInAt)}
                  </p>
                  {conv.lastMessage && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessage}</p>
                  )}
                </div>
                {(conv.unread > 0 || conv.adminUnread) && (
                  <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px]">
                    {conv.unread > 0 ? conv.unread : "neu"}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {!selectedUserId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageCircle className="h-12 w-12 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Wähle einen Chat aus.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-border bg-card px-5 py-3 flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => navigate(`/admin/personen/${selectedUserId}`)}
                title="Mitarbeiter-Profil öffnen"
                className="h-9 w-9 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors flex items-center justify-center"
              >
                <span className="text-xs font-bold text-primary">{selectedInitials}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/admin/personen/${selectedUserId}`)}
                className="flex-1 text-left group"
                title="Mitarbeiter-Profil öffnen"
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{selectedName}</p>
                  {selectedConv && statusBadge(selectedConv.status)}
                  <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {selectedConv?.tenantName && (
                  <p className="text-[11px] text-primary/80 flex items-center gap-1 mt-0.5">
                    <Building2 className="h-3 w-3" /> {selectedConv.tenantName}
                  </p>
                )}
                {partnerTyping && (
                  <p className="text-[11px] text-primary flex items-center gap-1.5 mt-0.5">
                    <span className="flex gap-0.5">
                      <span className="h-1 w-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1 w-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1 w-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    schreibt …
                  </p>
                )}
              </button>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markUnread(selectedUserId!)}
                  className="text-xs text-muted-foreground hover:text-primary"
                  title="Als ungelesen markieren – Chat erscheint wieder mit Badge"
                >
                  <MailOpen className="h-3.5 w-3.5 mr-1" /> Ungelesen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => sendReminder(selectedUserId!)}
                  disabled={remindingId === selectedUserId}
                  className="text-xs text-muted-foreground hover:text-primary"
                  title="E-Mail-Erinnerung an Mitarbeiter senden (max. 1× pro 24h)"
                >
                  <Mail className="h-3.5 w-3.5 mr-1" /> {remindingId === selectedUserId ? "Sende…" : "Erinnerung senden"}
                </Button>
                {reminderHistory.count > 0 && (
                  <span className="text-[11px] text-muted-foreground self-center px-1.5" title={reminderHistory.lastAt ? `Letzter Reminder: ${new Date(reminderHistory.lastAt).toLocaleString("de-DE")}` : undefined}>
                    📧 {(() => {
                      if (!reminderHistory.lastAt) return `${reminderHistory.count}× gesendet`;
                      const diffH = Math.round((Date.now() - new Date(reminderHistory.lastAt).getTime()) / 3600000);
                      const when = diffH < 1 ? "<1h" : diffH < 24 ? `${diffH}h` : `${Math.round(diffH / 24)}d`;
                      return `vor ${when} • ${reminderHistory.count}× gesendet`;
                    })()}
                  </span>
                )}

                {selectedConv?.hiddenAt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unhideConversation(selectedUserId!)}
                    className="text-xs text-muted-foreground hover:text-primary"
                    title="Chat wieder einblenden"
                  >
                    <ChevronRight className="h-3.5 w-3.5 mr-1" /> Einblenden
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => hideConversation(selectedUserId!)}
                    disabled={hiding}
                    className="text-xs text-muted-foreground hover:text-destructive"
                    title="Chat ausblenden – im Tab 'Ausgeblendet' weiter sichtbar"
                  >
                    <EyeOff className="h-3.5 w-3.5 mr-1" /> Ausblenden
                  </Button>
                )}
              </div>
            </div>

            {/* Admin-Notiz – nur intern */}
            <div className="border-b border-border bg-amber-50/60 dark:bg-amber-950/20 px-5 py-3 shrink-0">
              <div className="flex items-center gap-2 mb-1.5">
                <StickyNote className="h-4 w-4 text-amber-600" />
                <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">Interne Notiz</span>
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-700/80 dark:text-amber-300/70 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
                  <Lock className="h-2.5 w-2.5" /> Nur für Teamleiter / Admin sichtbar
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="z. B. 'wartet auf Vertrag', 'hat angerufen', 'erreicht uns nicht' …"
                  rows={3}
                  className="flex-1 min-h-[72px] py-2 text-sm resize-y bg-background/60 border-amber-200 dark:border-amber-800/40"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveNote(selectedUserId!)}
                  disabled={savingNote || (noteDraft.trim() === (selectedConv?.adminNote ?? ""))}
                  className="text-xs h-9"
                >
                  Speichern
                </Button>
              </div>
              {isUnanswered(selectedConv!) && !selectedConv?.adminNote && (
                <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1 mt-2">
                  <AlertCircle className="h-3 w-3" /> Seit über 4 Stunden unbeantwortet – kurz Notiz hinterlassen, falls du dranbleibst.
                </p>
              )}
            </div>


            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.map((msg) => {
                const isMine = msg.sender_id === user!.id;
                const isAi = msg.is_ai;
                return (
                  <div key={msg.id} className={cn("flex items-end gap-2", isMine ? "justify-end" : "justify-start")}>
                    {!isMine && (
                      <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0 mb-1",
                        isAi ? "bg-accent/20" : "bg-primary/10"
                      )}>
                        {isAi ? <Bot className="h-3.5 w-3.5 text-accent-foreground" /> : (
                          <span className="text-[10px] font-bold text-primary">{selectedInitials}</span>
                        )}
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[70%] rounded-2xl px-4 py-2.5 text-sm relative group",
                      isMine
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : isAi
                          ? "bg-accent/10 text-foreground rounded-bl-md border border-accent/20"
                          : "bg-muted text-foreground rounded-bl-md"
                    )}>
                      {editingId === msg.id ? (
                        <div className="space-y-2 min-w-[240px]">
                          <Textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={2}
                            className="text-sm bg-background text-foreground"
                          />
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={cancelEdit} className="h-7 text-xs">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" onClick={() => saveEdit(msg)} className="h-7 text-xs">
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {msg.message && <p className="whitespace-pre-wrap">{msg.message}</p>}
                          {msg.attachment_url && msg.attachment_type && (
                            <AttachmentPreview
                              url={msg.attachment_url}
                              name={msg.attachment_name ?? "Anhang"}
                              type={msg.attachment_type}
                            />
                          )}
                          <p className={cn("text-[10px] mt-1", isMine ? "text-primary-foreground/60" : "text-muted-foreground")}>
                            {new Date(msg.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                            {(msg as any).edited_at && " · bearbeitet"}
                            {isAi && " · 🤖 KI"}
                            {isMine && " · 👤 Admin"}
                          </p>
                          {isMine && !isAi && (
                            <div className="absolute -top-3 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                              <button
                                type="button"
                                onClick={() => startEdit(msg)}
                                title="Bearbeiten"
                                className="h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-primary shadow-sm"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteMessage(msg)}
                                title="Löschen"
                                className="h-6 w-6 rounded-full bg-background border border-border flex items-center justify-center text-muted-foreground hover:text-destructive shadow-sm"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border bg-card px-5 py-3 shrink-0 space-y-2">
              {pendingAttachment && (
                <div className="flex items-center gap-2 text-xs bg-muted/50 px-3 py-2 rounded-lg">
                  <span className="flex-1 truncate">📎 {pendingAttachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Entfernen
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <ChatAttachmentButton
                  userId={user!.id}
                  onUploaded={setPendingAttachment}
                  disabled={!selectedUserId}
                />
                <EmojiPicker onSelect={(e) => setNewMessage((m) => m + e)} />
                <Textarea
                  value={newMessage}
                  onChange={(e) => { setNewMessage(e.target.value); broadcastTyping(); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Nachricht schreiben… (Shift + Enter = neue Zeile)"
                  rows={3}
                  className="flex-1 min-h-[80px] max-h-60 resize-y py-2 text-sm"
                />
                <Button
                  size="icon"
                  onClick={sendMessage}
                  disabled={(!newMessage.trim() && !pendingAttachment) || sending}
                  className="h-10 w-10 shrink-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
