import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** Like Instagram: photos at most 1080 px wide (and 1920 px tall, so screenshots stay readable), JPEG quality 75 %. */
const MAX_W = 1080;
const MAX_H = 1920;
const QUALITY = 0.75;
const SKIP_UNDER = 200 * 1024; // already small and not too big in pixels → leave it

type Pick = { uri: string; name: string; mimeType?: string; size?: number; file?: Blob };

/**
 * Makes a photo small before it is uploaded (done on the phone, so it also saves mobile data).
 * GIFs (animation) and anything that isn't a photo are left alone; if anything goes wrong the original is sent.
 * Videos are compressed on the server (720p).
 */
export async function shrinkPhoto<T extends Pick>(f: T): Promise<T> {
  const mime = (f.mimeType ?? "").toLowerCase();
  if (Platform.OS === "web" || !mime.startsWith("image/") || mime === "image/gif" || mime === "image/svg+xml") return f;
  try {
    const original = await ImageManipulator.manipulate(f.uri).renderAsync();
    const { width, height } = original;
    const scale = Math.min(1, MAX_W / width, MAX_H / height);
    if (scale === 1 && (f.size ?? Infinity) < SKIP_UNDER && mime === "image/jpeg") return f;
    const ctx = ImageManipulator.manipulate(f.uri);
    if (scale < 1) ctx.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    const out = await (await ctx.renderAsync()).saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
    const size = new File(out.uri).size ?? 0;
    if (f.size && size >= f.size) return f; // didn't help
    return { ...f, uri: out.uri, name: f.name.replace(/\.[^.]*$/, "") + ".jpg", mimeType: "image/jpeg", size };
  } catch {
    return f;
  }
}

/**
 * A file for FormData on the phone. Expo's fetch (the app's global fetch since SDK 52) only accepts parts it can read
 * bytes from — the old React Native `{ uri, name, type }` object fails with "Unsupported FormDataPart implementation".
 * This gives it the name and type we want plus a `bytes()` that reads the file (or returns bytes already in memory).
 */
export function formFile(src: { uri: string } | { data: Uint8Array }, name: string, type: string): Blob {
  const part = { name, type, bytes: async () => ("data" in src ? src.data : await new File(src.uri).bytes()) };
  return part as unknown as Blob;
}

const pics = new Map<string, Promise<string | null>>();
/**
 * A picture the API serves only to signed-in people (`/files/:id`), as a uri an <Image> can show.
 * The file is fetched with the sign-in token: on the web an <Image> can't send that header, and on phones a
 * once-refused image stays blank, so we download it ourselves (kept in the cache — file ids never change).
 */
export function fileUri(id: string, server: string, token: string | null): Promise<string | null> {
  let p = pics.get(id);
  if (!p) {
    p = (async () => {
      const out = Platform.OS === "web" ? null : new File(Paths.cache, `pic-${id}`);
      if (out?.exists && out.size) return out.uri;
      const r = await fetch(`${server.replace(/\/$/, "")}/api/v1/files/${id}`, { headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!r.ok) return null;
      const data = new Uint8Array(await r.arrayBuffer());
      if (!out) return URL.createObjectURL(new Blob([data as BlobPart], { type: r.headers.get("content-type") ?? "image/jpeg" }));
      out.write(data);
      return out.uri;
    })().catch(() => null);
    pics.set(id, p);
    p.then((u) => { if (!u) pics.delete(id); }); // try again next time
  }
  return p;
}
