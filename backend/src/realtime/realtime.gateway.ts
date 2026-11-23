import { Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import type { Subscription } from "rxjs";
import { AuthService } from "../auth/auth.service";
import { ChangeBus } from "../database/change-bus";
import { AlertBus } from "./alerts.service";
import { UnitOfWork } from "../database/unit-of-work.service";
import { env } from "../config/env";
import { tokenFrom } from "../auth/session-cookie";
import { clientIp } from "../security/client-ip";
import { LIMITS } from "../security/limits";
import { RateLimiter } from "../security/rate-limiter.service";

/**
 * Real-time updates over Socket.IO (same port as the API).
 *
 *   const socket = io(API_URL, { auth: { token } });          // mobile / API clients
 *   const socket = io(API_URL, { withCredentials: true });    // web app (session cookie)
 *   socket.on("ready",   ({ user, version }) => …);
 *   socket.on("changed", ({ version }) => refetch GET /api/v1/state?v=<your version>);
 *   socket.on("p2p_order", (o) => …)  // someone ordered from your ad (only the ad owner gets it)
 *   socket.on("auth_error", …)  // bad/expired token → sign in again
 *
 * "changed" carries only a version number; the data itself always comes through the role-scoped API,
 * so the socket can never leak records to the wrong user.
 */
@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => cb(null, env.allowOrigin(origin)), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server: Server;
  private readonly log = new Logger("Realtime");
  private sub?: Subscription;
  private revokedSub?: Subscription;
  private alertSub?: Subscription;
  private pending?: NodeJS.Timeout;
  private latest = 0;

  constructor(private readonly auth: AuthService, private readonly bus: ChangeBus, private readonly uow: UnitOfWork, private readonly limiter: RateLimiter, private readonly alerts: AlertBus) {}

  onModuleInit() {
    // a device was signed out (Linked devices / sign-out / over the 50-device limit) → drop its live connection now
    this.revokedSub = this.auth.revoked$.subscribe((ids) => {
      for (const id of ids) {
        this.server?.to(`session:${id}`).emit("auth_error", { message: "This device was signed out — please sign in again" });
        this.server?.in(`session:${id}`).disconnectSockets(true);
      }
    });
    // personal alerts (e.g. a new P2P order) go only to that user's sockets, one by one — never coalesced
    this.alertSub = this.alerts.alerts.subscribe(({ userId, event, payload }) => {
      this.server?.to(`user:${userId}`).emit(event, payload);
    });
    // Coalesce bursts of writes into one push every ~150 ms.
    this.sub = this.bus.changes.subscribe(({ version }) => {
      this.latest = Math.max(this.latest, version);
      if (this.pending) return;
      this.pending = setTimeout(() => {
        this.pending = undefined;
        this.server?.to("users").emit("changed", { version: this.latest });
      }, 150);
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
    this.revokedSub?.unsubscribe();
    this.alertSub?.unsubscribe();
    if (this.pending) clearTimeout(this.pending);
  }

  async handleConnection(socket: Socket) {
    if (this.limiter.hit(`ws:${clientIp(socket.request)}`, LIMITS.socketPerIp)) {
      socket.emit("busy", { message: "Too many connections — try again in a minute" }); // not auth_error: that would sign the user out
      socket.disconnect(true);
      return;
    }
    try {
      // mobile/API: auth.token or Bearer header · web app: the httpOnly session cookie
      const raw = (socket.handshake.auth?.token as string | undefined) || tokenFrom({ headers: socket.handshake.headers });
      const { user, sid } = await this.auth.verifySession(raw);
      socket.data.user = user;
      await socket.join("users");
      await socket.join(`session:${sid}`); // closed at once when this device is signed out
      await socket.join(`user:${user.id}`); // personal alerts (AlertBus)
      await socket.join(user.role === "reseller" ? `reseller:${user.resellerId}` : user.role === "customer" ? `customer:${user.id}` : "team");
      socket.emit("ready", { user: { id: user.id, name: user.name, role: user.role }, version: await this.uow.version() });
    } catch (e) {
      socket.emit("auth_error", { message: (e as Error).message });
      socket.disconnect(true);
    }
  }

  handleDisconnect() { /* nothing to clean up — rooms are released automatically */ }
}
