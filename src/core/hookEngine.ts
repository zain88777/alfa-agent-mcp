export class HookEngine {
  private hooks: Record<string, Array<(payload: unknown) => void | Promise<void>>> = {};

  on(event: string, fn: (payload: unknown) => void | Promise<void>) {
    this.hooks[event] = this.hooks[event] || [];
    this.hooks[event].push(fn);
  }

  async trigger(event: string, payload: unknown) {
    const fns = this.hooks[event] || [];

    for (const fn of fns) {
      await fn(payload);
    }
  }
}
