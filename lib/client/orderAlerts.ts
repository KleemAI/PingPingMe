/** "p2p_order" from the socket: someone placed an order on one of your P2P ads. Sent only to the ad owner. */
export type NewOrder = {
  id: string; // order id
  ref: string; // "P2P-1001"
  product: string;
  qty: number;
  amount: number; // rupees
  buyerName: string; // who placed it
  paymentMethod: string;
  expiresAt: number; // ms epoch, pay-by time
  at: number; // ms epoch
};

type Listener = (o: NewOrder) => void;
const listeners = new Set<Listener>();

/** The store's socket emits here; NewOrderAlert listens. Returns an unsubscribe function. */
export function subscribeOrders(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitOrder(o: NewOrder) {
  if (!o?.id) return; // a malformed payload would open an empty alert
  listeners.forEach((fn) => fn(o));
}
