import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { LabelRow } from "@/lib/atlas";
import { labelLinks } from "@/lib/label-links";
import { lookupLabelLinks } from "@/lib/label-lookup.functions";
import { EditLabelDialog } from "@/components/atlas/EditLabelDialog";

type SortKey = "name" | "tracks" | "recent";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "tracks", label: "Tracks" },
  { value: "recent", label: "Recently added" },
];

export const Route = createFileRoute("/_authenticated/labels")({
  head: () => ({
    meta: [
      { title: "Labels & collectives — Flowcrate" },
      {
        name: "description",
        content: "Follow the labels, crews and collectives behind the music you love.",
      },
      { property: "og:title", content: "Labels & collectives — Flowcrate" },
      { property: "og:description", content: "The crews behind the records you keep." },
    ],
  }),
  component: LabelsPage,
});

function LabelsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [editing, setEditing] = useState<LabelRow | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const labelsQuery = useQuery({
    queryKey: ["labels-with-counts"],
    queryFn: async () => {
      const [labels, tracks] = await Promise.all([
        supabase.from("labels").select("*").order("name"),
        supabase.from("tracks").select("label_id"),
      ]);
      if (labels.error) throw labels.error;
      if (tracks.error) throw tracks.error;
      const counts = new Map<string, number>();
      for (const t of tracks.data) {
        if (t.label_id) counts.set(t.label_id, (counts.get(t.label_id) ?? 0) + 1);
      }
      return (labels.data as LabelRow[]).map((l) => ({ ...l, trackCount: counts.get(l.id) ?? 0 }));
    },
  });

  const createLabel = useMutation({
    mutationFn: async (form: FormData) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("labels").insert({
        user_id: userId,
        name: String(form.get("name") ?? "").trim(),
        kind: String(form.get("kind") ?? "label"),
        city: String(form.get("city") ?? "").trim() || null,
        country: String(form.get("country") ?? "").trim() || null,
        website: String(form.get("website") ?? "").trim() || null,
        notes: String(form.get("notes") ?? "").trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels-with-counts"] });
      qc.invalidateQueries({ queryKey: ["labels"] });
      setOpen(false);
      toast.success("Added to your network");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error: detachError } = await supabase
        .from("tracks")
        .update({ label_id: null })
        .eq("label_id", id);
      if (detachError) throw detachError;
      const { error } = await supabase.from("labels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirmRemoveId(null);
      qc.invalidateQueries({ queryKey: ["labels-with-counts"] });
      qc.invalidateQueries({ queryKey: ["labels"] });
      qc.invalidateQueries({ queryKey: ["tracks"] });
      toast.success("Label removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Resolve real links for any label we haven't looked up yet, quietly in the
  // background. links_checked_at marks a label as already attempted.
  const attempted = useRef(new Set<string>());
  const resolving = useRef(false);

  useEffect(() => {
    const pending = (labelsQuery.data ?? []).filter(
      (l) => !l.links_checked_at && !attempted.current.has(l.id),
    );
    if (pending.length === 0 || resolving.current) return;
    resolving.current = true;
    (async () => {
      let found = 0;
      for (const l of pending) {
        attempted.current.add(l.id);
        try {
          const result = await lookupLabelLinks({ data: { name: l.name } });
          const patch: {
            links: typeof result.links;
            links_checked_at: string;
            website?: string;
          } = { links: result.links, links_checked_at: new Date().toISOString() };
          if (result.website && !l.website) patch.website = result.website;
          await supabase.from("labels").update(patch).eq("id", l.id);
          found += result.links.length;
        } catch {
          // Leave it for a later visit.
          attempted.current.delete(l.id);
        }
      }
      resolving.current = false;
      if (found > 0) qc.invalidateQueries({ queryKey: ["labels-with-counts"] });
    })();
  }, [labelsQuery.data, qc]);

  const rows = useMemo(() => {
    const base = [...(labelsQuery.data ?? [])];
    switch (sort) {
      case "tracks":
        return base.sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));
      case "recent":
        return base.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      default:
        return base.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [labelsQuery.data, sort]);

  return (
    <AppShell
      title="Labels & collectives"
      subtitle="The labels your records come from."
      action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add label</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add a label or collective</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                createLabel.mutate(new FormData(e.currentTarget));
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kind">Kind</Label>
                  <select
                    id="kind"
                    name="kind"
                    defaultValue="label"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="label">Label</option>
                    <option value="collective">Collective</option>
                    <option value="party">Party</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" name="country" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" name="website" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" rows={2} />
              </div>
              <Button type="submit" className="w-full" disabled={createLabel.isPending}>
                Save
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      {labelsQuery.isLoading ? (
        <EmptyState text="Loading labels…" />
      ) : rows.length === 0 ? (
        <EmptyState text="No labels yet." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="label-mono text-xs text-muted-foreground">
              {rows.length} label{rows.length === 1 ? "" : "s"}
            </p>
            <Label htmlFor="label_sort_key" className="text-xs text-muted-foreground">
              Sort by
            </Label>
            <select
              id="label_sort_key"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((l) => {
              const links = labelLinks(l.name, l.website, l.links);
              return (
                <li key={l.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {l.trackCount} track{l.trackCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="label-mono mt-1 text-xs text-muted-foreground">
                      {l.kind}
                      {l.city ? ` · ${l.city}` : ""}
                      {l.country ? `, ${l.country}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {links.map((link) => (
                        <a
                          key={link.key}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline decoration-dotted hover:text-primary"
                        >
                          {link.label}
                        </a>
                      ))}
                      {!l.links_checked_at ? <span>finding links…</span> : null}
                    </div>
                    {l.notes ? (
                      <p className="mt-2 text-sm text-muted-foreground">{l.notes}</p>
                    ) : null}
                  </div>

                  <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                    Edit
                  </Button>
                  {confirmRemoveId === l.id ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(l.id)}
                    >
                      {remove.isPending ? "Removing…" : "Really remove"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setConfirmRemoveId(l.id)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <EditLabelDialog
        label={editing}
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      />
    </AppShell>
  );
}
