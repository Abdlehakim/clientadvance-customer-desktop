export function formatTND(n: number): string {
  return `${n.toFixed(3).replace(",", ".")} TND`;
}
export function formatDateFR(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("fr-FR");
}
export function formatDateTimeFR(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("fr-FR"),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}
