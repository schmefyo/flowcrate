import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { EditLabelDialog } from "@/components/atlas/EditLabelDialog";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { FullTrackPlayer } from "@/components/atlas/FullTrackPlayer";
import { AddToCrateButton } from "@/components/atlas/AddToCrateButton";
import { Button } from "@/components/ui/button";
import { deriveLabelLibrary, readLibraryPages, resolveLocalArtist } from "@/lib/label-library";

export const Route = createFileRoute("/_authenticated/labels_/$labelId")({
  head: () => ({ meta: [{ title: "Label library — Flowcrate" }] }),
  component: LabelDetailPage,
});

function LabelDetailPage() {
  const { labelId } = Route.useParams();
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(50);
  const label = useQuery({
    queryKey: ["labels", labelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labels")
        .select("*")
        .eq("id", labelId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const library = useQuery({
    queryKey: ["tracks", "label-library", labelId],
    enabled: !!label.data,
    queryFn: async () => {
      const [tracks, crates, memberships, followed] = await Promise.all([
        readLibraryPages((from, to) =>
          supabase
            .from("tracks")
            .select("*")
            .eq("label_id", labelId)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        readLibraryPages((from, to) =>
          supabase.from("crates").select("id, name").order("id").range(from, to),
        ),
        readLibraryPages((from, to) =>
          supabase
            .from("crate_tracks")
            .select("crate_id, track_id, tracks!inner(label_id)")
            .eq("tracks.label_id", labelId)
            .order("id")
            .range(from, to),
        ),
        readLibraryPages((from, to) =>
          supabase.from("followed_djs").select("name, aliases").order("id").range(from, to),
        ),
      ]);
      return {
        ...deriveLabelLibrary(labelId, tracks, memberships, crates),
        followed,
      };
    },
  });
  const row = label.data;
  const links = Array.isArray(row?.links)
    ? row.links.filter(
        (item): item is { label: string; url: string } =>
          !!item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof item["label"] === "string" &&
          typeof item["url"] === "string" &&
          /^https?:\/\//i.test(item["url"]),
      )
    : [];
  const artistName = (name: string) => {
    const target = resolveLocalArtist(name, library.data?.followed ?? []);
    return target ? (
      <Link
        to="/artists/$name"
        params={{ name: target }}
        className="hover:text-primary underline decoration-dotted"
      >
        {name}
      </Link>
    ) : (
      name
    );
  };
  return (
    <AppShell
      title={row?.name ?? "Label"}
      subtitle="Connections in your library."
      action={<Link to="/labels">All labels</Link>}
    >
      {label.isLoading ? (
        <EmptyState text="Loading label…" />
      ) : label.isError ? (
        <EmptyState text="Couldn't load this label right now." />
      ) : !row ? (
        <EmptyState text="Label not found in your library." />
      ) : (
        <>
          <section className="mb-8 border-b border-border pb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono text-xs text-muted-foreground">
                {[row.kind, row.city, row.country].filter(Boolean).join(" · ")}
              </p>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
            {row.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{row.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {row.website && (
                <a
                  href={/^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary underline"
                >
                  Website
                </a>
              )}
              {links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary underline"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </section>
          {library.isLoading ? (
            <EmptyState text="Loading library tracks…" />
          ) : library.isError ? (
            <EmptyState text="Couldn't load library connections right now." />
          ) : (
            <>
              <section className="mb-8">
                <h2 className="mb-4 text-xl font-semibold">
                  In your library{" "}
                  <span className="label-mono text-sm text-muted-foreground">
                    {library.data?.tracks.length ?? 0}
                  </span>
                </h2>
                {!library.data?.tracks.length ? (
                  <EmptyState text="No tracks assigned here yet." />
                ) : (
                  <>
                    <ul className="fc-catalogue-list divide-y divide-border border border-border">
                      {library.data.tracks.slice(0, visible).map((track) => (
                        <li
                          key={track.id}
                          className="fc-catalogue-row flex flex-wrap items-center gap-4 p-4"
                        >
                          <DiscoverPreview
                            artist={track.artist}
                            title={track.title}
                            initialSrc={track.preview_url}
                            playbackKey={`label-track-${track.id}`}
                          />
                          <FullTrackPlayer
                            artist={track.artist}
                            title={track.title}
                            url={track.url}
                            playbackKey={`label-track-${track.id}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{track.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {artistName(track.artist)}
                            </p>
                          </div>
                          <p className="label-mono text-xs text-muted-foreground">
                            {[
                              track.bpm ? `${track.bpm} BPM` : null,
                              track.musical_key,
                              track.release_year,
                              track.genre,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <AddToCrateButton trackId={track.id} title={track.title} />
                        </li>
                      ))}
                    </ul>
                    {visible < library.data.tracks.length && (
                      <Button
                        className="mt-4"
                        variant="outline"
                        onClick={() => setVisible((count) => count + 50)}
                      >
                        Show more tracks
                      </Button>
                    )}
                  </>
                )}
              </section>
              <div className="grid gap-8 md:grid-cols-2">
                <section>
                  <h2 className="mb-4 text-xl font-semibold">Artists in your library</h2>
                  <ul className="divide-y divide-border">
                    {library.data?.artists.map((artist) => (
                      <li key={artist.name} className="flex justify-between gap-3 py-3">
                        {artistName(artist.name)}
                        <span className="label-mono text-xs text-muted-foreground">
                          {artist.trackCount} tracks
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!library.data?.artists.length && (
                    <p className="text-sm text-muted-foreground">No artists represented yet.</p>
                  )}
                </section>
                <section>
                  <h2 className="mb-4 text-xl font-semibold">Crates using these tracks</h2>
                  <ul className="divide-y divide-border">
                    {library.data?.crates.map((crate) => (
                      <li key={crate.id} className="py-3">
                        <Link
                          to="/crates/$crateId"
                          params={{ crateId: crate.id }}
                          className="flex justify-between gap-3 hover:text-primary"
                        >
                          {crate.name}
                          <span className="label-mono text-xs">{crate.trackCount} tracks</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {!library.data?.crates.length && (
                    <p className="text-sm text-muted-foreground">
                      These tracks aren't in any crates yet.
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          <EditLabelDialog label={row} open={editing} onOpenChange={setEditing} />
        </>
      )}
    </AppShell>
  );
}
