interface BluetoothDevice {
  name: string;
  gatt: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): Promise<void>;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
  connected: boolean;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  writeValue(value: Uint8Array): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  addEventListener(event: string, callback: (event: any) => void): void;
  removeEventListener(event: string, callback: (event: any) => void): void;
  value: DataView | null;
}

/* eslint-disable */
interface NavigatorBluetooth {
  requestDevice(options: any): Promise<BluetoothDevice>;
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth: NavigatorBluetooth;
}

declare global {
  interface Navigator extends NavigatorWithBluetooth {}
}
