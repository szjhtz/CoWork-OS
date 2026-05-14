export const GOOGLE_SCOPE_DRIVE = "https://www.googleapis.com/auth/drive";
export const GOOGLE_SCOPE_GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_SCOPE_GMAIL_LABELS = "https://www.googleapis.com/auth/gmail.labels";
export const GOOGLE_SCOPE_GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar";
export const GOOGLE_SCOPE_SPREADSHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const GOOGLE_SCOPE_DOCUMENTS = "https://www.googleapis.com/auth/documents";
export const GOOGLE_SCOPE_TASKS = "https://www.googleapis.com/auth/tasks";
export const GOOGLE_SCOPE_PRESENTATIONS = "https://www.googleapis.com/auth/presentations";
export const GOOGLE_SCOPE_CHAT_MESSAGES = "https://www.googleapis.com/auth/chat.messages";
export const GOOGLE_SCOPE_CHAT_SPACES_READONLY =
  "https://www.googleapis.com/auth/chat.spaces.readonly";

export const GOOGLE_WORKSPACE_DEFAULT_SCOPES = [
  GOOGLE_SCOPE_DRIVE,
  GOOGLE_SCOPE_GMAIL_READONLY,
  GOOGLE_SCOPE_GMAIL_SEND,
  GOOGLE_SCOPE_GMAIL_MODIFY,
  GOOGLE_SCOPE_CALENDAR,
  GOOGLE_SCOPE_SPREADSHEETS,
  GOOGLE_SCOPE_DOCUMENTS,
  GOOGLE_SCOPE_TASKS,
  GOOGLE_SCOPE_PRESENTATIONS,
  GOOGLE_SCOPE_CHAT_MESSAGES,
  GOOGLE_SCOPE_CHAT_SPACES_READONLY,
];

export const GMAIL_DEFAULT_SCOPES = [
  GOOGLE_SCOPE_GMAIL_READONLY,
  GOOGLE_SCOPE_GMAIL_SEND,
  GOOGLE_SCOPE_GMAIL_LABELS,
  GOOGLE_SCOPE_GMAIL_MODIFY,
];

export function hasScope(scopes: string[] | undefined, scope: string): boolean {
  return Boolean(scopes?.some((entry) => entry.trim() === scope));
}

export function normalizeGoogleWorkspaceScopes(scopes: string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes || []) {
    const trimmed = scope.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function mergeGoogleWorkspaceScopes(scopes: string[] | undefined): string[] {
  return normalizeGoogleWorkspaceScopes([...(scopes || []), ...GOOGLE_WORKSPACE_DEFAULT_SCOPES]);
}

export function getMissingGoogleWorkspaceScopes(scopes: string[] | undefined): string[] {
  if (!scopes || scopes.length === 0) return [];
  const granted = new Set(normalizeGoogleWorkspaceScopes(scopes));
  return GOOGLE_WORKSPACE_DEFAULT_SCOPES.filter((scope) => !granted.has(scope));
}
