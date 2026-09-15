import { z } from "zod";

const siteSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    site: z.string(),
    latitude: z.string(),
    longitude: z.string(),
    enabled: z.string().optional(),
  })
  .strict();

export default siteSchema;
