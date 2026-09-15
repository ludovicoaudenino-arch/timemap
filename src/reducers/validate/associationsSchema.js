import { z } from "zod";

const associationsSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    desc: z.string().optional(),
    mode: z.string(),
    filter_paths: z.array(z.any()).optional(),
  })
  .passthrough();

export default associationsSchema;
