import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMoods, normalizeMood, moodsQueryKey, type MoodRow } from "@/lib/moods";

export function MoodManager() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newMood, setNewMood] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const moodsQuery = useMoods();
  const moods = moodsQuery.data ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: moodsQueryKey });
    void qc.invalidateQueries({ queryKey: ["tracks"] });
    void qc.invalidateQueries({ queryKey: ["crates"] });
  };

  const addMood = useMutation({
    mutationFn: async (raw: string) => {
      const name = normalizeMood(raw);
      if (!name) throw new Error("Give the mood a name");
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("moods")
        .insert({ user_id: userId, name, position: moods.length });
      if (error) throw new Error(error.code === "23505" ? "That mood already exists" : error.message);
    },
    onSuccess: () => {
      setNewMood("");
      invalidate();
      toast.success("Mood added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMood = useMutation({
    mutationFn: async ({ mood, raw }: { mood: MoodRow; raw: string }) => {
      const name = normalizeMood(raw);
      if (!name) throw new Error("Give the mood a name");
      if (name === mood.name) return;
      const { error } = await supabase.from("moods").update({ name }).eq("id", mood.id);
      if (error) throw new Error(error.code === "23505" ? "That mood already exists" : error.message);
      const { error: rpcError } = await supabase.rpc("rename_mood", {
        old_name: mood.name,
        new_name: name,
      });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Mood renamed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMood = useMutation({
    mutationFn: async (mood: MoodRow) => {
      const { error } = await supabase.from("moods").delete().eq("id", mood.id);
      if (error) throw error;
      const { error: rpcError } = await supabase.rpc("detach_mood", { old_name: mood.name });
      if (rpcError) throw rpcError;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Mood removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add / edit moods
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Moods & tags</DialogTitle>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addMood.mutate(newMood);
          }}
        >
          <Input
            value={newMood}
            onChange={(e) => setNewMood(e.target.value)}
            placeholder="New mood…"
            maxLength={40}
          />
          <Button type="submit" disabled={addMood.isPending}>
            Add
          </Button>
        </form>

        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
          {moods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No moods yet.</p>
          ) : (
            moods.map((m) =>
              editingId === m.id ? (
                <form
                  key={m.id}
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    renameMood.mutate({ mood: m, raw: draft });
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={40}
                    autoFocus
                  />
                  <Button type="submit" size="sm" disabled={renameMood.isPending}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </Button>
                </form>
              ) : (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm">{m.name}</span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(m.id);
                        setDraft(m.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={deleteMood.isPending}
                      onClick={() => deleteMood.mutate(m)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ),
            )
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Renaming updates the mood on your tracks and crates; removing takes it off them.
        </p>
      </DialogContent>
    </Dialog>
  );
}
