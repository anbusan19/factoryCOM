import express from 'express';
import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

const router = express.Router();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:admin@factorycom.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

// Save a new push subscription from the browser
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ message: 'Invalid subscription object' });
  }
  try {
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { endpoint, keys },
      { upsert: true, new: true },
    );
    res.status(201).json({ message: 'Subscribed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Remove a subscription (called when user disables notifications)
router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  try {
    await PushSubscription.deleteOne({ endpoint });
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;

// Shared helper called by alerts.js when a new alert is saved
export async function sendAlertPush(alert) {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  const payload = JSON.stringify({
    title: alert.type === 'critical' ? '🚨 Critical Alert' : '⚠️ Factory Alert',
    body:  alert.message,
    tag:   alert.id ?? alert._id?.toString(),
    url:   '/manager',
    critical: alert.type === 'critical',
  });

  const subs = await PushSubscription.find().lean();
  if (subs.length === 0) return;

  const results = await Promise.allSettled(
    subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload)),
  );

  // Clean up subscriptions that the browser has invalidated (410 Gone)
  results.forEach((r, i) => {
    if (r.status === 'rejected' && r.reason?.statusCode === 410) {
      PushSubscription.deleteOne({ endpoint: subs[i].endpoint }).catch(() => {});
    }
  });
}
