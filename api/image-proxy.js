// Remote image fetch proxy. Keeping this server-side avoids browser CORS restrictions.
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const IMAGE_EXTENSION = /\.(avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;

function badUrl(value) {
  try {
    const url = new URL(value);
    return !/^https?:$/.test(url.protocol) || PRIVATE_HOST.test(url.hostname) || url.username || url.password;
  } catch (_) { return true; }
}

module.exports = async function handler(request, response) {
  const target = request.query && request.query.url;
  if (typeof target !== "string" || badUrl(target)) {
    return response.status(400).json({ error: "유효한 공개 HTTP(S) 이미지 URL이 아닙니다." });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let nextUrl = target;
    let upstream;
    // Validate every redirect too, so a public URL cannot redirect this proxy to a private address.
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      upstream = await fetch(nextUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "SOCP-Image-Downloader/1.0", "Accept": "image/avif,image/webp,image/*,*/*;q=0.8" }
      });
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
      const location = upstream.headers.get("location");
      if (!location || redirects === 3) return response.status(502).json({ error: "이미지 URL 리디렉션이 너무 많거나 올바르지 않습니다." });
      nextUrl = new URL(location, nextUrl).toString();
      if (badUrl(nextUrl)) return response.status(400).json({ error: "안전하지 않은 리디렉션 URL은 허용되지 않습니다." });
    }
    if (!upstream.ok) return response.status(upstream.status).json({ error: `원본 서버가 HTTP ${upstream.status}를 반환했습니다.` });
    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].toLowerCase();
    // Some CDNs return application/octet-stream for a valid image; allow it only when the URL has an image extension.
    const looksLikeImageUrl = IMAGE_EXTENSION.test(new URL(nextUrl).pathname);
    if (!contentType.startsWith("image/") && !(contentType === "application/octet-stream" && looksLikeImageUrl)) {
      return response.status(415).json({ error: `이미지 응답이 아닙니다 (Content-Type: ${contentType || "없음"}).` });
    }
    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return response.status(413).json({ error: "이미지 크기가 20MB 제한을 초과합니다." });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) return response.status(413).json({ error: "이미지 크기가 20MB 제한을 초과합니다." });
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Length", buffer.length);
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).send(buffer);
  } catch (error) {
    const message = error && error.name === "AbortError" ? "다운로드 시간이 20초를 초과했습니다." : "원본 이미지 서버에 연결하지 못했습니다. 접근 제한 또는 네트워크 오류일 수 있습니다.";
    return response.status(502).json({ error: message });
  } finally { clearTimeout(timer); }
};
