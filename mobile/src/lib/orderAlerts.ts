/**
 * "New order" alerts: the socket hands each order placed on your ad to the full-screen alert.
 * A tiny listener set so the store doesn't need to know about the UI.
 */
export type OrderAlert = {
  id: string;
  ref: string;
  product: string;
  qty: number;
  amount: number; // rupees
  buyerName: string;
  paymentMethod: string;
  expiresAt: number; // ms epoch, pay-by time
  at: number; // ms epoch
};

const listeners = new Set<(o: OrderAlert) => void>();

export function subscribeOrderAlerts(fn: (o: OrderAlert) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitOrderAlert(o: OrderAlert) {
  if (!o?.id) return;
  listeners.forEach((fn) => fn(o));
}
