/** Dedicated, atomic device draft/cache; never touches household/claims/Savings keys. */
let queue: Promise<unknown> = Promise.resolve();
export function groceryCache<T>(key: string, value?: T): Promise<T | undefined> {
  const result = queue.then(() => transaction<T>(key, value)); queue = result.catch(() => {}); return result;
}
async function transaction<T>(key: string, value?: T): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("familyhub.groceries.v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("cache");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error("Grocery storage is unavailable on this device."));
  });
  try { return await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction("cache", value === undefined ? "readonly" : "readwrite");
    const request = value === undefined ? tx.objectStore("cache").get(key) : tx.objectStore("cache").put(value, key);
    tx.oncomplete = () => resolve(value ?? request.result); tx.onerror = tx.onabort = () => reject(new Error("Draft not saved. Check available space on this device."));
  }); } finally { db.close(); }
}
