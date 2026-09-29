import { useState } from "react";
import { toast } from "sonner";
import { overrideKey, usePreviewOverrides, useSaveOverride } from "@/lib/preview-overrides";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** ⚑ button + dialog letting the user pin the correct link for a track. */
export function FixLinkButton({
  artist,
  title,
  className = "",
}: {
  artist: string;
  title: string;
  className?: string;
}) {
  const fixKey = overrideKey(artist, title);
  const overrides = usePreviewOverrides();
  const saveOverride = useSaveOverride();
  const override = overrides.data?.[fixKey] ?? null;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const searchTerm = `${artist} - ${title}`.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUrl(override ?? "");
          setOpen(true);
        }}
        title={override ? "Edit your link for this track" : "Wrong track? Set the right link"}
        aria-label={`Fix the link for ${title}`}
        className={`shrink-0 font-mono text-xs ${
          override ? "text-primary" : "text-muted-foreground"
        } hover:text-primary ${className}`}
      >
        ⚑
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setUrl(override ?? "");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wrong track?</DialogTitle>
            <DialogDescription>
              Paste the correct link for “{searchTerm}”. YouTube links play here; anything else
              (Bandcamp, SoundCloud…) opens in a new tab.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            {override ? (
              <Button
                variant="ghost"
                onClick={() =>
                  saveOverride.mutate(
                    { key: fixKey, url: "" },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        toast.success("Correction removed");
                      },
                      onError: (e: Error) => toast.error(e.message),
                    },
                  )
                }
              >
                Remove
              </Button>
            ) : null}
            <Button
              disabled={!url.trim() || saveOverride.isPending}
              onClick={() =>
                saveOverride.mutate(
                  { key: fixKey, url: url.trim() },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      toast.success("Saved — this track now uses your link");
                    },
                    onError: (e: Error) => toast.error(e.message),
                  },
                )
              }
            >
              Save link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
