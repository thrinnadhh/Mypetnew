const REAL_DATE_NOW = Date.now;
const APPOINTMENT_SLOT_FIXTURE_NOW_MS = Date.parse('2026-08-20T08:00:00Z');

const FIXED_TIME_TESTS = new Set([
  'appointment booking production paths loads canonical services and slots, handles missing times and normalizes paise prices',
  'connected customer services discovers canonical service slots and creates an idempotent Pay at Provider hold',
  'appointment capability isolation filters grooming slot discovery to grooming services for mixed-capability outlets',
]);

beforeEach(() => {
  const currentTestName = expect.getState().currentTestName;
  if (currentTestName && FIXED_TIME_TESTS.has(currentTestName)) {
    Date.now = () => APPOINTMENT_SLOT_FIXTURE_NOW_MS;
  }
});

afterEach(() => {
  Date.now = REAL_DATE_NOW;
});
