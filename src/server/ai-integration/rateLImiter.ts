// server/groq/rateLimiter.ts
type Task<T> = () => Promise<T>;

export function createRateLimitedQueue() {
  const queue: Task<any>[] = [];
  let processing = false;

  const process = async () => {
    if (processing || queue.length === 0) return;
    processing = true;
    while (queue.length > 0) {
      const task = queue.shift()!;
      try {
        await task();
      } catch (err) {
        console.error("Queue task failed", err);
      }
      // Always wait 100ms between tasks to smooth burst
      await new Promise(res => setTimeout(res, 100));
    }
    processing = false;
  };

  return {
    add<T>(task: Task<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            const result = await task();
            resolve(result);
          } catch (e) {
            reject(e);
          }
        });
        process();
      });
    },
  };
}

export const aiQueue = createRateLimitedQueue();