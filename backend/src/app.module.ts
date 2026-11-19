import { Module } from "@nestjs/common";
import { SecurityModule } from "./security/security.module";
import { APP_FILTER } from "@nestjs/core";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { FilesModule } from "./files/files.module";
import { ChannelModule } from "./channel/channel.module";
import { RealtimeGateway } from "./realtime/realtime.gateway";
import { ConversationsService } from "./conversations/conversations.service";
import { ConversationsController, MessagesController } from "./conversations/conversations.controller";
import { ContactsService } from "./contacts/contacts.service";
import { ContactsController } from "./contacts/contacts.controller";
import { RequestsService } from "./requests/requests.service";
import { RequestsController } from "./requests/requests.controller";
import { ResellersService } from "./resellers/resellers.service";
import { ResellersController } from "./resellers/resellers.controller";
import { QuotesService } from "./orders/quotes.service";
import { OrdersService } from "./orders/orders.service";
import { ExportService } from "./orders/export.service";
import { ExportController, OrdersController, QuotesController } from "./orders/orders.controller";
import { CasesService } from "./cases/cases.service";
import { CasesController } from "./cases/cases.controller";
import { WorkspaceService } from "./workspace/workspace.service";
import { WorkspaceController } from "./workspace/workspace.controller";
import { SettingsService } from "./settings/settings.service";
import { SettingsController } from "./settings/settings.controller";
import { UsersService } from "./users/users.service";
import { CustomersController, UsersController } from "./users/users.controller";
import { PortalService } from "./portal/portal.service";
import { PortalController } from "./portal/portal.controller";
import { StateService } from "./state/state.service";
import { P2PService } from "./p2p/p2p.service";
import { CatalogService } from "./catalog/catalog.service";
import { BroadcastsService } from "./broadcasts/broadcasts.service";
import { TasksService } from "./tasks/tasks.service";
import { CustomerService } from "./customer/customer.service";
import { P2PController } from "./p2p/p2p.controller";
import { QueryService } from "./state/query.service";
import { ActionsService } from "./state/actions.service";
import { StateController } from "./state/state.controller";
import { OpsController } from "./ops/ops.controller";

/**
 * Infrastructure modules are global (database, auth, audit, files, channel).
 * Domain services are registered here because the command endpoint (/actions) composes all of them.
 */
@Module({
  imports: [
    DatabaseModule,
    SecurityModule,
    AuthModule,
    AuditModule,
    FilesModule,
    ChannelModule,
  ],
  controllers: [
    StateController, ConversationsController, MessagesController, ContactsController, RequestsController, ResellersController,
    QuotesController, OrdersController, ExportController, CasesController, WorkspaceController, SettingsController,
    UsersController, CustomersController, PortalController, OpsController, P2PController,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    RealtimeGateway,
    ConversationsService, ContactsService, RequestsService, ResellersService, QuotesService, OrdersService, ExportService,
    CasesService, WorkspaceService, SettingsService, UsersService, PortalService, StateService, QueryService, ActionsService, P2PService, CatalogService, CustomerService, BroadcastsService, TasksService,
  ],
})
export class AppModule {}
