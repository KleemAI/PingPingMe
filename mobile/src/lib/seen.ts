import { useCallback, useEffect, useState } from "react";
import { storage } from "./storage";

// When this phone last opened the chat with our team — to show a WhatsApp-style unread count in the chat list.
const KEY = "bm_team_chat_seen";
let seen = 0;
let loaded = false;
const listeners = new Set<(v: number) => void>();

export function useTeamChatSeen() {
  const [value, setValue] = useState(seen);
  useEffect(() => {
    listeners.add(setValue);
    if (!loaded) storage.get(KEY).then((v) => { loaded = true; seen = Number(v) || 0; listeners.forEach((l) => l(seen)); }).catch(() => {});
    return () => { listeners.delete(setValue); };
  }, []);
  const markSeen = useCallback(() => {
    seen = Date.now();
    loaded = true;
    storage.set(KEY, String(seen)).catch(() => {});
    listeners.forEach((l) => l(seen));
  }, []);
  return { seen: value, markSeen };
}
