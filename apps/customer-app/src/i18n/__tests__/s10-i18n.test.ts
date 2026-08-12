import i18n, { t } from '@/i18n';

describe('S10 localization', () => {
  it('uses four English customer tabs and PetStore branding', async () => {
    await i18n.changeLanguage('en');
    expect([t('tabs.home'), t('tabs.search'), t('tabs.orders'), t('tabs.profile')]).toEqual(['Home', 'Search', 'Orders', 'Profile']);
    expect(t('common.brand')).toBe('PetStore');
  });
  it('provides Telugu customer navigation', async () => {
    await i18n.changeLanguage('te');
    expect(t('tabs.search')).toBe('వెతకండి');
    expect(t('home.locationLive')).toBe('తిరుపతి');
  });
});
