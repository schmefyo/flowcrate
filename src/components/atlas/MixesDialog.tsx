import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lookupMixes } from "@/lib/mixesdb.functions";
import { lookupMixesWithFallback } from "@/lib/mixesdb-browser-fallback";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TrackWithLabel } from "@/lib/atlas";

type Props = {
  track: TrackWithLabel | null;
  knownTotal?: number | undefined;
  onOpenChange: (open: boolean) => void;
};

export function MixesDialog({ track, knownTotal, onOpenChange }: Props) {
  const lookup = useServerFn(lookupMixes);
  const query = useQuery({
    queryKey: ["mixesdb", track?.artist, track?.title],
    enabled: !!track,
    staleTime: 1000 * 60 * 30,
    retry: false,
    queryFn: async () =>
      lookupMixesWithFallback({ data: { artist: track!.artist, title: track!.title } }, lookup),
  });

  return (
    <Dialog open={!!track} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Played in mixes</DialogTitle>
        </DialogHeader>
        {track ? (
          <p className="text-sm text-muted-foreground">
            {track.artist} — {track.title}
          </p>
        ) : null}

        {query.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <p>Finding mixes…</p>
            {typeof knownTotal === "number" ? (
              <p className="mt-1 text-xs">
                {knownTotal} tracklist{knownTotal === 1 ? "" : "s"} found previously
              </p>
            ) : null}
          </div>
        ) : query.isError ? (
          <p className="py-6 text-center text-sm text-destructive">
            Couldn’t load mixes right now.
          </p>
        ) : !query.data?.hits.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No mixes found for this track.
          </p>
        ) : (
          <>
            <p className="label-mono text-xs text-muted-foreground">
              {query.data.total} tracklist{query.data.total === 1 ? "" : "s"} mention this
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {query.data.hits.map((hit) => (
                <li key={hit.url} className="p-3">
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:text-primary"
                  >
                    {hit.title}
                  </a>
                  {hit.snippet ? (
                    <p className="mt-1 text-xs text-muted-foreground">{hit.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {query.data?.searchUrl ? (
          <a
            href={query.data.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open this search on MixesDB →
          </a>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
