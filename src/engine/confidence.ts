export function scoreConfidence(history: Array<{ error?: unknown }>) {
  let score = 100;

  history.forEach((h) => {
    if (h.error) score -= 10;
  });

  return Math.max(score, 0);
}
