import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ChatAttachment = {
  url: string;
  name: string;
  type: string;
};

interface Props {
  userId: string;
  onUploaded: (a: ChatAttachment) => void;
  disabled?: boolean;
}

export function ChatAttachmentButton({ userId, onUploaded, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Datei zu groß", description: "Maximal 10 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { data } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 60 * 60 * 24 * 365);
      const url = data?.signedUrl;
      if (!url) throw new Error("Signed URL konnte nicht erstellt werden");
      onUploaded({ url, name: file.name, type: file.type || "application/octet-stream" });
    } catch (err: any) {
      toast({ title: "Upload fehlgeschlagen", description: err?.message ?? "Unbekannter Fehler", variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-10 w-10 shrink-0"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        aria-label="Datei anhängen"
      >
        {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5 text-muted-foreground" />}
      </Button>
    </>
  );
}

export function AttachmentPreview({ url, name, type }: ChatAttachment) {
  const isImage = type.startsWith("image/");
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-2">
        <img src={url} alt={name} className="max-h-48 rounded-lg border border-border/40 object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-2 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-background/60 border border-border/40 text-xs hover:bg-background"
    >
      <Paperclip className="h-3.5 w-3.5" />
      <span className="truncate max-w-[180px]">{name}</span>
    </a>
  );
}
