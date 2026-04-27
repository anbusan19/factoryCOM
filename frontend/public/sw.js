self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'FactoryCOM Alert', {
      body:              data.body ?? 'New factory alert',
      icon:              '/factoryOS.png',
      badge:             '/factoryOS.png',
      tag:               data.tag  ?? 'factory-alert',
      data:              { url: data.url ?? '/manager' },
      requireInteraction: data.critical ?? false,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/manager';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('/manager'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
