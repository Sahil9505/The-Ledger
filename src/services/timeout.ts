export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  abortController?: AbortController
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      abortController?.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export function now(): number {
  return Date.now();
}

export function elapsedSince(start: number): string {
  return `${Date.now() - start}ms`;
}

export function logNodeDuration(nodeName: string, startMs: number): void {
  console.log(`[timing] ${nodeName} completed in ${Date.now() - startMs}ms`);
}
