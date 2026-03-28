export type MailboxProvider = "gmail" | "imap";

export type MailboxThreadSortOrder = "priority" | "recent";
export type MailboxThreadMailboxView = "inbox" | "sent" | "all";

export type MailboxThreadCategory =
  | "priority"
  | "calendar"
  | "follow_up"
  | "promotions"
  | "updates"
  | "personal"
  | "other";

export type MailboxClassificationState = "pending" | "backfill_pending" | "classified" | "error";

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
  classificationInitialBatchAt?: number;
}

export interface MailboxSyncStatus {
  connected: boolean;
  primaryProvider?: MailboxProvider;
  accounts: MailboxAccount[];
  lastSyncedAt?: number;
  syncInFlight: boolean;
  syncProgress?: MailboxSyncProgress | null;
  threadCount: number;
  unreadCount: number;
  needsReplyCount: number;
  proposalCount: number;
  commitmentCount: number;
  classificationPendingCount: number;
  statusLabel: string;
}

export interface MailboxSyncProgress {
  phase: "fetching" | "ingesting" | "classifying" | "done" | "error";
  accountId?: string;
  totalThreads: number;
  processedThreads: number;
  totalMessages: number;
  processedMessages: number;
  newThreads: number;
  classifiedThreads: number;
  skippedThreads: number;
  label: string;
  updatedAt: number;
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
  followUpTaskId?: string;
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
  totalThreads?: number;
  totalMessages?: number;
  averageResponseHours?: number;
  lastOutboundAt?: number;
  recentSubjects?: string[];
  styleSignals?: string[];
  recentOutboundExample?: string;
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
  bodyHtml?: string;
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
  classificationState?: MailboxClassificationState;
}

export interface MailboxResearchResult {
  primaryContact: MailboxParticipant | null;
  company?: string;
  domain?: string;
  crmHints: string[];
  learnedFacts: string[];
  recommendedQueries: string[];
  relationshipSummary?: string;
  styleSignals?: string[];
  recentSubjects?: string[];
  recentOutboundExample?: string;
  nextSteps?: string[];
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
  mailboxView?: MailboxThreadMailboxView;
  unreadOnly?: boolean;
  needsReply?: boolean;
  hasSuggestedProposal?: boolean;
  hasOpenCommitment?: boolean;
  cleanupCandidate?: boolean;
  sortBy?: MailboxThreadSortOrder;
  limit?: number;
}

export interface MailboxSyncResult {
  accounts: MailboxAccount[];
  syncedThreads: number;
  syncedMessages: number;
  lastSyncedAt: number;
}

export interface MailboxReclassifyResult {
  accountId: string;
  scannedThreads: number;
  reclassifiedThreads: number;
}

export interface MailboxReclassifyInput {
  accountId?: string;
  threadId?: string;
  scope?: "thread" | "account" | "backfill";
  limit?: number;
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
    | "discard_draft"
    | "schedule_event"
    | "dismiss_proposal";
  label?: string;
  draftId?: string;
  commitmentId?: string;
}
