export function handleError(e: unknown) {
  return {
    error: true,
    message: e instanceof Error ? e.message : "Unknown error"
  };
}
