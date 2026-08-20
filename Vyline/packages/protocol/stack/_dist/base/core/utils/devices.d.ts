export type Device = "DESKTOPWIN" | "DESKTOPMAC" | "ANDROID" | "ANDROIDSECONDARY" | "IOS" | "IOSIPAD" | "WATCHOS" | "WEAROS";
export interface DeviceDetails {
    device: Device;
    appVersion: string;
    systemName: string;
    systemVersion: string;
}
export declare function isV3Support(device: Device): device is "DESKTOPWIN" | "DESKTOPMAC" | "IOS" | "ANDROID" | "ANDROIDSECONDARY";
export declare function getDeviceDetails(device: Device, version?: string): DeviceDetails | null;
