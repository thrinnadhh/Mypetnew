import * as Linking from 'expo-linking';

export async function dialPhoneNumber(phoneNumber: string | null | undefined): Promise<void> {
  if (!phoneNumber) return;
  const cleaned = phoneNumber.replace(/[^\d+]/g, '');
  const url = `tel:${cleaned}`;
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
  }
}
