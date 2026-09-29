import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LabelRow } from "@/lib/atlas";

/** Edit or delete a label / collective / party. */
export function EditLabelDialog({
  label,
  open,
  onOpenChange,
}: {
  label: LabelRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["labels-with-counts"] });
    qc.invalidateQueries({ queryKey: ["labels"] });
    qc.invalidateQueries({ queryKey: ["tracks"] });
  };

  const save = useMutation({
    mutationFn: async (form: FormData) => {
      if (!label) return;
      const { error } = await supabase
        .from("labels")
        .update({
          name: String(form.get("name") ?? "").trim(),
          kind: String(form.get("kind") ?? "label"),
          city: String(form.get("city") ?? "").trim() || null,
          country: String(form.get("country") ?? "").trim() || null,
          website: String(form.get("website") ?? "").trim() || null,
          notes: String(form.get("notes") ?? "").trim() || null,
        })
        .eq("id", label.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onOpenChange(false);
      toast.success("Label updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!label) return;
      // Detach tracks first so the delete isn't blocked by the reference.
      const { error: detachError } = await supabase
        .from("tracks")
        .update({ label_id: null })
        .eq("label_id", label.id);
      if (detachError) throw detachError;
      const { error } = await supabase.from("labels").delete().eq("id", label.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setConfirming(false);
      onOpenChange(false);
      toast.success("Label removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!label) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setConfirming(false);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {label.name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" name="name" defaultValue={label.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-kind">Kind</Label>
              <select
                id="edit-kind"
                name="kind"
                defaultValue={label.kind}
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
              <Label htmlFor="edit-city">City</Label>
              <Input id="edit-city" name="city" defaultValue={label.city ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-country">Country</Label>
              <Input id="edit-country" name="country" defaultValue={label.country ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-website">Website</Label>
            <Input id="edit-website" name="website" defaultValue={label.website ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Textarea id="edit-notes" name="notes" rows={2} defaultValue={label.notes ?? ""} />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {confirming ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  {remove.isPending ? "Removing…" : "Really remove"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
            )}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
