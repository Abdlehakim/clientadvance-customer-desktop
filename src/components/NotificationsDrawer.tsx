import { useState } from "react";
import { Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  clearSentNotifications,
  formatDateTimeFR,
  getAdminSettings,
  getCurrentUser,
  getNotifications,
} from "@/lib/data";

function statusLabel(status?: string) {
  if (status === "sending") {
    return "Envoi en cours";
  }

  if (status === "sent") {
    return "Envoyée";
  }

  if (status === "failed") {
    return "Échec";
  }

  return "En attente";
}

function statusClassName(status?: string) {
  if (status === "sending") {
    return "border-info/40 bg-info/10 text-info";
  }

  if (status === "sent") {
    return "border-success/40 bg-success/10 text-[oklch(0.35_0.1_150)]";
  }

  if (status === "failed") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }

  return "border-warning/40 bg-warning/15 text-warning-foreground";
}

export function NotificationsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [isClearingSent, setIsClearingSent] = useState(false);
  const settings = getAdminSettings();
  const currentUser = getCurrentUser();
  const isAdminUser = currentUser?.role === "admin";
  const isWithoutServerMode = settings.server_mode === "without-server";
  const items = getNotifications().filter(
    (notification) => !isWithoutServerMode || notification.type === "email",
  );
  const sentCount = items.filter((notification) => notification.status === "sent").length;

  const onClearSentNotifications = async () => {
    setIsClearingSent(true);

    try {
      const deletedCount = await clearSentNotifications();

      if (deletedCount === 0) {
        toast("Aucune notification envoyée à effacer.");
      } else {
        toast.success(
          deletedCount === 1
            ? "1 notification envoyée effacée."
            : `${deletedCount} notifications envoyées effacées.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossible d'effacer les notifications envoyées.",
      );
    } finally {
      setIsClearingSent(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[440px] sm:max-w-[440px]">
        <SheetHeader>
          <div className="flex items-center justify-between gap-3">
            <SheetTitle>File de notifications</SheetTitle>
            {isAdminUser ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onClearSentNotifications()}
                disabled={isClearingSent || sentCount === 0}
              >
                {isClearingSent
                  ? "Effacement..."
                  : "Effacer les notifications envoyées"}
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        <ScrollArea className="mt-4 h-[calc(100vh-100px)] pr-3">
          {items.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              Aucune notification pour le moment.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((notification) => {
                const dateTime = formatDateTimeFR(notification.created_at);
                const isEmail = notification.type === "email";

                return (
                  <div
                    key={notification.id}
                    className="rounded-lg border bg-card p-3 shadow-card"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-medium">
                          {isEmail ? (
                            <Mail className="h-3.5 w-3.5 text-info" />
                          ) : (
                            <MessageCircle className="h-3.5 w-3.5 text-success" />
                          )}
                          <span className="uppercase tracking-wide">
                            {notification.type}
                          </span>
                          <span className="truncate text-muted-foreground">
                            -&gt; {notification.recipient}
                          </span>
                        </div>
                        <div className="mt-1 text-sm font-medium">
                          {notification.subject}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10px] text-muted-foreground">
                          {dateTime.date} {dateTime.time}
                        </div>
                        <div
                          className={`mt-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClassName(notification.status)}`}
                        >
                          {statusLabel(notification.status)}
                        </div>
                      </div>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground">
                      {notification.body}
                    </pre>
                    {isEmail &&
                    notification.status === "failed" &&
                    notification.error_message ? (
                      <p className="mt-2 text-xs text-destructive">
                        {notification.error_message}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
