import type { ReactNode } from "react";
import type { LabelRow } from "@/lib/atlas";
import { ProfileImage } from "@/components/atlas/ProfileImage";

export function LabelIdentity({
  label,
  links,
  action,
  imageUrl,
}: {
  label: Pick<LabelRow, "name" | "kind" | "city" | "country" | "notes" | "website">;
  links: { label: string; url: string }[];
  action: ReactNode;
  /** Future enrichment can supply a reliable stored asset here. */
  imageUrl?: string | null;
}) {
  const caption = ["label", "collective", "party"].includes(label.kind)
    ? label.kind.toUpperCase()
    : "LABEL";
  return (
    <section
      aria-label="Label profile"
      className="mb-8 flex flex-col gap-6 border-b border-border pb-8 sm:flex-row"
    >
      <ProfileImage name={label.name} caption={caption} imageUrl={imageUrl ?? null} />
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="fc-page-title break-words">{label.name}</h1>
          {action}
        </div>
        <p className="label-mono text-xs text-muted-foreground">
          {[label.kind, label.city, label.country].filter(Boolean).join(" · ")}
        </p>
        {label.notes && (
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
            {label.notes}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {label.website && (
            <a
              href={
                /^https?:\/\//i.test(label.website) ? label.website : `https://${label.website}`
              }
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted hover:text-primary"
            >
              Website ↗
            </a>
          )}
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted hover:text-primary"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
