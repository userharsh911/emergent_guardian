// utils/sendNotification.js
import { Expo } from "expo-server-sdk";

const expo = new Expo();

async function sendPushNotification(pushTokens, title, body, data = {}) {
  const normalizedTokens = Array.from(
    new Set(
      (pushTokens || [])
        .map((token) => String(token || "").trim())
        .filter(Boolean)
    )
  );

  const messages = normalizedTokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data,
      priority: "high",
      channelId: "default",
      ttl: 60 * 60,
    }));

  if (messages.length === 0) {
    return { sent: 0, tickets: [] };
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);

      chunkTickets.forEach((ticket, index) => {
        if (ticket?.status === "error") {
          const token = chunk[index]?.to;
          console.error("Expo push ticket error:", {
            token,
            details: ticket?.details || null,
            message: ticket?.message || "Unknown error",
          });
        }
      });
    } catch (err) {
      console.error("Notification error:", err);
    }
  }

  return { sent: messages.length, tickets };
}

export default sendPushNotification;
