import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Session token lives in the iOS Keychain / Android Keystore. (Web preview falls back to localStorage.)
export const storage = {
  async get(key: string) {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(key, value);
    return SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};
