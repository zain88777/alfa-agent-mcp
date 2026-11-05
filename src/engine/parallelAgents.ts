export async function runParallel<T>(tasks: Array<() => Promise<T>>) {
  return Promise.all(tasks.map((t) => t()));
}
