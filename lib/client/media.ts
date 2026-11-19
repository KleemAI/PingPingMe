/** Like Instagram: photos at most 1080 px wide (and 1920 px tall), JPEG quality 75 %. Videos are compressed on the server. */
const MAX_W = 1080;
const MAX_H = 1920;
const QUALITY = 0.75;
const SKIP_UNDER = 200 * 1024;

/**
 * Makes a photo small in the browser before it is uploaded. GIFs, SVGs and non-photos are left alone,
 * and so is anything that doesn't get smaller (or if the browser can't decode it).
 */
export async function shrinkPhoto(f: File): Promise<File> {
  const type = f.type.toLowerCase();
  if (!type.startsWith("image/") || type === "image/gif" || type === "image/svg+xml") return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, MAX_W / bmp.width, MAX_H / bmp.height);
    if (scale === 1 && f.size < SKIP_UNDER && type === "image/jpeg") { bmp.close(); return f; }
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", QUALITY));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return f;
  }
}
