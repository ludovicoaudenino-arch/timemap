import { z } from "zod";

const regionSchema = z
  .object({
    name: z.string(),
    items: z.array(z.any()),
  })
  .strict();

export default regionSchema;
