import * as Network from 'expo-network';
import { Platform } from 'react-native';

type ConnectivityListener = (isConnected: boolean) => void;

class ConnectivityManager {
  private isConnected = true;
  private listeners: Set<ConnectivityListener> = new Set();

  constructor() {
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('online', () => this.setConnected(true));
      window.addEventListener('offline', () => this.setConnected(false));
      this.isConnected = typeof navigator !== 'undefined' ? navigator.onLine : true;
      return;
    }

    Network.getNetworkStateAsync()
      .then((state) => this.applyNetworkState(state))
      .catch(() => {});
    Network.addNetworkStateListener((state) => this.applyNetworkState(state));
  }

  private applyNetworkState(state: Network.NetworkState): void {
    if (state.isConnected === false || state.isInternetReachable === false) {
      this.setConnected(false);
    } else if (state.isConnected === true || state.isInternetReachable === true) {
      this.setConnected(true);
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
