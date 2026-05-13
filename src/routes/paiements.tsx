import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Printer, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PaymentFormDialog } from "@/components/PaymentFormDialog";
import { PaymentNotificationStatusBadge } from "@/components/PaymentNotificationStatusBadge";
import { PaymentSyncStatusBadge } from "@/components/PaymentSyncStatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Client, Payment } from "@/domain/types";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  getAllPayments,
  formatDateFR,
  formatTND,
  getAdminSettings,
  getClientReferenceById,
  getCurrentUser,
  getLocalSyncStatus,
  getPaymentNotificationStatusMap,
  getPaymentNotificationStatuses,
  getPayments,
  getServerSyncStatus,
  deletePayment,
  isAdmin,
} from "@/lib/data";
import { formatTunisianPhoneForDisplay } from "@/lib/tunisianPhone";
import { useAppData } from "@/lib/useAppData";
import type {
  LocalPaymentSyncDisplayStatus,
  ServerPaymentSyncDisplayStatus,
} from "@/services/appServices";
import type { PaymentNotificationDisplayStatus } from "@/services/paymentNotificationService";

export const Route = createFileRoute("/paiements")({ component: PaymentsPage });

const NOTIFICATION_STATUS_LABELS: Record<PaymentNotificationDisplayStatus, string> = {
  sent: "Envoyé",
  queued: "En attente",
  sending: "En cours",
  failed: "Échec",
  "not-created": "N.C",
  "not-applicable": "N.A",
};

const SYNC_STATUS_LABELS: Record<
  LocalPaymentSyncDisplayStatus | ServerPaymentSyncDisplayStatus,
  string
> = {
  "saved-local": "Eng.L",
  "failed-local": "Échec local",
  synced: "Synchronisé",
  pending: "En attente",
  failed: "Échec",
  "not-applicable": "N.A",
};

interface PaymentReceiptData {
  clientName: string | null | undefined;
  clientPhone: string | null | undefined;
  clientEmail: string | null | undefined;
  clientCin: string | null | undefined;
  amountPaid: number;
  paymentDate: string;
  paymentTime: string;
  createdBy: string;
  totalPaidToDate: number;
}

const PAYMENT_RECEIPT_PRINT_FRAME_ID = "payment-receipt-print-frame";
const PAYMENT_RECEIPT_PRINT_ERROR_TOAST =
  "Impossible d'imprimer le re\u00e7u de paiement.";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatReceiptValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return "&#8212;";
  }

  const normalized = value.trim();
  return normalized.length > 0 ? escapeHtml(normalized) : "&#8212;";
}

function getClientTotalPaidToDate(clientId: string, payments: Payment[]) {
  return payments
    .filter((payment) => payment.client_id === clientId)
    .reduce((total, payment) => total + payment.montant, 0);
}

function buildReceiptHtml(receipt: PaymentReceiptData) {
  const fields = [
    ["Client", formatReceiptValue(receipt.clientName)],
    ["T\u00e9l\u00e9phone", formatReceiptValue(receipt.clientPhone)],
    ["Email", formatReceiptValue(receipt.clientEmail)],
    ["CIN", formatReceiptValue(receipt.clientCin)],
    ["Montant pay\u00e9", escapeHtml(formatTND(receipt.amountPaid))],
    ["Total pay\u00e9 \u00e0 ce jour", escapeHtml(formatTND(receipt.totalPaidToDate))],
    ["Date", escapeHtml(formatDateFR(receipt.paymentDate))],
    ["Heure", formatReceiptValue(receipt.paymentTime)],
    ["Enregistr\u00e9 par", formatReceiptValue(receipt.createdBy)],
  ];

  const rows = fields
    .map(
      ([label, value]) => `
        <tr>
          <th scope="row">${escapeHtml(label)}</th>
          <td>${value}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Re\u00e7u de paiement</title>
    <style>
      @page {
        size: A4 portrait;
        margin: 16mm;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        color: #000000;
        font-family: Arial, Helvetica, sans-serif;
      }

      body {
        min-height: 100vh;
      }

      @media print {
        html,
        body {
          width: 210mm;
          min-height: 297mm;
        }
      }

      .receipt {
        width: 100%;
        max-width: 100%;
        margin: 0 auto;
        border: 1px solid #000000;
        padding: 12mm;
      }

      .receipt-header {
        margin-bottom: 8mm;
        padding-bottom: 5mm;
        border-bottom: 1px solid #000000;
      }

      .receipt-title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .receipt-subtitle {
        margin: 3mm 0 0;
        font-size: 12px;
      }

      .receipt-table {
        width: 100%;
        border-collapse: collapse;
      }

      .receipt-table th,
      .receipt-table td {
        padding: 3.25mm 0;
        border-bottom: 1px solid #d4d4d4;
        font-size: 12px;
        text-align: left;
        vertical-align: top;
      }

      .receipt-table th {
        width: 42%;
        padding-right: 6mm;
        font-weight: 700;
      }

      .receipt-footer {
        margin-top: 8mm;
        padding-top: 5mm;
        border-top: 1px solid #000000;
        font-size: 11px;
        text-align: center;
        letter-spacing: 0.03em;
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <header class="receipt-header">
        <h1 class="receipt-title">Re\u00e7u de paiement</h1>
        <p class="receipt-subtitle">ClientAdvance</p>
      </header>
      <table class="receipt-table" aria-label="D\u00e9tails du paiement">
        <tbody>
          ${rows}
        </tbody>
      </table>
      <footer class="receipt-footer">ClientAdvance</footer>
    </main>
  </body>
</html>`;
}

function removePaymentReceiptPrintFrame() {
  const existingFrame = document.getElementById(PAYMENT_RECEIPT_PRINT_FRAME_ID);

  if (existingFrame instanceof HTMLIFrameElement) {
    existingFrame.remove();
  }
}

function printPaymentReceipt(receipt: PaymentReceiptData) {
  try {
    removePaymentReceiptPrintFrame();

    const iframe = document.createElement("iframe");
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      iframe.remove();
    };

    const handleFailure = () => {
      cleanup();
      toast.error(PAYMENT_RECEIPT_PRINT_ERROR_TOAST);
    };

    iframe.id = PAYMENT_RECEIPT_PRINT_FRAME_ID;
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";

    const loadTimeout = window.setTimeout(handleFailure, 5000);

    iframe.addEventListener(
      "load",
      () => {
        window.clearTimeout(loadTimeout);

        const printWindow = iframe.contentWindow;

        if (!printWindow || !iframe.contentDocument) {
          handleFailure();
          return;
        }

        const cleanupTimeout = window.setTimeout(cleanup, 60000);

        printWindow.addEventListener(
          "afterprint",
          () => {
            window.clearTimeout(cleanupTimeout);
            cleanup();
          },
          { once: true },
        );

        try {
          printWindow.focus();
          printWindow.requestAnimationFrame(() => {
            printWindow.setTimeout(() => {
              try {
                printWindow.print();
              } catch {
                window.clearTimeout(cleanupTimeout);
                handleFailure();
              }
            }, 150);
          });
        } catch {
          window.clearTimeout(cleanupTimeout);
          handleFailure();
        }
      },
      { once: true },
    );

    iframe.srcdoc = buildReceiptHtml(receipt);
    document.body.appendChild(iframe);
  } catch {
    toast.error(PAYMENT_RECEIPT_PRINT_ERROR_TOAST);
  }
}

function PaymentsPage() {
  useAppData();
  const mounted = useHasMounted();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Payment | null>(null);

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const payments = getPayments().filter((payment) => {
    if (!q) {
      return true;
    }

    const client = getClientReferenceById(payment.client_id);
    return client?.nom_complet.toLowerCase().includes(q.toLowerCase());
  });
  const settings = getAdminSettings();
  const notificationStatusMap = getPaymentNotificationStatusMap();
  const allPayments = getAllPayments();
  const canDeletePayments = isAdmin(getCurrentUser());

  const onPrintPayment = (
    payment: Payment,
    client: Client | null,
  ) => {
    printPaymentReceipt({
      clientName: client?.nom_complet,
      clientPhone: client
        ? formatTunisianPhoneForDisplay(client.telephone) || client.telephone
        : null,
      clientEmail: client?.email,
      clientCin: client?.cin,
      amountPaid: payment.montant,
      paymentDate: payment.date_paiement,
      paymentTime: payment.heure_paiement,
      createdBy: payment.created_by,
      totalPaidToDate: getClientTotalPaidToDate(payment.client_id, allPayments),
    });
  };

  const onDeletePayment = async () => {
    if (!toDelete) {
      return;
    }

    try {
      await deletePayment(toDelete.id);
      toast.success("Paiement supprimé.");
      setToDelete(null);
    } catch {
      toast.error("Impossible de supprimer le paiement.");
    }
  };

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Paiements</h1>
          <p className="text-sm text-muted-foreground">
            Historique de tous les paiements
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Ajouter un paiement
        </Button>
      </div>

      <Card className="p-4 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrer par client..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Heure</TableHead>
                <TableHead>{"Enregistr\u00e9 par"}</TableHead>
                <TableHead>S.E</TableHead>
                <TableHead>S.W</TableHead>
                <TableHead>Syn.L</TableHead>
                <TableHead>Syn.S</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                    Aucun paiement.
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => {
                  const client = getClientReferenceById(payment.client_id);
                  const localSyncStatus = getLocalSyncStatus(payment);
                  const notificationStatuses = getPaymentNotificationStatuses(
                    payment.id,
                    notificationStatusMap,
                  );
                  const serverSyncStatus = getServerSyncStatus(payment, settings);

                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        {client?.nom_complet ?? "\u2014"}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatTND(payment.montant)}
                      </TableCell>
                      <TableCell>{formatDateFR(payment.date_paiement)}</TableCell>
                      <TableCell>{payment.heure_paiement}</TableCell>
                      <TableCell>{payment.created_by}</TableCell>
                      <TableCell>
                        <PaymentNotificationStatusBadge status={notificationStatuses.email} />
                      </TableCell>
                      <TableCell>
                        <PaymentNotificationStatusBadge
                          status={notificationStatuses.whatsapp}
                        />
                      </TableCell>
                      <TableCell>
                        <PaymentSyncStatusBadge status={localSyncStatus} />
                      </TableCell>
                      <TableCell>
                        <PaymentSyncStatusBadge status={serverSyncStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <TooltipProvider delayDuration={100}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title="Imprimer le paiement"
                                aria-label="Imprimer le paiement"
                                onClick={() => onPrintPayment(payment, client)}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Imprimer le paiement</TooltipContent>
                          </Tooltip>
                          {canDeletePayments ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  title="Supprimer le paiement"
                                  aria-label="Supprimer le paiement"
                                  onClick={() => setToDelete(payment)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Supprimer le paiement</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </TooltipProvider>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <PaymentFormDialog open={open} onOpenChange={setOpen} />
      <AlertDialog open={!!toDelete} onOpenChange={(value) => !value && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce paiement ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Le paiement sélectionné sera supprimé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDeletePayment()}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
