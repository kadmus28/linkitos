import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0);
}

function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8")) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIpv4(mapped[1]) : false;
  }
  return isPrivateIpv4(address);
}

async function assertPublicWebHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("El enlace debe usar HTTP o HTTPS.");
  if (url.username || url.password) throw new Error("El enlace no puede contener credenciales.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Ese dominio no está disponible para la vista previa.");
  }
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) {
    if (isPrivateAddress(host)) throw new Error("Ese dominio no está disponible para la vista previa.");
    throw new Error("Pega el nombre de la tienda en vez de una dirección IP.");
  }
  const [ipv4, ipv6] = await Promise.all([
    Deno.resolveDns(host, "A").catch(() => [] as string[]),
    Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("No se pudo verificar el dominio de la tienda.");
}

async function fetchPage(startUrl: URL) {
  let url = startUrl;
  for (let hop = 0; hop <= 4; hop++) {
    await assertPublicWebHost(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const page = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LinkitosPreview/1.0)",
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        },
      });
      if ([301, 302, 303, 307, 308].includes(page.status)) {
        const location = page.headers.get("location");
        if (!location || hop === 4) throw new Error("La tienda redirige demasiadas veces.");
        url = new URL(location, url);
        continue;
      }
      if (!page.ok) throw new Error("La tienda no ha permitido leer la ficha del producto.");
      const type = page.headers.get("content-type") || "";
      if (!type.toLowerCase().includes("text/html")) throw new Error("El enlace no parece una página de producto.");
      const length = Number(page.headers.get("content-length") || 0);
      if (length > 2_000_000) throw new Error("La página es demasiado grande para analizarla.");
      const reader = page.body?.getReader();
      if (!reader) throw new Error("La tienda no devolvió contenido.");
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 2_000_000) { await reader.cancel(); throw new Error("La página es demasiado grande para analizarla."); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { html: new TextDecoder().decode(bytes), finalUrl: url };
    } finally { clearTimeout(timeout); }
  }
  throw new Error("No se pudo abrir la página.");
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).trim();
}

function readMeta(html: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content) meta[key] = decodeHtml(attrs.content);
  }
  return meta;
}

function readJsonLd(html: string): { title?: string; image?: string; price?: number } {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = JSON.parse(decodeHtml(match[1]));
      const queue = Array.isArray(root) ? [...root] : [root];
      while (queue.length) {
        const value = queue.shift();
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value)) { queue.push(...value); continue; }
        if (value["@graph"]) queue.push(...(Array.isArray(value["@graph"]) ? value["@graph"] : [value["@graph"]]));
        const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (types.some((type) => String(type).toLowerCase() === "product")) {
          const offer = Array.isArray(value.offers) ? value.offers[0] : value.offers;
          const image = Array.isArray(value.image) ? value.image[0] : value.image;
          const parsedPrice = Number(offer?.price ?? offer?.lowPrice);
          return { title: typeof value.name === "string" ? value.name : undefined, image: typeof image === "string" ? image : image?.url, price: Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : undefined };
        }
        for (const child of Object.values(value)) if (child && typeof child === "object") queue.push(child);
      }
    } catch { /* Ignore invalid JSON-LD and continue with metadata tags. */ }
  }
  return {};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método no permitido." }, 405);
  const authorization = req.headers.get("Authorization");
  const apiKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const projectUrl = Deno.env.get("SUPABASE_URL");
  if (!authorization || !apiKey || !projectUrl) return response({ error: "Inicia sesión para completar los datos." }, 401);
  const authCheck = await fetch(`${projectUrl}/auth/v1/user`, { headers: { apikey: apiKey, Authorization: authorization } });
  if (!authCheck.ok) return response({ error: "Inicia sesión para completar los datos." }, 401);
  let submittedUrl = "";
  try { submittedUrl = String((await req.json()).url || "").trim(); }
  catch { return response({ error: "Añade un enlace válido." }, 400); }
  if (!submittedUrl || submittedUrl.length > 2048) return response({ error: "Añade un enlace válido." }, 400);
  try {
    const url = new URL(submittedUrl);
    const { html, finalUrl } = await fetchPage(url);
    const meta = readMeta(html);
    const jsonLd = readJsonLd(html);
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const title = jsonLd.title || meta["og:title"] || meta["twitter:title"] || (titleTag ? decodeHtml(titleTag.replace(/<[^>]+>/g, "")) : undefined);
    const rawImage = jsonLd.image || meta["og:image"] || meta["og:image:url"] || meta["twitter:image"];
    let image: string | undefined;
    if (rawImage) {
      try { const parsed = new URL(rawImage, finalUrl); if (["http:", "https:"].includes(parsed.protocol)) image = parsed.toString(); }
      catch { /* Ignore malformed image URLs. */ }
    }
    const rawPrice = jsonLd.price ?? meta["product:price:amount"] ?? meta["og:price:amount"] ?? meta["twitter:label1"];
    const numericPrice = rawPrice === undefined ? undefined : Number(String(rawPrice).replace(/[^\d,.-]/g, "").replace(",", "."));
    const price = Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : undefined;
    if (!title && !image && price === undefined) throw new Error("La tienda no ofrece los datos del producto. Puedes rellenarlos manualmente.");
    return response({ title: title?.slice(0, 180), image, price, canonicalUrl: finalUrl.toString() });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "No se pudieron leer los datos del enlace." }, 422);
  }
});
