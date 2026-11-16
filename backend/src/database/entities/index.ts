import { UserEntity } from "./user.entity";
import { CompanyEntity, ContactEntity } from "./contact.entity";
import { ConversationEntity, MessageEntity } from "./conversation.entity";
import { ResellerEntity } from "./reseller.entity";
import { AssignmentEntity, RequestEntity } from "./request.entity";
import { OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity } from "./quote.entity";
import { CaseEntity, CaseEvidenceEntity, CaseHistoryEntity } from "./case.entity";
import { ActivityEntity, CounterEntity, FileEntity, ProcessedEventEntity, ReminderEntity, SavedReplyEntity, SettingsEntity } from "./misc.entity";

export * from "./user.entity";
export * from "./contact.entity";
export * from "./conversation.entity";
export * from "./reseller.entity";
export * from "./request.entity";
export * from "./quote.entity";
export * from "./case.entity";
export * from "./misc.entity";

export const ENTITIES = [
  UserEntity, CompanyEntity, ContactEntity, ConversationEntity, MessageEntity, ResellerEntity, RequestEntity, AssignmentEntity,
  QuoteEntity, QuoteRevisionEntity, OrderEntity, OrderHistoryEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity,
  ActivityEntity, SavedReplyEntity, ReminderEntity, SettingsEntity, FileEntity, ProcessedEventEntity, CounterEntity,
];
