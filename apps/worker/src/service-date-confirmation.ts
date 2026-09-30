import type { Invoice } from "./invoice-model.js";

export type ServiceDateConfirmations = Record<string, { date: string; at: string }>;

/** Manual evidence overlays extraction without replacing the original source record. */
export function withConfirmedServiceDates(items: Invoice[], confirmations: ServiceDateConfirmations = {}): Invoice[] {
  return items.map(item => {
    const confirmed = confirmations[item.Id];
    return !confirmed ? item : { ...item, ServiceDate: confirmed.date,
      Healthcare: { ...item.Healthcare, ServiceDate: confirmed.date,
        FieldStates: { ...item.Healthcare?.FieldStates, ServiceDate: "confirmed" },
        FieldSources: { ...item.Healthcare?.FieldSources, ServiceDate: "manual" } } };
  });
}

export function multipleServiceDates(item: Invoice): boolean {
  return /multiple service dates/i.test([item.ImportWarning, ...(item.Healthcare?.Conflicts || [])].join(" "));
}
