import i18n, { t } from '@/i18n';

describe('i18n smoke', () => {
  it('renders English tab labels', async () => {
    await i18n.changeLanguage('en');
    expect(t('tabs.home')).toBe('Home');
    expect(t('tabs.shop')).toBe('Shop');
    expect(t('login.logIn')).toBe('Log in');
  });

  it('renders Hindi tab labels', async () => {
    await i18n.changeLanguage('hi');
    expect(t('tabs.home')).toBe('होम');
    expect(t('tabs.shop')).toBe('दुकान');
    expect(t('login.logIn')).toBe('लॉग इन');
  });
});
