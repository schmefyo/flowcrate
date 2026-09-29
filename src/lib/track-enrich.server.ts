import type { ImportedTrack } from "./track-import.server";

const UA = "FlowCrate/1.0 (track metadata lookup)";

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Strip remix/edit/feat noise so loose searches have a chance. */
export function coreTitle(title: string): string {
  return title
    .replace(/\s*[-–]\s*(remix+|edit|mix|version|remixx+|bootleg|vip)\s*$/i, "")
    .replace(/\s*\((feat|ft)\.?[^)]*\)/gi, "")
    .replace(/\s*\(.*?(remix|edit|mix|version)\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function firstArtist(artist: string): string {
  return (artist.split(/,|&| x | vs\.? | feat\.? | ft\.? /i)[0] ?? artist).trim();
}

/* ---------------- MusicBrainz ---------------- */

async function mbJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** MusicBrainz: label, release year, and sometimes genre tags. */
export async function enrichFromMusicBrainz(out: ImportedTrack): Promise<void> {
  if (!out.title || !out.artist) return;
  if (out.labelName && out.releaseYear && out.genre) return;

  const q = `recording:"${coreTitle(out.title)}" AND artist:"${firstArtist(out.artist)}"`;
  const data = await mbJson(
    `https://musicbrainz.org/ws/2/recording?fmt=json&limit=5&inc=releases+tags&query=${encodeURIComponent(q)}`,
  );
  const rec = Array.isArray(data?.recordings) ? data.recordings[0] : null;
  if (!rec) return;

  if (!out.genre && Array.isArray(rec.tags) && rec.tags.length) {
    const best = [...rec.tags].sort((a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0))[0];
    if (best?.name) out.genre = String(best.name);
  }
  const rel = Array.isArray(rec.releases) ? rec.releases[0] : null;
  if (!out.releaseYear && rel?.date) {
    const y = Number(String(rel.date).slice(0, 4));
    if (y >= 1900 && y <= 2100) out.releaseYear = y;
  }
  if (!out.labelName && rel?.id) {
    const full = await mbJson(`https://musicbrainz.org/ws/2/release/${rel.id}?fmt=json&inc=labels`);
    const label = Array.isArray(full?.["label-info"]) ? full["label-info"][0]?.label?.name : null;
    if (label) out.labelName = String(label);
  }
}

/* ---------------- Deezer (BPM + album/label-ish data) ---------------- */

/** Deezer's public API needs no key and exposes bpm on many tracks. */
export async function enrichFromDeezer(out: ImportedTrack): Promise<void> {
  if (!out.title || !out.artist) return;
  if (out.bpm && out.releaseYear && out.labelName) return;
  try {
    const q = `artist:"${firstArtist(out.artist)}" track:"${coreTitle(out.title)}"`;
    const res = await fetch(
      `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(q)}`,
      { headers: { "user-agent": UA, accept: "application/json" } },
    );
    if (!res.ok) return;
    const json = (await res.json()) as any;
    const hit = Array.isArray(json?.data) ? json.data[0] : null;
    if (!hit?.id) return;

    const detRes = await fetch(`https://api.deezer.com/track/${hit.id}`, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!detRes.ok) return;
    const det = (await detRes.json()) as any;
    if (!out.bpm && typeof det?.bpm === "number" && det.bpm >= 60) out.bpm = Math.round(det.bpm);
    if (!out.releaseYear && typeof det?.release_date === "string") {
      const y = Number(det.release_date.slice(0, 4));
      if (y >= 1900 && y <= 2100) out.releaseYear = y;
    }
    if (!out.previewUrl && typeof det?.preview === "string" && det.preview) {
      out.previewUrl = det.preview;
    }
    if (!out.labelName && det?.album?.id) {
      const albRes = await fetch(`https://api.deezer.com/album/${det.album.id}`, {
        headers: { "user-agent": UA, accept: "application/json" },
      });
      if (albRes.ok) {
        const alb = (await albRes.json()) as any;
        if (alb?.label) out.labelName = String(alb.label);
        if (!out.genre && Array.isArray(alb?.genres?.data) && alb.genres.data[0]?.name) {
          out.genre = String(alb.genres.data[0].name);
        }
      }
    }
  } catch {
    /* ignore */
  }
}

export { norm };
