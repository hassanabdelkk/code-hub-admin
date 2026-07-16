import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageCircle } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { useTeamLeader } from "@/hooks/use-team-leader";
import { cn } from "@/lib/utils";

export function TeamLeaderCard() {
  const { leader, initials } = useTeamLeader();
  const navigate = useNavigate();

  return (
    <Card className="animate-fade-in border-primary/15 bg-gradient-to-br from-primary/5 to-accent/5">
      <CardContent className="py-4 px-5 flex items-center gap-4">
        <div className="relative shrink-0">
          <Avatar className="h-12 w-12 ring-2 ring-background">
            {leader.avatar_url && <AvatarImage src={leader.avatar_url} alt={leader.name} />}
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-background",
              leader.is_online ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
            Dein persönlicher Ansprechpartner
          </p>
          <p className="font-heading font-bold text-sm text-foreground truncate">{leader.name}</p>
          <p className="text-xs text-muted-foreground">
            {leader.is_online ? "● Online — antwortet meist in wenigen Minuten" : leader.response_time}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => navigate("/chat")}
          className="gap-1.5 shrink-0 rounded-xl"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Nachricht
        </Button>
      </CardContent>
    </Card>
  );
}
