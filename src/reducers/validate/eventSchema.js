import { z } from "zod";

function zodFromCustom(custom) {
  const output = {};
  if (Array.isArray(custom)) {
    custom.forEach((field) => {
      if (field.kind === "text" || field.kind === "link") {
        output[field.key] = z.string().optional();
      }
      if (field.kind === "list") {
        output[field.key] = z.array(z.any()).optional();
      }
    });
  }
  return output;
}

function createEventSchema(custom) {
  return z
    .object({
      id: z.any().optional(),
      description: z.string(),
      date: z.string().optional(),
      time: z.string().optional(),
      time_precision: z.string().optional(),

      /* map */
      location: z.string().optional(),
      latitude: z.string().optional(),
      longitude: z.string().optional(),
      /* space */
      x: z.string().optional(),
      y: z.string().optional(),
      z: z.string().optional(),

      type: z.string().optional(),
      category: z.string().optional(),
      category_full: z.string().optional(),
      associations: z.array(z.any()).optional().default([]),
      sources: z.array(z.any()).optional(),
      comments: z.string().optional(),
      time_display: z.string().optional(),
      // nested
      narrative___stepStyles: z.array(z.any()).optional(),
      shape: z.any().optional(),
      colour: z.string().optional(),
      ...zodFromCustom(custom),
    })
    .passthrough()
    .refine(
      (data) => {
        const hasLat = data.latitude !== undefined && data.latitude !== "";
        const hasLon = data.longitude !== undefined && data.longitude !== "";
        return (hasLat && hasLon) || (!hasLat && !hasLon);
      },
      { message: "latitude and longitude must be provided together" }
    )
    .refine(
      (data) => {
        const hasDate = data.date !== undefined && data.date !== "";
        const hasLat = data.latitude !== undefined && data.latitude !== "";
        return hasDate || hasLat;
      },
      { message: "at least one of date or latitude is required" }
    );
}

export default createEventSchema;
