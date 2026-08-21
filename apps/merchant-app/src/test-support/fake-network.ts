export type NetworkState = "ONLINE" | "OFFLINE";
export type NetworkListener = (state: NetworkState) => void;

export class FakeNetwork {
  private listeners = new Set<NetworkListener>();

  constructor(private state: NetworkState = "ONLINE") {}

  current(): NetworkState {
    return this.state;
  }

  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  transitionTo(next: NetworkState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
