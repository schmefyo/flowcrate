import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, EmptyState } from "@/components/atlas/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { type CrateRow } from "@/lib/atlas";
import { MoodManager } from "@/components/atlas/MoodManager";
import { useMoods } from "@/lib/moods";

export const Route = createFileRoute("/_authenticated/crates/")({
  head: () => ({
    meta: [
      { title: "Crates — FlowCrate" },
      { name: "description", content: "Build crates of tracks for every mood and every room." },
      { property: "og:title", content: "Crates — FlowCrate" },
      { property: "og:description", content: "Crates of tracks for every mood and every room." },
    ],
  }),
  component: CratesPage,
});

function CratesPage() {
  const qc = useQueryClient();
  const moods = (useMoods().data ?? []).map((m) => m.name);
  const [open, setOpen] = useState(false);

  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: async () => {
      const [crates, links] = await Promise.all([
        supabase.from("crates").select("*").order("created_at", { ascending: false }),
        supabase.from("crate_tracks").select("crate_id"),
      ]);
      if (crates.error) throw crates.error;
      if (links.error) throw links.error;
      const counts = new Map<string, number>();
      for (const l of links.data) counts.set(l.crate_id, (counts.get(l.crate_id) ?? 0) + 1);
      return (crates.data as CrateRow[]).map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
    },
  });

  const createCrate = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("crates").insert({
        user_id: userId,
        name: String(form.get("name") ?? "").trim(),
        mood: String(form.get("mood") ?? "") || null,
        description: String(form.get("description") ?? "").trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crates"] });
      setOpen(false);
      toast.success("Crate created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = cratesQuery.data ?? [];

  return (
    <AppShell
      title="Crates"
      subtitle="Group tracks by mood, room, hour of the night — however you actually play."
      action={
        <div className="flex items-center gap-2">
          <MoodManager />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>New crate</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>New crate</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  createCrate.mutate(new FormData(e.currentTarget));
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required placeholder="5am basement" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mood">Mood</Label>
                  <select
                    id="mood"
                    name="mood"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">—</option>
                    {moods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" rows={2} />
                </div>
                <Button type="submit" className="w-full" disabled={createCrate.isPending}>
                  Create
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      {cratesQuery.isLoading ? (
        <EmptyState text="Loading crates…" />
      ) : rows.length === 0 ? (
        <EmptyState text="No crates yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <Link
              key={c.id}
              to="/crates/$crateId"
              params={{ crateId: c.id }}
              className="fc-crate-tile group border border-border p-5"
            >
              <div className="label-mono text-primary">{c.mood ?? "no mood set"}</div>
              <h2 className="fc-display-heading mt-2 text-xl group-hover:text-primary">{c.name}</h2>
              {c.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{c.description}</p>
              ) : null}
              <p className="mt-4 text-sm text-muted-foreground">
                {c.count} track{c.count === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
