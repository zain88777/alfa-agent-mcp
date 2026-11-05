export class StateManager {
  state: Record<string, unknown> = {};

  set(key: string, value: unknown) {
    this.state[key] = value;
  }

  get(key: string) {
    return this.state[key];
  }

  dump() {
    return this.state;
  }
}
