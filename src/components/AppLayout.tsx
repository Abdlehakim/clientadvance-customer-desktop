import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UserCog,
  CreditCard,
  Settings,
  ScrollText,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  Bell,
  CircleUserRound,
  PanelLeftClose,
  PanelLeftOpen,
  Building2,
  CalendarDays,
  Mail,
  Phone,
  Server,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getAdminSettings,
  getCurrentUser,
  getLastSync,
  getNotifications,
  getPendingCount,
  isOnline,
  logout,
  syncPendingData,
  formatDateTimeFR,
} from "@/lib/data";
import { BACKEND_SYNC_DISABLED_MESSAGE } from "@/infrastructure/local/adminSettingsState";
import { useAppData } from "@/lib/useAppData";
import {
  deliverQueuedNotifications,
  isNotificationDeliveryDeferred,
} from "@/services/notificationDeliveryScheduler";
import { initializeStorageDriver } from "@/services/appServices";
import { useHasMounted } from "@/hooks/useHasMounted";
import { InitialAdminSetupDialog } from "./InitialAdminSetupDialog";
import { NotificationsDrawer } from "./NotificationsDrawer";

const allItems = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard, admin: false },
  { to: "/clients", label: "Clients", icon: Users, admin: false },
  { to: "/paiements", label: "Paiements", icon: CreditCard, admin: false },
  {
    to: "/parametres-utilisateur",
    label: "Paramètres",
    icon: Settings,
    admin: false,
    employee: true,
  },
  { to: "/employes", label: "Gestion des E-user", icon: UserCog, admin: true },
  { to: "/parametres", label: "Paramètres administrateur", icon: Settings, admin: true },
  { to: "/journal", label: "Journal des activités", icon: ScrollText, admin: true },
] as const;

interface AppLayoutSessionCache {
  userSessionKey: string | null;
  isStorageReady: boolean;
  setupCompletedInSession: boolean;
}

interface UserSessionKeySource {
  id?: string | null;
  role?: string | null;
}

let activeSyncPromise: Promise<void> | null = null;

function createEmptySessionCache(): AppLayoutSessionCache {
  return {
    userSessionKey: null,
    isStorageReady: false,
    setupCompletedInSession: false,
  };
}

let appLayoutSessionCache = createEmptySessionCache();

function getUserSessionKey(user: UserSessionKeySource | null | undefined) {
  if (typeof user?.id !== "string" || typeof user?.role !== "string") {
    return null;
  }

  const id = user.id.trim();
  const role = user.role.trim();

  return id.length > 0 && role.length > 0 ? `${id}:${role}` : null;
}

function getUserRoleDisplayLabel(role: string | null | undefined) {
  if (role === "employe") {
    return "E-user";
  }

  if (role === "admin") {
    return "Admin";
  }

  return role ?? "";
}

function getServerModeDisplayLabel(serverMode: string | null | undefined) {
  if (serverMode === "with-server") {
    return "Avec serveur";
  }

  if (serverMode === "without-server") {
    return "Sans serveur";
  }

  return "Non renseigné";
}

function getAccountExpirationDisplay(
  accountExpiresAt: string | null | undefined,
) {
  if (!accountExpiresAt) {
    return {
      date: "À vie",
      remaining: "Aucune expiration",
    };
  }

  const expirationDate = new Date(accountExpiresAt);

  if (Number.isNaN(expirationDate.getTime())) {
    return {
      date: "Date invalide",
      remaining: "",
    };
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const expirationStart = new Date(
    expirationDate.getFullYear(),
    expirationDate.getMonth(),
    expirationDate.getDate(),
  );
  const daysLeft = Math.ceil(
    (expirationStart.getTime() - todayStart.getTime()) / 86_400_000,
  );

  let remaining: string;

  if (daysLeft < 0) {
    remaining = "Compte expiré";
  } else if (daysLeft === 0) {
    remaining = "Expire aujourd’hui";
  } else if (daysLeft === 1) {
    remaining = "1 jour restant";
  } else {
    remaining = `${daysLeft} jours restants`;
  }

  return {
    date: formatDateTimeFR(accountExpiresAt).date,
    remaining,
  };
}

function readAppLayoutSessionCache(userSessionKey: string | null) {
  if (
    userSessionKey &&
    appLayoutSessionCache.userSessionKey === userSessionKey
  ) {
    return appLayoutSessionCache;
  }

  return createEmptySessionCache();
}

function AppLayoutBootScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <span className="text-sm text-muted-foreground">Chargement...</span>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  useAppData();
  const mounted = useHasMounted();
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const initialUser = mounted ? getCurrentUser() : null;
  const initialUserSessionKey = getUserSessionKey(initialUser);
  const initialSessionCache = readAppLayoutSessionCache(initialUserSessionKey);
  const [isStorageReady, setIsStorageReady] = useState(initialSessionCache.isStorageReady);
  const [setupCompletedInSession, setSetupCompletedInSession] = useState(
    initialSessionCache.setupCompletedInSession,
  );
  const isNavigatingToLoginRef = useRef(false);
  const previousOnlineRef = useRef<boolean | null>(null);
  const autoSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopDeliveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDesktopDeliverySignatureRef = useRef<string | null>(null);

  const user = mounted ? getCurrentUser() : null;
  const userSessionKey = getUserSessionKey(user);
  const cachedSessionState = readAppLayoutSessionCache(userSessionKey);
  const online = mounted ? isOnline() : true;

  useEffect(() => {
    if (!mounted || user || isNavigatingToLoginRef.current) {
      return;
    }

    isNavigatingToLoginRef.current = true;
    navigate({ to: "/", replace: true });
  }, [mounted, navigate, user]);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    if (!user) {
      setIsStorageReady(false);
      setSetupCompletedInSession(false);
      return;
    }

    let cancelled = false;

    if (!cachedSessionState.isStorageReady) {
      setIsStorageReady(false);
    }

    if (!cachedSessionState.setupCompletedInSession) {
      setSetupCompletedInSession(false);
    }

    void initializeStorageDriver()
      .then(() => {
        if (!cancelled) {
          setIsStorageReady(true);
        }
      })
      .catch((error) => {
        console.error("Storage initialization failed in AppLayout.", error);

        if (!cancelled) {
          setIsStorageReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    cachedSessionState.isStorageReady,
    cachedSessionState.setupCompletedInSession,
    mounted,
    userSessionKey,
  ]);

  useEffect(() => {
    if (!mounted || !userSessionKey) {
      return;
    }

    appLayoutSessionCache = {
      userSessionKey,
      isStorageReady,
      setupCompletedInSession,
    };
  }, [
    isStorageReady,
    mounted,
    setupCompletedInSession,
    userSessionKey,
  ]);

  const canReadAppState = mounted && !!user && isStorageReady;
  const shouldRenderProtectedApp = canReadAppState;

  const isAdminUser = user?.role === "admin";
  const items = allItems.filter((item) => {
    if (item.admin) {
      return user?.role === "admin";
    }

    if ("employee" in item && item.employee) {
      return user?.role === "employe";
    }

    return true;
  });
  const pending = canReadAppState ? getPendingCount() : 0;
  const lastSync = canReadAppState ? getLastSync() : null;
  const notifications = canReadAppState ? getNotifications() : [];
  const settings = canReadAppState ? getAdminSettings() : null;
  const visibleNotifications =
    settings?.server_mode === "without-server"
      ? notifications.filter((notification) => notification.type === "email")
      : notifications;
  const showInitialSetupDialog =
    user?.role === "admin" &&
    shouldRenderProtectedApp &&
    !setupCompletedInSession &&
    !!settings &&
    !settings.setup_completed;
  const backendSyncEnabled = settings?.server_mode === "with-server";
  const retryableEmailNotificationIds = visibleNotifications
    .filter(
      (notification) =>
        notification.type === "email" &&
        (notification.status === undefined ||
          notification.status === "queued" ||
          notification.status === "sending") &&
        !isNotificationDeliveryDeferred(notification.id),
    )
    .map((notification) => notification.id)
    .sort()
    .join(",");

  const clearAutoSyncTimeout = () => {
    if (autoSyncTimeoutRef.current !== null) {
      clearTimeout(autoSyncTimeoutRef.current);
      autoSyncTimeoutRef.current = null;
    }
  };

  const clearDesktopDeliveryTimeout = () => {
    if (desktopDeliveryTimeoutRef.current !== null) {
      clearTimeout(desktopDeliveryTimeoutRef.current);
      desktopDeliveryTimeoutRef.current = null;
    }
  };

  const showNotificationDeliveryToasts = async () => {
    const deliveryResult = await deliverQueuedNotifications();

    if (deliveryResult.offline && deliveryResult.remainingCount > 0) {
      toast("Notifications en attente. Elles seront envoyées lorsque la connexion sera disponible.");
      return;
    }

    if (deliveryResult.sentCount > 0) {
      toast.success(
        deliveryResult.sentCount === 1
          ? "Notification email envoyée"
          : `${deliveryResult.sentCount} notifications email envoyées`,
      );
    }

    if (deliveryResult.failedCount > 0) {
      const reason = deliveryResult.errorMessages[0] ?? "Échec d'envoi email";
      toast.error(`Échec d'envoi email : ${reason}`);
    }
  };

  const runDesktopNotificationDelivery = () => showNotificationDeliveryToasts();

  const runSync = (mode: "manual" | "auto") => {
    if (activeSyncPromise) {
      return activeSyncPromise;
    }

    activeSyncPromise = (async () => {
      const pendingBefore = getPendingCount();

      try {
        const result = await Promise.resolve(syncPendingData());

        if (!result.ok) {
          toast.error("Impossible de synchroniser : hors ligne");
          await showNotificationDeliveryToasts();
          return;
        }

        const pendingAfter = getPendingCount();

        if (pendingBefore > 0 && pendingAfter > 0) {
          toast.error(
            result.synced > 0
              ? "Synchronisation terminée, mais certains éléments restent en attente."
              : "Synchronisation incomplète. Certains éléments restent en attente.",
          );
        } else if (pendingBefore > 0 && result.synced === 0 && pendingAfter === 0) {
          toast.success("Synchronisation terminée.");
        } else if (mode === "auto") {
          toast.success(`Synchronisation automatique terminée (${result.synced} éléments)`);
        } else {
          toast.success(`Synchronisation terminée (${result.synced} éléments)`);
        }

        await showNotificationDeliveryToasts();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Synchronisation impossible. Serveur indisponible.";

        toast.error(message);

        if (message === "Synchronisation impossible. Serveur indisponible.") {
          await showNotificationDeliveryToasts();
        }
      } finally {
        activeSyncPromise = null;
      }
    })();

    return activeSyncPromise;
  };

  useEffect(() => {
    if (!shouldRenderProtectedApp) {
      clearAutoSyncTimeout();
      return;
    }

    const previousOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;

    if (!user || !online) {
      clearAutoSyncTimeout();
      return;
    }

    if (!backendSyncEnabled || previousOnline === null || previousOnline || pending <= 0) {
      return;
    }

    clearAutoSyncTimeout();
    autoSyncTimeoutRef.current = setTimeout(() => {
      autoSyncTimeoutRef.current = null;

      if (!backendSyncEnabled || !isOnline() || getPendingCount() <= 0) {
        return;
      }

      void runSync("auto");
    }, 2000);
  }, [backendSyncEnabled, online, pending, shouldRenderProtectedApp, user]);

  useEffect(() => {
    if (
      !shouldRenderProtectedApp ||
      !user ||
      !online ||
      backendSyncEnabled ||
      retryableEmailNotificationIds.length === 0
    ) {
      clearDesktopDeliveryTimeout();
      return;
    }

    const signature = `${retryableEmailNotificationIds}|${settings?.updated_at ?? ""}`;

    if (lastDesktopDeliverySignatureRef.current === signature) {
      return;
    }

    clearDesktopDeliveryTimeout();
    desktopDeliveryTimeoutRef.current = setTimeout(() => {
      desktopDeliveryTimeoutRef.current = null;
      lastDesktopDeliverySignatureRef.current = signature;
      void runDesktopNotificationDelivery();
    }, 800);

    return () => {
      clearDesktopDeliveryTimeout();
    };
  }, [
    backendSyncEnabled,
    online,
    retryableEmailNotificationIds,
    settings?.updated_at,
    shouldRenderProtectedApp,
    user,
  ]);

  useEffect(() => {
    return () => {
      clearAutoSyncTimeout();
      clearDesktopDeliveryTimeout();
    };
  }, []);

  if (!mounted) {
    return <div className="h-screen w-full overflow-hidden bg-background" />;
  }

  if (!user) {
    return <div className="h-screen w-full overflow-hidden bg-background" />;
  }

  if (!isStorageReady) {
    return <AppLayoutBootScreen />;
  }

  if (!settings) {
    return <AppLayoutBootScreen />;
  }

  const accountExpiration = getAccountExpirationDisplay(
    user.account_expires_at,
  );

  const onSync = async () => {
    clearAutoSyncTimeout();

    if (!isAdminUser) {
      return;
    }

    if (!backendSyncEnabled) {
      toast(BACKEND_SYNC_DISABLED_MESSAGE);
      return;
    }

    await runSync("manual");
  };

  const onLogout = async () => {
    if (isNavigatingToLoginRef.current) {
      return;
    }

    clearAutoSyncTimeout();
    clearDesktopDeliveryTimeout();
    isNavigatingToLoginRef.current = true;
    await Promise.resolve(logout());
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <aside
        className={cn(
          "flex h-screen shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground transition-[width]",
          sidebarCollapsed ? "w-20" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-sidebar-border",
            sidebarCollapsed ? "justify-center px-3" : "gap-2 px-5",
          )}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary font-bold text-sidebar-primary-foreground">
            G
          </div>
          {!sidebarCollapsed && (
            <div>
              <div className="text-sm font-semibold leading-tight">ClientAdvans</div>
              <div className="text-xs leading-tight opacity-70">& Paiements</div>
            </div>
          )}
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active = path === item.to || path.startsWith(`${item.to}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-label={item.label}
                title={sidebarCollapsed ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-md py-2 text-sm transition-colors",
                  sidebarCollapsed
                    ? "justify-center px-2"
                    : "gap-3 px-3",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {sidebarCollapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  item.label
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-6">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={
                sidebarCollapsed
                  ? "Déployer la navigation"
                  : "Réduire la navigation"
              }
              title={
                sidebarCollapsed
                  ? "Déployer la navigation"
                  : "Réduire la navigation"
              }
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
            <Badge
              variant="outline"
              className={
                online
                  ? "border-success/40 bg-success/10 text-[oklch(0.35_0.1_150)]"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }
            >
              {online ? (
                <Wifi className="mr-1 h-3 w-3" />
              ) : (
                <WifiOff className="mr-1 h-3 w-3" />
              )}
              {online ? "Connecté" : "Hors ligne"}
            </Badge>
            {pending > 0 && (
              <Badge
                variant="outline"
                className="border-warning/40 bg-warning/15 text-warning-foreground"
              >
                {pending} en attente
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              Dernière sync :{" "}
              {lastSync
                ? `${formatDateTimeFR(lastSync).date} ${formatDateTimeFR(lastSync).time}`
                : "-"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNotifOpen(true)}
              className="relative h-8 w-8 p-0"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {visibleNotifications.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {visibleNotifications.length}
                </span>
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  aria-label="Compte connecté"
                  title="Compte connecté"
                >
                  <CircleUserRound className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-80 max-w-[calc(100vw-1rem)] p-0"
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                      <CircleUserRound
                        className="h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{user.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {getUserRoleDisplayLabel(user.role)}
                      </div>
                    </div>
                  </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator className="my-0" />

                <DropdownMenuLabel className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Coordonnées
                </DropdownMenuLabel>

                <div className="flex items-start gap-3 px-4 py-2">
                  <Mail
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">Email</div>
                    <div className="truncate text-sm font-medium">{user.email}</div>
                  </div>
                </div>

                {typeof user.phone === "string" &&
                  user.phone.trim().length > 0 && (
                    <div className="flex items-start gap-3 px-4 py-2">
                      <Phone
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">Téléphone</div>
                        <div className="truncate text-sm font-medium">{user.phone}</div>
                      </div>
                    </div>
                  )}

                {typeof user.company_name === "string" &&
                  user.company_name.trim().length > 0 && (
                    <div className="flex items-start gap-3 px-4 py-2">
                      <Building2
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-muted-foreground">Entreprise</div>
                        <div className="truncate text-sm font-medium">
                          {user.company_name}
                        </div>
                      </div>
                    </div>
                  )}

                <DropdownMenuSeparator className="my-1" />

                <DropdownMenuLabel className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Compte
                </DropdownMenuLabel>

                <div className="flex items-start gap-3 px-4 py-2">
                  <Server
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">
                      Mode de fonctionnement
                    </div>
                    <div className="text-sm font-medium">
                      {getServerModeDisplayLabel(settings.server_mode)}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 px-4 py-2">
                  <CalendarDays
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">
                      Expiration du compte
                    </div>
                    <div className="text-sm font-medium">{accountExpiration.date}</div>
                    {accountExpiration.remaining && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {accountExpiration.remaining}
                      </div>
                    )}
                  </div>
                </div>

                <DropdownMenuSeparator className="my-0" />

                <div className="p-2">
                  <DropdownMenuItem
                    onSelect={() => void onLogout()}
                    className="h-10 px-3 text-destructive focus:text-destructive"
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Se déconnecter
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            {isAdminUser && backendSyncEnabled && (
              <Button
                size="sm"
                onClick={() => void onSync()}
                className="h-8 w-8 p-0"
                aria-label="Synchroniser"
                title="Synchroniser"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
          {children}
        </main>
      </div>

      <NotificationsDrawer open={notifOpen} onOpenChange={setNotifOpen} />
      <InitialAdminSetupDialog
        open={showInitialSetupDialog}
        settings={settings}
        onCompleted={() => setSetupCompletedInSession(true)}
      />
    </div>
  );
}
