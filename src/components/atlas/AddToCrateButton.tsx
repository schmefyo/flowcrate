import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CrateRow } from "@/lib/atlas";

/** Drops an existing track into any of your crates without leaving the list. */
export function AddToCrateButton({ trackId, title }: { trackId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

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
      qc.invalidateQueries({ queryKey: ["track-crates", trackId] });
      qc.invalidateQueries({ queryKey: ["crate-tracks", crateId] });
      toast.success("Added to crate");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const inCrates = new Set(membershipQuery.data ?? []);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Add to crate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add “{title}” to a crate</DialogTitle>
          </DialogHeader>
          {cratesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading crates…</p>
          ) : (cratesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No crates yet — build one first.</p>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
