import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveArtistLinks } from "./artist-lookup.server";

export const lookupArtistLinks = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ name: z.string().trim().min(1).max(200) }).parse(data))
  .handler(async ({ data }) => resolveArtistLinks(data.name));
