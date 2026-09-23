/**
 * Shows a notification from the page; resolves to whether one was shown.
 *
 * Goes through the service worker registration when there is one: Android Chrome throws
 * `TypeError: Illegal constructor` for `new Notification()`, and an installed iOS web app
 * only delivers notifications shown this way. The constructor is kept as a fallback for
 * desktop browsers without a registered worker (e.g. `next dev`, which does not register one).
 */
export async function showLocalNotification(title: string, options: NotificationOptions): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    return true;
  } catch {
    return false;
  }
}
