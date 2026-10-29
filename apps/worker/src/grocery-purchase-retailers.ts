/** Shared, bounded retailer names for purchase scenarios only. */
export const purchaseScenarioRetailers = ["Walmart", "Costco", "Fresh St. Market", "Save-On-Foods"] as const;
export type PurchaseScenarioRetailer = typeof purchaseScenarioRetailers[number];
export function purchaseRetailerName(name: string): PurchaseScenarioRetailer | "" {
  if (/^walmart\b/i.test(name)) return "Walmart";
  if (/^costco\b/i.test(name)) return "Costco";
  if (/^fresh\s*(?:st\.?|street)(?:\s*market)?\b/i.test(name)) return "Fresh St. Market";
  if (/^save[\s-]*on[\s-]*foods?\b/i.test(name)) return "Save-On-Foods";
  return "";
}
