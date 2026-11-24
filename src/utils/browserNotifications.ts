export type BrowserNotificationPermission =
  | 'granted'
  | 'denied'
  | 'default'
  | 'unsupported';

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (window.Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return window.Notification.permission;
  }
}

export async function triggerBrowserNotification(
  title: string,
  body: string,
  tag?: string
): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }
  if (window.Notification.permission !== 'granted') {
    return;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: tag || `sbm-${Date.now()}`,
        });
        return;
      }
    }
  } catch {
    // Fall back to standard Notification API
  }

  try {
    new window.Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: tag || `sbm-${Date.now()}`,
    });
  } catch {
    // Some browsers disallow Notification constructor inside certain sandboxes
  }
}
