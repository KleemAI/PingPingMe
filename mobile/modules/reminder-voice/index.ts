import { requireOptionalNativeModule } from "expo";

export type VoiceDiagnosis = {
  manufacturer: string; model: string; android: string; sdk: number;
  notificationsEnabled: boolean; volume: number; maxVolume: number;
  ringerMode: "silent" | "vibrate" | "normal" | "unknown"; doNotDisturb: boolean; mediaStore: boolean;
  channelExists?: boolean; channelImportance?: number; channelSound?: string | null;
};

type ReminderVoiceNative = {
  /** Builds before 2026-11-27 return true/false; newer ones "ok:<channel id>" or a reason. */
  createVoiceChannel(id: string, name: string, description: string, fileUri: string): Promise<boolean | string>;
  /** Newer builds only. */
  removeVoiceSounds?(keep: string[]): Promise<number>;
  diagnose?(channelId: string | null): Promise<VoiceDiagnosis>;
  openChannelSettings?(channelId: string | null): boolean;
};

/** null in Expo Go, on iOS and on the web, and in app builds made before this module existed. */
export const ReminderVoice = requireOptionalNativeModule<ReminderVoiceNative>("ReminderVoice");
