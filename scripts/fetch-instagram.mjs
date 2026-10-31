// Lee tus últimas publicaciones de Instagram y las guarda en el repositorio.
// El token llega por una variable secreta de GitHub y nunca se escribe en ningún archivo.
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const TOKEN = process.env.INSTAGRAM_TOKEN;
const IG_ID = process.env.INSTAGRAM_ID;
const LIMIT = 12;                    // cuántas publicaciones guardar
const MAX_BYTES = 30 * 1024 * 1024;  // no descarga archivos de más de 30 MB

if (!TOKEN || !IG_ID) {
  console.error('Faltan INSTAGRAM_TOKEN o INSTAGRAM_ID.');
  process.exit(1);
}

const hide = (t) => String(t).split(TOKEN).join('***');
const FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
const HOSTS = [
  'https://graph.facebook.com/v26.0',
  'https://graph.instagram.com/v26.0',
];

async function getMedia() {
  let lastErr = '';
  for (const host of HOSTS) {
    const url = `${host}/${IG_ID}/media?fields=${FIELDS}&limit=${LIMIT}&access_token=${encodeURIComponent(TOKEN)}`;
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body.data)) {
        console.log(`Conexión correcta con ${host}: ${body.data.length} publicaciones.`);
        return body.data;
      }
      lastErr = `${host} -> HTTP ${res.status}: ${body.error?.message ?? 'sin detalle'}`;
    } catch (e) {
      lastErr = `${host} -> ${e.message}`;
    }
    console.error(hide(lastErr));
  }
  await diagnose();
  throw new Error('No se pudo leer Instagram. Último error: ' + hide(lastErr));
}

// Muestra a qué tiene acceso el token (nunca imprime el token en sí)
async function diagnose() {
  const base = HOSTS[0];
  const t = encodeURIComponent(TOKEN);
  const pruebas = [
    ['Quién es el token (me)', `${base}/me?fields=id,name&access_token=${t}`],
    ['Permisos del token (debug_token)', `${base}/debug_token?input_token=${t}&access_token=${t}`],
    ['Páginas con Instagram (me/accounts)', `${base}/me/accounts?fields=id,name,instagram_business_account&access_token=${t}`],
    ['Permisos concedidos (me/permissions)', `${base}/me/permissions?access_token=${t}`],
    ['Cuenta de Instagram directa', `${base}/${IG_ID}?fields=id,username&access_token=${t}`],
    ['Negocios del token (me/businesses)', `${base}/me/businesses?access_token=${t}`],
  ];
  console.log('--- DIAGNÓSTICO ---');
  for (const [nombre, url] of pruebas) {
    try {
      const res = await fetch(url);
      const txt = await res.text();
      console.log(`${nombre}: HTTP ${res.status}`);
      console.log(hide(txt).slice(0, 1500));
    } catch (e) {
      console.log(`${nombre}: error ${hide(e.message)}`);
    }
  }
  console.log('--- FIN DIAGNÓSTICO ---');
}

async function download(url, dest) {
  if (!url) return false;
  if (existsSync(dest)) return true;
  const res = await fetch(url);
  if (!res.ok) { console.warn('No se pudo descargar', dest, res.status); return false; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) { console.warn('Archivo muy grande, se omite:', dest); return false; }
  await writeFile(dest, buf);
  return true;
}

await mkdir('data', { recursive: true });
await mkdir('instagram', { recursive: true });

const media = await getMedia();
const items = [];
const keep = new Set();

for (const m of media) {
  const isVideo = m.media_type === 'VIDEO';
  const item = {
    id: m.id,
    tipo: isVideo ? 'video' : 'imagen',
    texto: m.caption ?? '',
    enlace: m.permalink,
    fecha: m.timestamp,
    imagen: null,
    video: null,
  };
  const img = isVideo ? m.thumbnail_url : m.media_url;
  if (await download(img, `instagram/${m.id}.jpg`)) { item.imagen = `instagram/${m.id}.jpg`; keep.add(`${m.id}.jpg`); }
  if (isVideo && await download(m.media_url, `instagram/${m.id}.mp4`)) { item.video = `instagram/${m.id}.mp4`; keep.add(`${m.id}.mp4`); }
  items.push(item);
}

// Borra archivos de publicaciones que ya no están entre las últimas
for (const f of await readdir('instagram')) {
  if (!keep.has(f)) await rm(`instagram/${f}`);
}

await writeFile('data/instagram.json', JSON.stringify(items, null, 2));
console.log(`Listo: ${items.length} publicaciones guardadas en data/instagram.json`);
