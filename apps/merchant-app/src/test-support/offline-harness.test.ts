import { createDeferred } from "./deferred";
import { FakeClock } from "./fake-clock";
import { FakeNetwork } from "./fake-network";
import { merchantTestIdentity, resetMerchantFixtureSequence } from "./fixture-builders";
import { ProcessRestartHarness } from "./process-restart-harness";

describe("Merchant offline test harness", () => {
  beforeEach(() => resetMerchantFixtureSequence());

  test("network transitions are deterministic and duplicate states do not emit", () => {
    expect(new FakeNetwork().current()).toBe("ONLINE");
    const network = new FakeNetwork("ONLINE");
    const observed: string[] = [];
    expect(network.current()).toBe("ONLINE");
    const unsubscribe = network.subscribe((state) => observed.push(state));

    network.transitionTo("OFFLINE");
    network.transitionTo("OFFLINE");
    network.transitionTo("ONLINE");
    expect(network.current()).toBe("ONLINE");
    unsubscribe();
    network.transitionTo("OFFLINE");

    expect(observed).toEqual(["OFFLINE", "ONLINE"]);
  });

  test("deferred response settles once and supports lost-response scenarios", async () => {
    const response = createDeferred<{ receiptId: string }>();
    response.resolve({ receiptId: "receipt-1" });
    response.reject(new Error("late failure"));

    await expect(response.promise).resolves.toEqual({ receiptId: "receipt-1" });
    expect(response.settled).toBe(true);
  });

  test("deferred failure settles once and ignores a late success", async () => {
    const response = createDeferred<string>();
    response.reject(new Error("offline"));
    response.resolve("late success");

    await expect(response.promise).rejects.toThrow("offline");
    expect(response.settled).toBe(true);
  });

  test("restart creates a new service graph against the same persistence object", () => {
    const persistence = { commands: [] as string[] };
    let generation = 0;
    const harness = new ProcessRestartHarness(persistence, (store) => ({ store, generation: ++generation }));
    harness.current().store.commands.push("command-1");

    const restarted = harness.restart();

    expect(restarted.generation).toBe(2);
    expect(restarted.store).toBe(persistence);
    expect(restarted.store.commands).toEqual(["command-1"]);
  });

  test("clock and identity builders are repeatable", () => {
    const clock = new FakeClock(new Date("2026-08-21T00:00:00.000Z"));
    clock.advanceBy(1_500);
    expect(clock.now().toISOString()).toBe("2026-08-21T00:00:01.500Z");

    expect(merchantTestIdentity()).toEqual({
      accountId: "00000000-0000-4000-8000-000000000001",
      organizationId: "10000000-0000-4000-8000-000000000001",
      outletId: "20000000-0000-4000-8000-000000000001",
      deviceId: "m0-device-0001"
    });
  });

  test("clock rejects negative or non-finite movement", () => {
    const clock = new FakeClock();
    expect(() => clock.advanceBy(-1)).toThrow("finite non-negative");
    expect(() => clock.advanceBy(Number.NaN)).toThrow("finite non-negative");
  });
});
