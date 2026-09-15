import { z } from "zod";

const shapeSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    shape: z.string().optional(),
    colour: z.string().optional(),
  })
  .strict();

export default shapeSchema;
