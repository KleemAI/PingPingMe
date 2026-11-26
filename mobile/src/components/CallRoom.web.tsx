import { Empty } from "./ui";

/** The web preview has no native WebRTC module: calls are in the installed app and on the website. */
export function CallRoom(_: { id: string; video?: boolean }) {
  return <Empty icon="call-outline" title="Calls are in the app" text="Open the installed app or the website to join this call." />;
}
