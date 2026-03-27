export type MailboxProvider = "gmail" | "imap";

export type MailboxThreadCategory =
  | "priority"
  | "calendar"
  | "follow_up"
  | "promotions"
  | "updates"
  | "personal"
  | "other";

export type MailboxPriorityBand = "critical" | "high" | "medium" | "low";

export type MailboxProposalType =
  | "reply"
  | "archive"
  | "trash"
  | "mark_read"
  | "label"
  | "schedule"
  | "follow_up"
  | "cleanup";

export type MailboxProposalStatus = "suggested" | "approved" | "applied" | "dismissed";

export type MailboxCommitmentState = "suggested" | "accepted" | "done" | "dismissed";

export type MailboxDirection = "incoming" | "outgoing";

export interface MailboxParticipant {
  name?: string;
  email: string;
}

export interface MailboxAccount {
  id: string;
  provider: MailboxProvider;
  address: string;
  displayName?: string;
  status: "connected" | "degraded" | "disconnected";
  capabilities: string[];
  lastSyncedAt?: number;
}

export interface MailboxSyncStatus {
  connected: boolean;
  primaryProvider?: MailboxProvider;
  accounts: MailboxAccount[];
  lastSyncedAt?: number;
  syncInFlight: boolean;
  threadCount: number;
  unreadCount: number;
  needsReplyCount: number;
  proposalCount: number;
  commitmentCount: number;
  statusLabel: string;
}

export interface MailboxSummaryCard {
  summary: string;
  keyAsks: string[];
  extractedQuestions: string[];
  suggestedNextAction: string;
  confidence: number;
  updatedAt: number;
}

export interface MailboxDraftSuggestion {
  id: string;
  threadId: string;
  subject: string;
  body: string;
  tone: string;
  rationale: string;
  scheduleNotes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MailboxActionProposal {
  id: string;
  threadId: string;
  type: MailboxProposalType;
  title: string;
  reasoning: string;
  preview?: Record<string, unknown>;
  status: MailboxProposalStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MailboxCommitment {
  id: string;
  threadId: string;
  messageId?: string;
  title: string;
  dueAt?: number;
  state: MailboxCommitmentState;
  ownerEmail?: string;
  sourceExcerpt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MailboxContactMemory {
  id: string;
  accountId: string;
  email: string;
  name?: string;
  company?: string;
  role?: string;
  crmLinks: string[];
  learnedFacts: string[];
  responseTendency?: string;
  lastInteractionAt?: number;
  openCommitments: number;
}

export interface MailboxMessage {
  id: string;
  threadId: string;
  providerMessageId: string;
  direction: MailboxDirection;
  from?: MailboxParticipant;
  to: MailboxParticipant[];
  cc: MailboxParticipant[];
  bcc: MailboxParticipant[];
  subject: string;
  snippet: string;
  body: string;
  receivedAt: number;
  unread: boolean;
}

export interface MailboxThreadListItem {
  id: string;
  accountId: string;
  provider: MailboxProvider;
  providerThreadId: string;
  subject: string;
  snippet: string;
  participants: MailboxParticipant[];
  labels: string[];
  category: MailboxThreadCategory;
  priorityBand: MailboxPriorityBand;
  priorityScore: number;
  urgencyScore: number;
  needsReply: boolean;
  staleFollowup: boolean;
  cleanupCandidate: boolean;
  handled: boolean;
  unreadCount: number;
  messageCount: number;
  lastMessageAt: number;
  summary?: MailboxSummaryCard;
}

export interface MailboxResearchResult {
  primaryContact: MailboxParticipant | null;
  company?: string;
  domain?: string;
  crmHints: string[];
  learnedFacts: string[];
  recommendedQueries: string[];
}

export interface MailboxThreadDetail extends MailboxThreadListItem {
  messages: MailboxMessage[];
  drafts: MailboxDraftSuggestion[];
  proposals: MailboxActionProposal[];
  commitments: MailboxCommitment[];
  contactMemory?: MailboxContactMemory | null;
  research?: MailboxResearchResult | null;
}

export interface MailboxListThreadsInput {
  query?: string;
  category?: MailboxThreadCategory | "all";
  needsReply?: boolean;
  cleanupCandidate?: boolean;
  limit?: number;
}

export interface MailboxSyncResult {
  accounts: MailboxAccount[];
  syncedThreads: number;
  syncedMessages: number;
  lastSyncedAt: number;
}

export interface MailboxDraftOptions {
  tone?: "concise" | "warm" | "direct" | "executive";
  includeAvailability?: boolean;
}

export interface MailboxBulkReviewInput {
  type: "cleanup" | "follow_up";
  limit?: number;
}

export interface MailboxBulkReviewResult {
  type: "cleanup" | "follow_up";
  proposals: MailboxActionProposal[];
  count: number;
}

export interface MailboxApplyActionInput {
  proposalId?: string;
  threadId?: string;
  type:
    | "archive"
    | "trash"
    | "mark_read"
    | "label"
    | "send_draft"
    | "schedule_event"
    | "dismiss_proposal";
  label?: string;
  draftId?: string;
  commitmentId?: string;
}
