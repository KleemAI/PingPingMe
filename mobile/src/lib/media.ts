import { Platform } from "react-native";
import { File } from "expo-file-system";
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
