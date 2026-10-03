import type { ReactNode } from "react";
import { ProfileImage } from "@/components/atlas/ProfileImage";
import { artistIdentity } from "@/lib/artist-profile";
import type { ArtistLink } from "@/lib/artist-links";

export function ArtistIdentity({
  name,
  profile,
  links,
  action,
  navigation,
}: {
  name: string;
  profile: Parameters<typeof artistIdentity>[1];
  links: ArtistLink[];
  action: ReactNode;
  navigation?: ReactNode;
}) {
  const identity = artistIdentity(name, profile);
  return (
    <section
      aria-label="Artist profile"
      className="mb-8 flex flex-col gap-6 border-b border-border pb-8 sm:flex-row"
    >
      <ProfileImage name={name} caption="ARTIST / DJ" imageUrl={identity.imageUrl} />
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="fc-page-title break-words">{name}</h1>
          <div className="flex flex-wrap items-center gap-3">{action}</div>
        </div>
        <p className="text-sm text-muted-foreground">
          Follow the thread through known sets, tracks, and your library.
        </p>
        {identity.aliases.length > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="label-mono mr-2 text-xs">Also known as</span>
            {identity.aliases.join(" · ")}
          </p>
        )}
        {identity.scenes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {identity.scenes.map((scene) => (
              <span
                key={scene}
                className="label-mono border border-border px-2 py-1 text-xs text-muted-foreground"
              >
                {scene}
              </span>
            ))}
          </div>
        )}
        {identity.notes && (
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">
            {identity.notes}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted hover:text-primary"
            >
              {link.label}
              {link.key === "spotify" ? " search" : ""} ↗
            </a>
          ))}
        </div>
        {navigation}
      </div>
    </section>
  );
}
