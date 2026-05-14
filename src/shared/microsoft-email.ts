export const MICROSOFT_EMAIL_OAUTH_DEFAULT_SCOPES = [
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "offline_access",
] as const;

export const MICROSOFT_EMAIL_DEFAULT_TENANT = "consumers";
export const MICROSOFT_EMAIL_OAUTH_PROVIDER = "microsoft";
