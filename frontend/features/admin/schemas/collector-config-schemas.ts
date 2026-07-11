import { z } from "zod";

export const collectorConfigSchema = z.object({
  eightxbet_page_url: z.string(),
  eightxbet_base_url: z.string(),
  jun88_base_url: z.string(),
  jun88_bti_page_url: z.string(),
  jun88_saba_page_url: z.string(),
  jun88_cmd_page_url: z.string(),
  jun88_m9bet_page_url: z.string()
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;
