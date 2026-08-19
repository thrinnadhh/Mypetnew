import AppTabs from '@/components/app-tabs';
import { useAuth } from '@/context/AuthContext';

export default function CustomerTabsLayout() {
  const { user } = useAuth();
  return <AppTabs key={user?.id ?? 'guest'} />;
}
