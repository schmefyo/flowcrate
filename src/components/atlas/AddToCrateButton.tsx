import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CrateRow } from "@/lib/atlas";
import { createCrateAndAddTrack } from "@/lib/create-crate-and-add";

/** Drops an existing track into any of your crates without leaving the list. */
export function AddToCrateButton({ trackId, title }: { trackId: string; title: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add to crate
      </Button>
      <AddToCrateDialog trackId={trackId} title={title} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function AddToCrateDialog({
  trackId,
  title,
  open,
  onOpenChange,
}: {
  trackId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [newCrateName, setNewCrateName] = useState("");

  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("crates").select("*").order("name");
      if (error) throw error;
      return data as CrateRow[];
    },
    enabled: open,
  });

  const membershipQuery = useQuery({
    queryKey: ["track-crates", trackId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crate_tracks")
        .select("crate_id")
        .eq("track_id", trackId);
      if (error) throw error;
      return (data ?? []).map((r) => r.crate_id as string);
    },
    enabled: open,
  });

  const add = useMutation({
    mutationFn: async (crateId: string) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { count } = await supabase
        .from("crate_tracks")
        .select("id", { count: "exact", head: true })
        .eq("crate_id", crateId);
      const { error } = await supabase.from("crate_tracks").insert({
        user_id: userId,
        crate_id: crateId,
        track_id: trackId,
        position: count ?? 0,
      });
      if (error) throw error;
      return crateId;
    },
    onSuccess: (crateId) => {
      qc.invalidateQueries({ queryKey: ["tracks", "label-library"] });
      qc.invalidateQueries({ queryKey: ["track-crates", trackId] });
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      toast.success("Added to crate", {
        action: {
          label: "Go to Crate",
          onClick: () => navigate({ to: "/crates/$crateId", params: { crateId } }),
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createAndAdd = useMutation({
    mutationFn: async () => {
      const name = newCrateName.trim();
      if (!name) throw new Error("Give the crate a name first");
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      return createCrateAndAddTrack({
        createCrate: async () => {
          const { data: crate, error: crateError } = await supabase
            .from("crates")
            .insert({ user_id: userId, name })
            .select("id")
            .single();
          if (crateError) throw crateError;
          return crate.id;
        },
        addTrackToCrate: async (crateId) => {
          const { error } = await supabase.from("crate_tracks").insert({
            user_id: userId,
            crate_id: crateId,
            track_id: trackId,
            position: 0,
          });
          if (error) throw error;
        },
        removeEmptyCrate: async (crateId) => {
          await supabase.from("crates").delete().eq("id", crateId);
        },
      });
    },
    onSuccess: (crateId) => {
      qc.invalidateQueries({ queryKey: ["tracks", "label-library"] });
      qc.invalidateQueries({ queryKey: ["crates"] });
      qc.invalidateQueries({ queryKey: ["track-crates", trackId] });
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      setNewCrateName("");
      setCreating(false);
      onOpenChange(false);
      toast.success("Created crate and added track", {
        action: {
          label: "Go to Crate",
          onClick: () => navigate({ to: "/crates/$crateId", params: { crateId } }),
        },
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inCrates = new Set(membershipQuery.data ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCreating(false);
          setNewCrateName("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add “{title}” to a crate</DialogTitle>
        </DialogHeader>

        {creating ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              createAndAdd.mutate();
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>New crate name</span>
              <input
                autoFocus
                value={newCrateName}
                onChange={(event) => setNewCrateName(event.target.value)}
                placeholder="e.g. 5am basement"
                className="h-9 w-full rounded-sm border border-input bg-transparent px-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newCrateName.trim() || createAndAdd.isPending}>
                {createAndAdd.isPending ? "Creating…" : "Create and add track"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <Button variant="outline" className="w-full" onClick={() => setCreating(true)}>
              Create new crate
            </Button>
            {cratesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading crates…</p>
            ) : (cratesQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create your first crate to organize this track.
              </p>
            ) : (
              <ul className="grid gap-2">
                {(cratesQuery.data ?? []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={inCrates.has(c.id) || add.isPending}
                      onClick={() => add.mutate(c.id)}
                      className="flex w-full items-center justify-between rounded-sm border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:text-primary disabled:opacity-50 disabled:hover:border-border disabled:hover:text-foreground"
                    >
                      <span>{c.name}</span>
                      {inCrates.has(c.id) ? (
                        <span className="text-xs text-emerald-500">In crate</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
