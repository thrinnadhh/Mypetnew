type ConnectivityListener = (isConnected: boolean) => void;

class ConnectivityManager {
  private isConnected = true;
  private listeners: Set<ConnectivityListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => this.setConnected(true));
      window.addEventListener('offline', () => this.setConnected(false));
      this.isConnected = typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
  }

  get online(): boolean {
    return this.isConnected;
  }

  setConnected(status: boolean): void {
    if (this.isConnected !== status) {
      this.isConnected = status;
      this.listeners.forEach((listener) => listener(status));
    }
  }

  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    listener(this.isConnected);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const connectivity = new ConnectivityManager();
