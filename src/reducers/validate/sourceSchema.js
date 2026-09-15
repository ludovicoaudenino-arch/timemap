import { z } from "zod";

const sourceSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    thumbnail: z.string().optional(),
    paths: z.array(z.any()),
    type: z.string().optional(),
    affil_s: z.array(z.any()).optional(),
    url: z.string().optional(),
    description: z.string().optional(),
    parent: z.string().optional(),
    author: z.string().optional(),
    date: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict();

export default sourceSchema;
