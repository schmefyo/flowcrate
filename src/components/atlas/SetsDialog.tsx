import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { normalizeArtistName } from "@/lib/artist-name";
import { eventDateForSet } from "@/lib/set-date";

type Set = { title: string; url: string; dj?: string; date?: string | null };

type Props = {
  track: { artist: string; title: string; sets: Set[] } | null;
  dj: string | null;
  onOpenChange: (open: boolean) => void;
};

export function SetsDialog({ track, dj, onOpenChange }: Props) {
  const sets = track ? dedupeSets(track.sets) : [];
  return (
    <Dialog open={!!track} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Played in {dj ?? "DJ"}'s sets</DialogTitle>
        </DialogHeader>
        {track ? (
          <DialogDescription>
            {track.artist} — {track.title}
          </DialogDescription>
        ) : null}

        {!track || !sets.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No set details available.
          </p>
        ) : (
          <>
            <p className="label-mono text-xs text-muted-foreground">
              {sets.length} set{sets.length === 1 ? "" : "s"}
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {sets.map((set) => (
                <li key={set.url} className="p-3">
                  <a
                    href={set.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:text-primary"
                  >
                    {set.title}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function dedupeSets(sets: Set[]): Set[] {
  const seen = new Set<string>();
  return sets.filter((set) => {
    const day = eventDateForSet(set);
    const dj = set.dj ? normalizeArtistName(set.dj) : "";
    const fallback = set.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = `${dj}|${day ?? fallback}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
