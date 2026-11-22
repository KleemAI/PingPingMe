import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { WebView as RNWebView } from "react-native-webview";
import * as ImagePicker from "expo-image-picker";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { shrinkPhoto } from "@/lib/media";
import { htmlToText, noteDraft } from "@/lib/noteDraft";
import { noteEditorHtml } from "@/lib/noteEditorHtml";
import { Button, Input, T } from "@/components/ui";

type Icon = keyof typeof MaterialCommunityIcons.glyphMap;
// react-native-webview's iOS & Android prop types intersect to `never` with this React Native version — use what we need
type WebViewMessageEvent = { nativeEvent: { data: string } };
type WebViewHandle = { injectJavaScript: (js: string) => void };
const WebView = RNWebView as unknown as React.ComponentType<{
  ref?: React.Ref<WebViewHandle>; source: { html: string; baseUrl?: string }; originWhitelist?: string[]; onMessage?: (e: WebViewMessageEvent) => void;
  hideKeyboardAccessoryView?: boolean; keyboardDisplayRequiresUserAction?: boolean; style?: object; onShouldStartLoadWithRequest?: (r: { url: string }) => boolean;
}>;
type Sheet = "link" | "photo" | null;


/**
 * Full-screen note editor for a to-do, like a notes app. The note, its toolbar (photo, checklist, Aa, bold, italic,
 * underline, lists, colour, highlight, link, undo / redo) and the Formatting / colour panels all live in the WebView page
 * (lib/noteEditorHtml.ts), so the cursor never leaves the note. Photo and link open small sheets here in the app.
 * Changes go back to the task as you type; ✓ closes.
 */
export default function NoteEditor() {
  const { c, dark } = useTheme();
  const { server, token, upload, toast } = useStore();
  const headerHeight = useHeaderHeight();
  const d = noteDraft.get();
  const editable = !d.readOnly;
  const web = useRef<WebViewHandle>(null);
  const htmlRef = useRef(d.html);
  const [html, setHtml] = useState(d.html);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState({ url: "", text: "" });

  // built once: the note's text is inside the page, so nothing has to be sent before you can type
  const source = useMemo(() => ({
    html: noteEditorHtml(
      { bg: c.card, text: c.text, muted: c.muted, accent: c.accent, accentSoft: c.accentSoft, accentStrong: c.accentStrong, border: c.border, card2: c.card2 },
      {
        editable, placeholder: editable ? "Write your note…" : "No note", html: htmlRef.current,
        fileBase: `${server.replace(/\/$/, "")}/api/v1/files/{id}?access_token=${encodeURIComponent(token ?? "")}`,
      },
    ),
    baseUrl: server || "about:blank",
  }), [dark, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (m: Record<string, unknown>) => web.current?.injectJavaScript(`window.cmd && window.cmd(${JSON.stringify(m)}); true;`);
  useEffect(() => () => { if (editable) noteDraft.finish(htmlRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type: string; html?: string };
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === "change" && editable) { htmlRef.current = m.html ?? ""; setHtml(m.html ?? ""); noteDraft.finish(m.html ?? ""); }
    else if (m.type === "photo") setSheet("photo");
    else if (m.type === "link") { setLink({ url: "", text: "" }); setSheet("link"); }
  };

  const addPhoto = async (camera: boolean) => {
    setSheet(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast(camera ? "Allow the camera to take a photo" : "Allow photos to add one", "error");
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    setBusy("photo");
    try {
      const small = await shrinkPhoto({ uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, mimeType: a.mimeType ?? "image/jpeg", size: a.fileSize ?? undefined });
      const up = await upload(small);
      send({ type: "image", id: up.id });
    } catch { toast("Couldn't add the photo", "error"); } finally { setBusy(null); }
  };



  const Head = ({ title }: { title: string }) => (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 10 }}>
      <T size={14} weight="600" style={{ letterSpacing: 0.5 }}>{title}</T>
      <Pressable onPress={() => { setSheet(null); send({ type: "focus" }); }} hitSlop={10} accessibilityLabel="Close"><MaterialCommunityIcons name="close" size={24} color={c.text} /></Pressable>
    </View>
  );
  const Cell = ({ icon, label, onPress }: { icon: Icon; label: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, height: 56, borderRadius: 10, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? c.border : c.card2 })}>
      <MaterialCommunityIcons name={icon} size={24} color={c.text} /><T>{label}</T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.card }}>
      <Stack.Screen options={{
        title: d.title || "Note",
        headerRight: () => (
          <Pressable onPress={() => { if (editable) noteDraft.finish(htmlRef.current); router.back(); }} hitSlop={8} accessibilityLabel="Done" style={{ paddingHorizontal: 8 }}>
            <MaterialCommunityIcons name="check" size={28} color={c.accentStrong} />
          </Pressable>
        ),
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {Platform.OS === "web" ? (
          <TextInput multiline value={htmlToText(html)} editable={editable} style={{ flex: 1, padding: 16, color: c.text, fontSize: 17, textAlignVertical: "top" }}
            onChangeText={(v) => { const h = v.split("\n").map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "<br>"}</div>`).join(""); htmlRef.current = h; setHtml(h); noteDraft.finish(h); }} />
        ) : (
          <WebView
            ref={web}
            originWhitelist={["*"]}
            source={source}
            onMessage={onMessage}
            {...(Platform.OS === "ios" ? { hideKeyboardAccessoryView: true, keyboardDisplayRequiresUserAction: false } : {})}
            style={{ flex: 1, backgroundColor: c.card }}
            // links open in the browser; the editor itself never navigates
            onShouldStartLoadWithRequest={(r) => {
              if (r.url.startsWith("about:") || r.url.startsWith("data:") || r.url === server || r.url === `${server}/`) return true;
              if (/^(https?:|mailto:|tel:)/.test(r.url)) Linking.openURL(r.url).catch(() => {});
              return false;
            }}
          />
        )}

        {busy === "photo" && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, backgroundColor: c.card2 }}><ActivityIndicator color={c.accent} /><T muted>Adding photo…</T></View>}

        {sheet && (
          <View style={{ padding: 14, paddingBottom: 22, gap: 10, backgroundColor: c.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, borderColor: c.border }}>
            {sheet === "photo" && (
              <>
                <Head title="ADD PHOTO" />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Cell icon="camera-outline" label="Camera" onPress={() => addPhoto(true)} />
                  <Cell icon="image-outline" label="Gallery" onPress={() => addPhoto(false)} />
                </View>
              </>
            )}
            {sheet === "link" && (
              <>
                <Head title="LINK" />
                <Input label="Link" value={link.url} onChangeText={(url) => setLink({ ...link, url })} placeholder="example.com" autoCapitalize="none" keyboardType="url" autoFocus />
                <Input label="Text to show (optional)" value={link.text} onChangeText={(text) => setLink({ ...link, text })} />
                <Button title="Add link" icon="link" disabled={!link.url.trim()} onPress={() => {
                  const u = link.url.trim();
                  send({ type: "link", value: /^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : `https://${u}`, text: link.text.trim() || undefined });
                  setSheet(null);
                }} />
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
