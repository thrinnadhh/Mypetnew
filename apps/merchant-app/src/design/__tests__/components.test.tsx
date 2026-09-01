import React from 'react';
import type { MerchantAppointmentRequest } from '../../appointments/api';
import {
  ActionCard,
  AppointmentCard,
  AppointmentDetailModal,
  BottomNavigation,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  MetricCard,
  OfflineBanner,
  OutletPickerModal,
  PrimaryButton,
  SecondaryButton,
  SectionHeader,
  StatusBadge,
  SyncIndicator,
} from '../components';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
    useEffect: jest.fn(),
  };
});

const mockAppointment: MerchantAppointmentRequest = {
  appointmentId: 'apt-101',
  outletId: 'outlet-1',
  serviceId: 'srv-1',
  slotId: 'slot-1',
  petName: 'Rocky',
  serviceName: 'Full Grooming Spa',
  startsAt: '2026-09-01T10:00:00Z',
  endsAt: '2026-09-01T10:45:00Z',
  status: 'BOOKED',
  paymentMethod: 'ONLINE_PAYMENT',
  paymentStatus: 'PAID',
  pricePaise: 149900,
  currency: 'INR',
  notes: 'Sensitive skin shampoo',
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
};

describe('MF2 & MF4 Design Components', () => {
  describe('StatusBadge', () => {
    it('renders all status variants with appropriate colors and roles', () => {
      const variants = ['success', 'warning', 'error', 'info', 'syncing', 'pending', 'neutral'] as const;
      for (const variant of variants) {
        const badge = StatusBadge({ label: `${variant} status`, variant });
        expect(badge).toBeTruthy();
        expect(badge.props.accessibilityLabel).toBe(`${variant} status`);
        expect(badge.props.accessibilityRole).toBe('text');
      }
    });
  });

  describe('SyncIndicator', () => {
    it('renders SyncIndicator for online, offline, syncing, pending, and failed states', () => {
      const online = SyncIndicator({ mode: 'online' });
      expect(online).toBeTruthy();
      expect(online.props.accessibilityLabel).toContain('Online');

      const pending = SyncIndicator({ mode: 'pending', pendingCount: 3 });
      expect(pending).toBeTruthy();
      expect(pending.props.accessibilityLabel).toContain('3 Pending');

      const offline = SyncIndicator({ mode: 'offline' });
      expect(offline).toBeTruthy();
      expect(offline.props.accessibilityLabel).toContain('Offline');

      const syncing = SyncIndicator({ mode: 'syncing' });
      expect(syncing).toBeTruthy();
      expect(syncing.props.accessibilityLabel).toContain('Syncing');

      const failed = SyncIndicator({ mode: 'failed' });
      expect(failed).toBeTruthy();
      expect(failed.props.accessibilityLabel).toContain('Sync failed');

      const onSyncPress = jest.fn();
      const pressableSync = SyncIndicator({ mode: 'online', onPress: onSyncPress, compact: true });
      expect(pressableSync.props.accessibilityRole).toBe('button');
    });
  });

  describe('Buttons (Primary, Secondary, IconButton)', () => {
    it('renders PrimaryButton with variants, loading, and disabled states', () => {
      const onPress = jest.fn();
      const primary = PrimaryButton({ title: 'Confirm Order', onPress, variant: 'primary' });
      expect(primary.props.accessibilityRole).toBe('button');
      expect(primary.props.accessibilityState).toEqual({ disabled: false, busy: false });

      const destructive = PrimaryButton({ title: 'Delete Item', onPress, variant: 'destructive' });
      expect(destructive).toBeTruthy();

      const success = PrimaryButton({ title: 'Complete', onPress, variant: 'success' });
      expect(success).toBeTruthy();

      const disabledBtn = PrimaryButton({ title: 'Disabled', onPress, disabled: true });
      expect(disabledBtn.props.accessibilityState.disabled).toBe(true);

      const loadingBtn = PrimaryButton({ title: 'Saving…', onPress, loading: true });
      expect(loadingBtn.props.accessibilityState.busy).toBe(true);
    });

    it('renders SecondaryButton with loading and disabled states', () => {
      const onPress = jest.fn();
      const secondary = SecondaryButton({ title: 'Cancel', onPress });
      expect(secondary.props.accessibilityRole).toBe('button');

      const loadingSec = SecondaryButton({ title: 'Loading', onPress, loading: true });
      expect(loadingSec.props.accessibilityState.busy).toBe(true);
    });

    it('renders IconButton with icon, badge, and disabled states', () => {
      const onPress = jest.fn();
      const iconBtn = IconButton({ icon: '🔔', onPress, accessibilityLabel: 'Notifications', badgeCount: 5 });
      expect(iconBtn.props.accessibilityRole).toBe('button');
      expect(iconBtn.props.accessibilityLabel).toBe('Notifications');

      const largeBadge = IconButton({ icon: '🔔', onPress, accessibilityLabel: 'Inbox', badgeCount: 150 });
      expect(largeBadge).toBeTruthy();
    });
  });

  describe('MetricCard', () => {
    it('renders static and actionable metric cards with accessible summaries', () => {
      const metric = MetricCard({
        label: 'Order Work',
        value: 14,
        detail: 'Orders waiting for preparation',
      });
      expect(metric.props.accessibilityRole).toBe('summary');
      expect(metric.props.accessibilityLabel).toBe('Order Work: 14. Orders waiting for preparation');

      const actionableMetric = MetricCard({
        label: 'Pending Appointments',
        value: 3,
        detail: 'Grooming requests',
        badgeText: 'Action Needed',
        onPress: jest.fn(),
      });
      expect(actionableMetric.props.accessibilityRole).toBe('button');
    });
  });

  describe('ActionCard', () => {
    it('renders ActionCard with icon, title, subtitle, badge, and primary variant', () => {
      const onScan = jest.fn();
      const action = ActionCard({
        title: 'Scan Barcode',
        subtitle: 'Offline product lookup',
        icon: '📷',
        badge: 3,
        onPress: onScan,
        variant: 'primary',
      });
      expect(action.props.accessibilityRole).toBe('button');
      expect(action.props.accessibilityLabel).toBe('Scan Barcode, Offline product lookup');
    });
  });

  describe('SectionHeader', () => {
    it('renders SectionHeader with title, subtitle, and optional action', () => {
      const onAction = jest.fn();
      const header = SectionHeader({
        title: 'Inventory Status',
        subtitle: 'Summary by category',
        actionText: 'View All',
        onAction,
      });
      expect(header).toBeTruthy();
    });
  });

  describe('OfflineBanner', () => {
    it('renders OfflineBanner for offline, pending, syncing, and failed variants', () => {
      const onAction = jest.fn();
      const pendingBanner = OfflineBanner({
        variant: 'pending',
        pendingCount: 4,
        onAction,
        actionLabel: 'Sync now',
      });
      expect(pendingBanner.props.accessibilityRole).toBe('alert');
      expect(pendingBanner.props.accessibilityLiveRegion).toBe('polite');
      expect(pendingBanner.props.accessibilityLabel).toContain('4 Pending Local Changes');

      const syncingBanner = OfflineBanner({ variant: 'syncing' });
      expect(syncingBanner.props.accessibilityLabel).toContain('Synchronizing');

      const failedBanner = OfflineBanner({ variant: 'failed', onAction, actionLabel: 'Retry' });
      expect(failedBanner.props.accessibilityLabel).toContain('Conflicts or Errors');

      const offlineBanner = OfflineBanner({ variant: 'offline' });
      expect(offlineBanner.props.accessibilityLabel).toContain('Offline Mode Active');
    });
  });

  describe('State Views (EmptyState, ErrorState, LoadingState)', () => {
    it('renders EmptyState, ErrorState, and LoadingState with semantic accessibility', () => {
      const empty = EmptyState({
        title: 'No Orders',
        description: 'No active orders in queue.',
        actionTitle: 'Refresh',
        onAction: jest.fn(),
      });
      expect(empty.props.accessibilityRole).toBe('summary');

      const error = ErrorState({
        title: 'Sync Failure',
        message: 'Failed to connect to backend.',
        onRetry: jest.fn(),
      });
      expect(error.props.accessibilityRole).toBe('alert');
      expect(error.props.accessibilityLiveRegion).toBe('assertive');

      const loading = LoadingState({ message: 'Loading dashboard…' });
      expect(loading.props.accessibilityRole).toBe('progressbar');
      expect(loading.props.accessibilityLiveRegion).toBe('polite');
    });
  });

  describe('OutletPickerModal & MerchantHeader', () => {
    it('renders OutletPickerModal with selection options', () => {
      const onSelect = jest.fn();
      const onClose = jest.fn();
      const modal = OutletPickerModal({
        visible: true,
        onClose,
        outlets: [
          { id: 'outlet-1', name: 'Downtown Branch' },
          { id: 'outlet-2', name: 'Westside Store' },
        ],
        selectedOutletId: 'outlet-1',
        onSelectOutlet: onSelect,
        businessName: 'MyPet Superstore',
      });
      expect(modal).toBeTruthy();
    });

    it('renders MerchantHeader with persistent outlet context and sync indicator', () => {
      const header = MerchantHeader({
        outletName: 'Downtown Branch',
        businessName: 'MyPet Merchant',
        syncMode: 'online',
        pendingSyncCount: 0,
        unreadNotifications: 2,
        onNotificationsPress: jest.fn(),
        onAccountPress: jest.fn(),
        outlets: [{ id: 'outlet-1', name: 'Downtown' }],
        onSelectOutlet: jest.fn(),
      });
      expect(header).toBeTruthy();
    });
  });

  describe('BottomNavigation & MerchantScreen', () => {
    it('renders BottomNavigation with 5 primary destinations and more menu', () => {
      const onTabPress = jest.fn();
      const nav = BottomNavigation({
        activeTab: 'home',
        onTabPress,
        orderBadge: 3,
        moreMenuItems: [
          { key: 'barcode', label: 'Barcode Scanner', icon: '📷', onPress: jest.fn(), badge: 2 },
        ],
      });
      expect(nav).toBeTruthy();
    });

    it('renders MerchantScreen container with header, safe area, and offline banner', () => {
      const screen = MerchantScreen({
        showHeader: true,
        headerProps: { outletName: 'Main Store' },
        showBottomNav: true,
        bottomNavProps: { activeTab: 'home', onTabPress: jest.fn() },
        offlineBannerProps: { variant: 'offline' },
        children: <LoadingState message="Testing" />,
      });
      expect(screen).toBeTruthy();

      const nonScrollable = MerchantScreen({
        scrollable: false,
        showHeader: false,
        children: <LoadingState message="Testing fixed" />,
      });
      expect(nonScrollable).toBeTruthy();
    });
  });

  describe('MF4 Appointment Components (AppointmentCard, AppointmentDetailModal)', () => {
    it('renders AppointmentCard with service, pet, payment badge, and actions', () => {
      const onTransition = jest.fn();
      const onViewDetails = jest.fn();
      const card = AppointmentCard({
        appointment: mockAppointment,
        availableTargets: ['CONFIRMED', 'REJECTED'],
        onTransition,
        onViewDetails,
      });
      expect(card).toBeTruthy();
      expect(card.props.accessibilityRole).toBe('text');
      expect(card.props.accessibilityLabel).toContain('Rocky');
      expect(card.props.accessibilityLabel).toContain('Full Grooming Spa');
    });

    it('renders AppointmentDetailModal with full context and action controls', () => {
      const onTransition = jest.fn();
      const onClose = jest.fn();
      const modal = AppointmentDetailModal({
        visible: true,
        appointment: mockAppointment,
        availableTargets: ['CONFIRMED', 'REJECTED'],
        onClose,
        onTransition,
      });
      expect(modal).toBeTruthy();
    });

    it('handles null appointment in AppointmentDetailModal gracefully', () => {
      const modal = AppointmentDetailModal({
        visible: false,
        appointment: null,
        availableTargets: [],
        onClose: jest.fn(),
        onTransition: jest.fn(),
      });
      expect(modal).toBeNull();
    });
  });
});
