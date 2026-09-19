import assert from 'node:assert/strict';

export type NotificationTimingHooks = {
  onDispatch?: () => Promise<void>;
  onFeedInvalidated?: () => void;
  scheduleAfterResponse?: (callback: () => unknown) => void;
};

/** Hold external delivery open while checking the committed feed is invalidated. */
export async function assertFeedInvalidatesBeforeDelivery(
  invoke: (hooks: NotificationTimingHooks) => Promise<{ success: boolean }>,
) {
  let deliveryStarted!: () => void;
  let releaseDelivery!: () => void;
  const started = new Promise<void>((resolve) => { deliveryStarted = resolve; });
  const waiting = new Promise<void>((resolve) => { releaseDelivery = resolve; });
  const scheduled: (() => unknown)[] = [];
  let invalidated = false;
  const pending = invoke({
    onDispatch: async () => { deliveryStarted(); await waiting; },
    onFeedInvalidated: () => { invalidated = true; },
    scheduleAfterResponse: (callback) => { scheduled.push(callback); },
  });
  let delivery: Promise<unknown> | undefined;
  try {
    const result = await Promise.race([
      pending,
      started.then(() => { assert.fail('email delivery must be scheduled after the action response'); }),
    ]);
    assert.equal(result.success, true);
    assert.equal(invalidated, true, 'the committed busy feed must be invalidated before the action returns');
    assert.equal(scheduled.length, 1, 'committed notifications must still be dispatched after the response');
    delivery = Promise.all(scheduled.map((callback) => callback()));
    await started;
  } finally {
    releaseDelivery();
    await Promise.all([pending, delivery]);
  }
}
