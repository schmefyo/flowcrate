import { useState } from "react";
import { Disc3 } from "lucide-react";

/** Accept an explicitly supplied asset; never infer or look up a profile image. */
export function ProfileImage({
  name,
  caption,
  imageUrl,
}: {
  name: string;
  caption: string;
  imageUrl?: string | null;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const src = imageUrl && /^(https?:\/\/|\/[^/])/i.test(imageUrl) ? imageUrl : null;
  return (
    <div className="flex aspect-square w-32 shrink-0 items-center justify-center border border-border bg-secondary/30 sm:w-44">
      {src && failedImage !== src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailedImage(src)}
        />
      ) : (
        <div
          className="flex flex-col items-center gap-4 text-primary"
          aria-label={`${name} ${caption === "ARTIST / DJ" ? "artist" : caption.toLowerCase()} profile`}
        >
          <Disc3 className="h-16 w-16" strokeWidth={1} aria-hidden="true" />
          <span className="label-mono text-[10px] tracking-widest">{caption}</span>
        </div>
      )}
    </div>
  );
}
