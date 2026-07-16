import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Smile } from "lucide-react";

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘","😋","😜","🤪","😎",
  "🤓","🧐","🤔","🤗","🤝","🙌","👏","👍","👎","👌","✌️","🤞","🤟","🤙","💪","🙏","👋","❤️","🔥","✨",
  "🎉","🎊","💯","✅","❌","⚠️","❓","❗","💡","📌","📎","📷","📁","📅","⏰","🚀","💬","💭","👀","🥳",
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Emoji einfügen">
          <Smile className="h-5 w-5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="end" side="top">
        <div className="grid grid-cols-10 gap-1 max-h-48 overflow-y-auto">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onSelect(e); setOpen(false); }}
              className="text-xl hover:bg-muted rounded p-1 transition-colors"
            >
              {e}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
