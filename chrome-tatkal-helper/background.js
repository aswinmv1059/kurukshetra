const ALARM_NAME = "tatkal-open-reminder";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(["tatkalSettings", "passengers"]);

  if (!existing.tatkalSettings) {
    await chrome.storage.sync.set({
      tatkalSettings: {
        classType: "3A",
        quota: "TQ",
        trainNumber: "",
        fromStation: "",
        toStation: "",
        travelDate: "",
        openTime: "10:00",
        reminderMinutesBefore: 2,
        autoFillOnPageLoad: true
      }
    });
  }

  if (!existing.passengers) {
    await chrome.storage.sync.set({
      passengers: [
        {
          name: "",
          age: "",
          gender: "Male",
          berthPreference: "No Preference"
        }
      ]
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const data = await chrome.storage.sync.get(["tatkalSettings"]);
  const settings = data.tatkalSettings || {};

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title: "Tatkal window reminder",
    message: `Tatkal opens at ${settings.openTime || "10:00"}. Open IRCTC and keep OTP/CAPTCHA ready.`
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SCHEDULE_REMINDER") {
    scheduleReminder(msg.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (msg?.type === "OPEN_IRCTC") {
    chrome.tabs.create({ url: "https://www.irctc.co.in/nget/train-search" });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function scheduleReminder(payload) {
  const settings = payload || {};
  const openTime = settings.openTime || "10:00";
  const minsBefore = Number(settings.reminderMinutesBefore || 2);

  const [hoursStr, minsStr] = openTime.split(":");
  const hours = Number(hoursStr);
  const minutes = Number(minsStr);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    throw new Error("Invalid opening time");
  }

  const now = new Date();
  const target = new Date();
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  target.setMinutes(target.getMinutes() - minsBefore);

  if (target.getTime() <= now.getTime()) {
    throw new Error("Reminder time already passed. Adjust open time or reminder minutes.");
  }

  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { when: target.getTime() });
}
