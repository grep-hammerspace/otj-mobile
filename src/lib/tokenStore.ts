import * as SecureStore from "expo-secure-store";

/** Native: encrypted keychain / keystore storage. */
export async function getStored(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export async function setStored(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

export async function deleteStored(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}
