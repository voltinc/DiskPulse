import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function onEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(name, (event) => handler(event.payload));
}
