import { apiClient } from './api-client';

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

function retainLegacyTokenParameter(_accessToken: string | null | undefined): void {
  // AuthContext owns the canonical ApiClient token. The argument remains only to avoid
  // breaking existing call sites while removing per-service Authorization handling.
}

export async function openConversation(input: {
  contextType: ChatContextType;
  contextId: string;
  providerId: string;
  customerId?: string;
  assignedDoctorUserId?: string;
  accessToken: string | null | undefined;
}): Promise<Conversation> {
  retainLegacyTokenParameter(input.accessToken);
  return apiClient.post<Conversation>('/api/v1/chat/conversations', {
    contextType: input.contextType,
    contextId: input.contextId,
    providerId: input.providerId,
    customerId: input.customerId,
    assignedDoctorUserId: input.assignedDoctorUserId,
  });
}

export async function fetchConversation(
  conversationId: string,
  accessToken: string | null | undefined,
): Promise<Conversation> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<Conversation>(`/api/v1/chat/conversations/${conversationId}`);
}

export async function fetchMessages(
  conversationId: string,
  accessToken: string | null | undefined,
  after?: string,
): Promise<ChatMessage[]> {
  retainLegacyTokenParameter(accessToken);
  const params = after ? `?after=${encodeURIComponent(after)}` : '';
  return apiClient.get<ChatMessage[]>(`/api/v1/chat/conversations/${conversationId}/messages${params}`);
}

export async function sendTextMessage(
  conversationId: string,
  body: string,
  accessToken: string | null | undefined,
): Promise<ChatMessage> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.post<ChatMessage>(`/api/v1/chat/conversations/${conversationId}/messages`, {
    messageType: 'TEXT',
    body,
  });
}

export async function sendImageMessage(
  conversationId: string,
  imageUrl: string,
  imageMimeType: string,
  body: string | undefined,
  accessToken: string | null | undefined,
): Promise<ChatMessage> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.post<ChatMessage>(`/api/v1/chat/conversations/${conversationId}/messages`, {
    messageType: 'IMAGE',
    imageUrl,
    imageMimeType,
    body,
  });
}

export async function uploadChatImage(
  fileUri: string,
  mimeType: string,
  fileName: string,
  accessToken: string | null | undefined,
): Promise<{ imageUrl: string; imageMimeType: string }> {
  retainLegacyTokenParameter(accessToken);
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  return apiClient.upload('/api/v1/chat/attachments', formData);
}

export async function markConversationRead(
  conversationId: string,
  accessToken: string | null | undefined,
): Promise<void> {
  retainLegacyTokenParameter(accessToken);
  await apiClient.post(`/api/v1/chat/conversations/${conversationId}/read`);
}

export async function updateConversationPrivacy(
  conversationId: string,
  privacy: Partial<Pick<ConversationPrivacy, 'customerPhoneVisible' | 'doctorPhoneVisible' | 'assignedDoctorUserId'>>,
  accessToken: string | null | undefined,
): Promise<Conversation> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.patch<Conversation>(`/api/v1/chat/conversations/${conversationId}/privacy`, privacy);
}
