import { appConfig } from '@/utils/app-config';

export type ChatContextType = 'ORDER' | 'APPOINTMENT';
export type ChatMessageType = 'TEXT' | 'IMAGE';

export interface ParticipantContact {
  userId: string;
  displayName: string;
  phoneNumber: string | null;
  phoneHidden: boolean;
}

export interface ConversationPrivacy {
  customerPhoneVisible: boolean;
  doctorPhoneVisible: boolean;
  assignedDoctorUserId: string | null;
  canManagePrivacy: boolean;
}

export interface Conversation {
  conversationId: string;
  customerId: string;
  providerId: string;
  providerName: string;
  providerType: string;
  contextType: ChatContextType;
  contextId: string;
  customer: ParticipantContact;
  merchant: ParticipantContact;
  doctor: ParticipantContact | null;
  privacy: ConversationPrivacy;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  messageType: ChatMessageType;
  body: string | null;
  imageUrl: string | null;
  imageMimeType: string | null;
  sentAt: string;
  readAt: string | null;
}

function authHeaders(accessToken: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function jsonHeaders(accessToken: string | null | undefined): Record<string, string> {
  return {
    ...authHeaders(accessToken),
    'Content-Type': 'application/json',
  };
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.error ?? body?.message ?? fallbackMessage);
  }
  return (await response.json()) as T;
}

export async function openConversation(input: {
  contextType: ChatContextType;
  contextId: string;
  providerId: string;
  customerId?: string;
  assignedDoctorUserId?: string;
  accessToken: string | null | undefined;
}): Promise<Conversation> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations`, {
    method: 'POST',
    headers: jsonHeaders(input.accessToken),
    body: JSON.stringify({
      contextType: input.contextType,
      contextId: input.contextId,
      providerId: input.providerId,
      customerId: input.customerId,
      assignedDoctorUserId: input.assignedDoctorUserId,
    }),
  });
  return readJson<Conversation>(response, 'Could not open chat.');
}

export async function fetchConversation(
  conversationId: string,
  accessToken: string | null | undefined,
): Promise<Conversation> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}`, {
    headers: authHeaders(accessToken),
  });
  return readJson<Conversation>(response, 'Could not load conversation.');
}

export async function fetchMessages(
  conversationId: string,
  accessToken: string | null | undefined,
  after?: string,
): Promise<ChatMessage[]> {
  const params = after ? `?after=${encodeURIComponent(after)}` : '';
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}/messages${params}`, {
    headers: authHeaders(accessToken),
  });
  return readJson<ChatMessage[]>(response, 'Could not load messages.');
}

export async function sendTextMessage(
  conversationId: string,
  body: string,
  accessToken: string | null | undefined,
): Promise<ChatMessage> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ messageType: 'TEXT', body }),
  });
  return readJson<ChatMessage>(response, 'Could not send message.');
}

export async function sendImageMessage(
  conversationId: string,
  imageUrl: string,
  imageMimeType: string,
  body: string | undefined,
  accessToken: string | null | undefined,
): Promise<ChatMessage> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      messageType: 'IMAGE',
      imageUrl,
      imageMimeType,
      body,
    }),
  });
  return readJson<ChatMessage>(response, 'Could not send image.');
}

export async function uploadChatImage(
  fileUri: string,
  mimeType: string,
  fileName: string,
  accessToken: string | null | undefined,
): Promise<{ imageUrl: string; imageMimeType: string }> {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  const headers = authHeaders(accessToken);
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/attachments`, {
    method: 'POST',
    headers,
    body: formData,
  });
  return readJson(response, 'Could not upload image.');
}

export async function markConversationRead(
  conversationId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not mark messages as read.');
  }
}

export async function updateConversationPrivacy(
  conversationId: string,
  privacy: Partial<Pick<ConversationPrivacy, 'customerPhoneVisible' | 'doctorPhoneVisible' | 'assignedDoctorUserId'>>,
  accessToken: string | null | undefined,
): Promise<Conversation> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/chat/conversations/${conversationId}/privacy`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify(privacy),
  });
  return readJson<Conversation>(response, 'Could not update privacy settings.');
}
