import { Redirect } from "expo-router";

/** The P2P tab opens the market stack (see the tab listener); this route only catches deep links. */
export default function P2PTab() {
  return <Redirect href="/p2p" />;
}
