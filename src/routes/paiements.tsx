import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Printer, RefreshCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { DatePickerInput } from "@/components/DatePickerInput";
import { PaymentFormDialog } from "@/components/PaymentFormDialog";
import { PaymentNotificationStatusBadge } from "@/components/PaymentNotificationStatusBadge";
import { PaymentSyncStatusBadge } from "@/components/PaymentSyncStatusBadge";
import { APP_INPUT_WITH_LEFT_ICON_CLASS_NAME } from "@/components/inputStyles";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

interface PaymentListPrintRow {
  clientName: string | null | undefined;
  amountPaid: number;
  paymentDate: string;
  paymentTime: string;
  createdBy: string;
  emailStatus: string;
  whatsappStatus: string;
  localSyncStatus: string;
  serverSyncStatus: string;
}

interface PaymentListPrintFilter {
  label: string;
  value: string;
}

interface PaymentListPrintData {
  filters: PaymentListPrintFilter[];
  payments: PaymentListPrintRow[];
}

interface PaymentListPrintFilterInput {
  clientSearch: string;
  periodSelection: PaymentPeriodSelection;
  from: string;
  to: string;
}

const PAYMENT_RECEIPT_PRINT_FRAME_ID = "payment-receipt-print-frame";
const PAYMENT_RECEIPT_PRINT_ERROR_TOAST = "Impossible d'imprimer le re\u00e7u de paiement.";
const PAYMENT_LIST_PRINT_FRAME_ID = "payment-list-print-frame";
const PAYMENT_LIST_PRINT_ERROR_TOAST = "Impossible d'imprimer la liste des paiements.";

type PaymentPeriodSelection =
  | "all"
  | "today"
  | "this-month"
  | "last-month"
  | "this-year"
  | "last-year"
  | "custom";

interface DateRange {
  from: string;
  to: string;
}

const PAYMENT_PERIOD_OPTIONS: Array<{ value: PaymentPeriodSelection; label: string }> = [
  { value: "all", label: "Toutes les périodes" },
  { value: "today", label: "Aujourd'hui" },
  { value: "this-month", label: "Ce mois" },
  { value: "last-month", label: "Mois dernier" },
  { value: "this-year", label: "Cette année" },
  { value: "last-year", label: "L'année dernière" },
  { value: "custom", label: "Par dates" },
];

function toLocalDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getPresetDateRange(selection: PaymentPeriodSelection): DateRange | null {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  switch (selection) {
    case "today":
      return {
        from: toLocalDateValue(today),
        to: toLocalDateValue(today),
      };
    case "this-month":
      return {
        from: toLocalDateValue(new Date(year, month, 1)),
        to: toLocalDateValue(new Date(year, month + 1, 0)),
      };
    case "last-month":
      return {
        from: toLocalDateValue(new Date(year, month - 1, 1)),
        to: toLocalDateValue(new Date(year, month, 0)),
      };
    case "this-year":
      return {
        from: toLocalDateValue(new Date(year, 0, 1)),
        to: toLocalDateValue(new Date(year, 11, 31)),
      };
    case "last-year":
      return {
        from: toLocalDateValue(new Date(year - 1, 0, 1)),
        to: toLocalDateValue(new Date(year - 1, 11, 31)),
      };
    default:
      return null;
  }
}

function isPaymentInDateRange(payment: Payment, range: DateRange | null) {
  if (!range) {
    return true;
  }

  if (range.from && payment.date_paiement < range.from) {
    return false;
  }

  if (range.to && payment.date_paiement > range.to) {
    return false;
  }

  return true;
}

function getPaymentPeriodLabel(selection: PaymentPeriodSelection) {
  return PAYMENT_PERIOD_OPTIONS.find((option) => option.value === selection)?.label ?? "";
}

function buildPaymentListFilterSummary(input: PaymentListPrintFilterInput) {
  const filters: PaymentListPrintFilter[] = [];
  const clientSearch = input.clientSearch.trim();

  if (clientSearch) {
    filters.push({ label: "Client", value: clientSearch });
  }

  if (input.periodSelection !== "all") {
    filters.push({ label: "S\u00e9lection", value: getPaymentPeriodLabel(input.periodSelection) });

    if (input.from) {
      filters.push({ label: "Du", value: formatDateFR(input.from) });
    }

    if (input.to) {
      filters.push({ label: "Au", value: formatDateFR(input.to) });
    }
  }

  return filters;
}

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
        <p class="receipt-subtitle">ClientAdvans</p>
      </header>
      <table class="receipt-table" aria-label="D\u00e9tails du paiement">
        <tbody>
          ${rows}
        </tbody>
      </table>
      <footer class="receipt-footer">ClientAdvans</footer>
    </main>
  </body>
</html>`;
}

function buildPaymentListHtml(data: PaymentListPrintData) {
  const filterItems = data.filters
    .map(
      (filter) => `
        <div class="filter-item">
          <dt>${escapeHtml(filter.label)}</dt>
          <dd>${escapeHtml(filter.value)}</dd>
        </div>`,
    )
    .join("");

  const filterSummary = filterItems
    ? `
      <section class="filters" aria-label="Filtres appliqu\u00e9s">
        <h2>Filtres</h2>
        <dl class="filter-grid">
          ${filterItems}
        </dl>
      </section>`
    : "";

  const rows = data.payments
    .map(
      (payment) => `
        <tr>
          <td>${formatReceiptValue(payment.clientName)}</td>
          <td class="amount">${escapeHtml(formatTND(payment.amountPaid))}</td>
          <td>${escapeHtml(formatDateFR(payment.paymentDate))}</td>
          <td>${formatReceiptValue(payment.paymentTime)}</td>
          <td>${formatReceiptValue(payment.createdBy)}</td>
          <td>${formatReceiptValue(payment.emailStatus)}</td>
          <td>${formatReceiptValue(payment.whatsappStatus)}</td>
          <td>${formatReceiptValue(payment.localSyncStatus)}</td>
          <td>${formatReceiptValue(payment.serverSyncStatus)}</td>
        </tr>`,
    )
    .join("");

  const content =
    data.payments.length === 0
      ? `<p class="empty">Aucun paiement.</p>`
      : `
      <table class="payment-table" aria-label="Liste des paiements">
        <thead>
          <tr>
            <th scope="col">Client</th>
            <th scope="col">Montant</th>
            <th scope="col">Date</th>
            <th scope="col">Heure</th>
            <th scope="col">Enregistr\u00e9 par</th>
            <th scope="col">S.E</th>
            <th scope="col">S.W</th>
            <th scope="col">Syn.L</th>
            <th scope="col">Syn.S</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Liste des paiements</title>
    <style>
      @page {
        size: A4 landscape;
        margin: 12mm;
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

      .payment-list {
        width: 100%;
        max-width: 100%;
        margin: 0 auto;
      }

      .payment-list-header {
        margin-bottom: 7mm;
        padding-bottom: 4mm;
        border-bottom: 1px solid #000000;
      }

      .payment-list-title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      .filters {
        margin-bottom: 6mm;
      }

      .filters h2 {
        margin: 0 0 3mm;
        font-size: 12px;
        font-weight: 700;
      }

      .filter-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(36mm, 1fr));
        gap: 2mm 5mm;
        margin: 0;
      }

      .filter-item {
        min-width: 0;
      }

      .filter-item dt {
        margin: 0 0 1mm;
        color: #475569;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
      }

      .filter-item dd {
        margin: 0;
        font-size: 11px;
      }

      .payment-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .payment-table th,
      .payment-table td {
        border: 1px solid #d4d4d4;
        padding: 2mm;
        font-size: 10px;
        line-height: 1.35;
        text-align: left;
        vertical-align: top;
        word-break: break-word;
      }

      .payment-table th {
        background: #f1f5f9;
        font-weight: 700;
      }

      .payment-table .amount {
        text-align: right;
        white-space: nowrap;
      }

      .empty {
        margin: 8mm 0 0;
        padding: 6mm;
        border: 1px solid #d4d4d4;
        text-align: center;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main class="payment-list">
      <header class="payment-list-header">
        <h1 class="payment-list-title">Liste des paiements</h1>
      </header>
      ${filterSummary}
      ${content}
    </main>
  </body>
</html>`;
}

function removePrintFrame(frameId: string) {
  const existingFrame = document.getElementById(frameId);

  if (existingFrame instanceof HTMLIFrameElement) {
    existingFrame.remove();
  }
}

function printHtmlDocument(frameId: string, html: string, errorToast: string) {
  try {
    removePrintFrame(frameId);

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
      toast.error(errorToast);
    };

    iframe.id = frameId;
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

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  } catch {
    toast.error(errorToast);
  }
}

function printPaymentReceipt(receipt: PaymentReceiptData) {
  printHtmlDocument(
    PAYMENT_RECEIPT_PRINT_FRAME_ID,
    buildReceiptHtml(receipt),
    PAYMENT_RECEIPT_PRINT_ERROR_TOAST,
  );
}

function printFilteredPaymentList(data: PaymentListPrintData) {
  printHtmlDocument(
    PAYMENT_LIST_PRINT_FRAME_ID,
    buildPaymentListHtml(data),
    PAYMENT_LIST_PRINT_ERROR_TOAST,
  );
}

function PaymentsPage() {
  useAppData();
  const mounted = useHasMounted();
  const [q, setQ] = useState("");
  const [periodSelection, setPeriodSelection] = useState<PaymentPeriodSelection>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Payment | null>(null);

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const presetDateRange = getPresetDateRange(periodSelection);
  const activeDateRange =
    periodSelection === "custom" ? { from: customFrom, to: customTo } : presetDateRange;
  const displayedFrom = periodSelection === "custom" ? customFrom : (presetDateRange?.from ?? "");
  const displayedTo = periodSelection === "custom" ? customTo : (presetDateRange?.to ?? "");
  const usesCustomDates = periodSelection === "custom";
  const normalizedSearch = q.trim().toLowerCase();
  const payments = getPayments().filter((payment) => {
    const client = getClientReferenceById(payment.client_id);
    const matchesClient =
      !normalizedSearch || client?.nom_complet.toLowerCase().includes(normalizedSearch);

    return matchesClient && isPaymentInDateRange(payment, activeDateRange);
  });
  const settings = getAdminSettings();
  const notificationStatusMap = getPaymentNotificationStatusMap();
  const allPayments = getAllPayments();
  const currentUser = getCurrentUser();
  const isAdminUser = isAdmin(currentUser);
  const canDeletePayments = isAdminUser;

  const onPeriodSelectionChange = (value: PaymentPeriodSelection) => {
    setPeriodSelection(value);
  };

  const resetPaymentFilters = () => {
    setQ("");
    setPeriodSelection("all");
    setCustomFrom("");
    setCustomTo("");
  };

  const onPrintFilteredPayments = () => {
    printFilteredPaymentList({
      filters: buildPaymentListFilterSummary({
        clientSearch: q,
        periodSelection,
        from: displayedFrom,
        to: displayedTo,
      }),
      payments: payments.map((payment) => {
        const notificationStatuses = getPaymentNotificationStatuses(
          payment.id,
          notificationStatusMap,
        );
        const localSyncStatus = getLocalSyncStatus(payment);
        const serverSyncStatus = getServerSyncStatus(payment, settings);

        return {
          clientName: getClientReferenceById(payment.client_id)?.nom_complet,
          amountPaid: payment.montant,
          paymentDate: payment.date_paiement,
          paymentTime: payment.heure_paiement,
          createdBy: payment.created_by,
          emailStatus: NOTIFICATION_STATUS_LABELS[notificationStatuses.email],
          whatsappStatus: NOTIFICATION_STATUS_LABELS[notificationStatuses.whatsapp],
          localSyncStatus: SYNC_STATUS_LABELS[localSyncStatus],
          serverSyncStatus: SYNC_STATUS_LABELS[serverSyncStatus],
        };
      }),
    });
  };

  const onPrintPayment = (payment: Payment, client: Client | null) => {
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
          <p className="text-sm text-muted-foreground">Historique de tous les paiements</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Ajouter un paiement
        </Button>
      </div>

      <Card className="p-4 shadow-card">
        <div
          className={
            isAdminUser
              ? "mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.35fr)_minmax(180px,0.95fr)_minmax(150px,0.8fr)_minmax(150px,0.8fr)_auto_auto]"
              : "mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(220px,1fr)_auto]"
          }
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filtrer par client..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className={APP_INPUT_WITH_LEFT_ICON_CLASS_NAME}
            />
          </div>

          {isAdminUser ? (
            <>
              <div className="space-y-1.5">
                <Label>Selection</Label>
                <Select
                  value={periodSelection}
                  onValueChange={(value) =>
                    onPeriodSelectionChange(value as PaymentPeriodSelection)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selection" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_PERIOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-date-from">Du</Label>
                <DatePickerInput
                  id="payment-date-from"
                  value={displayedFrom}
                  onChange={setCustomFrom}
                  disabled={!usesCustomDates}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-date-to">Au</Label>
                <DatePickerInput
                  id="payment-date-to"
                  value={displayedTo}
                  onChange={setCustomTo}
                  disabled={!usesCustomDates}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-[42px] w-full justify-between gap-3 rounded-[4px] border-[#cfd6e1] bg-background px-3 text-sm font-medium text-[#0b1220] shadow-none hover:border-[#7c3aed] hover:bg-[#f8fafc] sm:w-auto"
                onClick={resetPaymentFilters}
              >
                <span>Réinitialiser</span>
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </>
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-[42px] w-[42px] rounded-full border-[#cfd6e1] bg-background text-[#0b1220] shadow-sm hover:border-[#7c3aed] hover:bg-[#f8fafc]"
            title={"Imprimer les paiements filtr\u00e9s"}
            aria-label={"Imprimer les paiements filtr\u00e9s"}
            onClick={onPrintFilteredPayments}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
          </Button>
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
                      <TableCell className="font-semibold">{formatTND(payment.montant)}</TableCell>
                      <TableCell>{formatDateFR(payment.date_paiement)}</TableCell>
                      <TableCell>{payment.heure_paiement}</TableCell>
                      <TableCell>{payment.created_by}</TableCell>
                      <TableCell>
                        <PaymentNotificationStatusBadge status={notificationStatuses.email} />
                      </TableCell>
                      <TableCell>
                        <PaymentNotificationStatusBadge status={notificationStatuses.whatsapp} />
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
            <AlertDialogAction onClick={() => void onDeletePayment()}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
