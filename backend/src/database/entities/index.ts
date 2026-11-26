import { EmailCodeEntity, UserEntity } from "./user.entity";
import { CompanyEntity, ContactEntity } from "./contact.entity";
import { ConversationEntity, MessageEntity } from "./conversation.entity";
import { ResellerEntity } from "./reseller.entity";
import { AssignmentEntity, RequestEntity } from "./request.entity";
import { OrderEntity, OrderHistoryEntity, QuoteEntity, QuoteRevisionEntity } from "./quote.entity";
import { CaseEntity, CaseEvidenceEntity, CaseHistoryEntity } from "./case.entity";
import { ProductEntity } from "./product.entity";
import { P2PAdEntity, P2PMessageEntity, P2POrderEntity, P2PProfileEntity } from "./p2p.entity";
import { BroadcastEntity } from "./broadcast.entity";
import { TaskEntity, TaskListEntity } from "./task.entity";
import { SessionEntity } from "./session.entity";
import { BlockEntity, CommunityEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity, GroupMessageViewEntity, PersonalChatEntity, PersonalMessageEntity } from "./people.entity";
import { PushTokenEntity } from "./push.entity";
import { CallEntity } from "./call.entity";
import { ActivityEntity, CounterEntity, FileEntity, ProcessedEventEntity, ReminderEntity, SavedReplyEntity, SettingsEntity } from "./misc.entity";

export * from "./user.entity";
export * from "./contact.entity";
export * from "./conversation.entity";
export * from "./reseller.entity";
export * from "./request.entity";
export * from "./quote.entity";
export * from "./case.entity";
export * from "./misc.entity";
export * from "./product.entity";
export * from "./p2p.entity";
export * from "./broadcast.entity";
export * from "./task.entity";
export * from "./session.entity";
export * from "./people.entity";
export * from "./push.entity";
export * from "./call.entity";

export const ENTITIES = [
  UserEntity, EmailCodeEntity, CompanyEntity, ContactEntity, ConversationEntity, MessageEntity, ResellerEntity, RequestEntity, AssignmentEntity,
  QuoteEntity, QuoteRevisionEntity, OrderEntity, OrderHistoryEntity, CaseEntity, CaseEvidenceEntity, CaseHistoryEntity,
  ActivityEntity, SavedReplyEntity, ReminderEntity, SettingsEntity, FileEntity, ProcessedEventEntity, CounterEntity, ProductEntity,
  P2PAdEntity, P2POrderEntity, P2PMessageEntity, P2PProfileEntity, BroadcastEntity, TaskEntity, TaskListEntity, SessionEntity, PersonalChatEntity, PersonalMessageEntity, PushTokenEntity, GroupChatEntity, GroupMemberEntity, GroupMessageEntity, GroupMessageViewEntity, CommunityEntity, BlockEntity, CallEntity,
];
