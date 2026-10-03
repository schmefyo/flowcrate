import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { EditLabelDialog } from "@/components/atlas/EditLabelDialog";
import { LabelIdentity } from "@/components/atlas/LabelIdentity";
import { DiscoverPreview } from "@/components/atlas/DiscoverPreview";
import { FullTrackPlayer } from "@/components/atlas/FullTrackPlayer";
import { AddToCrateButton } from "@/components/atlas/AddToCrateButton";
import { Button } from "@/components/ui/button";
import { deriveLabelLibrary, localArtistFollowState, readLibraryPages } from "@/lib/label-library";
import { followArtist } from "@/lib/artist-follow";
import { useSourceCacheWarmup } from "@/lib/source-cache-warmup";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/labels_/$labelId")({
  head: () => ({ meta: [{ title: "Label library — Flowcrate" }] }),
  component: LabelDetailPage,
});

function LabelDetailPage() {
  const { labelId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const warmSourceCache = useSourceCacheWarmup();
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
  const follow = useMutation({
    mutationFn: (name: string) =>
      followArtist(
        {
          name,
          url: `https://www.mixesdb.com/w/Category:${encodeURIComponent(name.replace(/ /g, "_"))}`,
        },
        undefined,
        { identity: "library" },
      ),
    onSuccess: (result, followedName) => {
      const primary = result.names[0]!;
      qc.setQueryData<typeof library.data>(["tracks", "label-library", labelId], (previous) =>
        previous
          ? {
              ...previous,
              followed: [
                ...previous.followed.filter((artist) => artist.name !== primary),
                { name: primary, aliases: result.names.slice(1) },
              ],
            }
          : previous,
      );
      qc.invalidateQueries({ queryKey: ["artist"] });
      qc.invalidateQueries({ queryKey: ["artists"] });
      qc.invalidateQueries({ queryKey: ["followed-djs"] });
      qc.invalidateQueries({ queryKey: ["tracks", "label-library"] });
      warmSourceCache(result.names);
      const state = localArtistFollowState(
        followedName,
        qc.getQueryData<NonNullable<typeof library.data>>(["tracks", "label-library", labelId])
          ?.followed ?? [],
      );
      toast.success(
        "Following — finding sets…",
        state.status === "followed"
          ? {
              action: {
                label: "View artist",
                onClick: () => navigate({ to: "/artists/$name", params: { name: state.name } }),
              },
            }
          : undefined,
      );
    },
    onError: (error: Error) => toast.error(error.message),
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
    const state = localArtistFollowState(name, library.data?.followed ?? []);
    const target = state.status === "followed" ? state.name : null;
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
      header={
        row ? (
          <LabelIdentity
            label={row}
            links={links}
            action={
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            }
          />
        ) : undefined
      }
    >
      {label.isLoading ? (
        <EmptyState text="Loading label…" />
      ) : label.isError ? (
        <EmptyState text="Couldn't load this label right now." />
      ) : !row ? (
        <EmptyState text="Label not found in your library." />
      ) : (
        <>
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
                    {library.data?.artists.map((artist) => {
                      const state = localArtistFollowState(
                        artist.name,
                        library.data?.followed ?? [],
                      );
                      return (
                        <li
                          key={artist.name}
                          className="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            {artistName(artist.name)}
                            <p className="label-mono mt-1 text-xs text-muted-foreground">
                              {artist.trackCount} tracks
                            </p>
                          </div>
                          {state.status === "followed" ? (
                            <span className="label-mono text-xs text-primary">Following</span>
                          ) : state.status === "available" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={follow.isPending}
                              onClick={() => follow.mutate(state.name)}
                            >
                              {follow.isPending && follow.variables === state.name
                                ? "Following…"
                                : "Follow"}
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
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
