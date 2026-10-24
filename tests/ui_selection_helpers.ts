import type { ClickIntentSchedule } from "@mcpview/view/context";

export function fakeClock() {
  let now = 0;
  const jobs = new Set<{ at: number; run: () => void }>();
  const schedule: ClickIntentSchedule = (run, delay) => {
    const job = { at: now + delay, run };
    jobs.add(job);
    return () => {
      jobs.delete(job);
    };
  };
  return {
    schedule,
    advance(ms: number) {
      now += ms;
      for (const job of [...jobs].sort((a, b) => a.at - b.at)) {
        if (job.at <= now && jobs.delete(job)) job.run();
      }
    },
  };
}
