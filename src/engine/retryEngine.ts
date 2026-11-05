export async function retry<T>(
  fn: () => Promise<T>,
  max = 3
): Promise<T> {
  let lastErr;

  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr;
}
