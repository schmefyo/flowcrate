import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { resolveLabelLinks } from "./label-lookup.server";

export const lookupLabelLinks = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ name: z.string().trim().min(1).max(200) }).parse(data))
  .handler(async ({ data }) => resolveLabelLinks(data.name));
