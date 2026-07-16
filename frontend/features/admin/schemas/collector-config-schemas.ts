import { z } from "zod";

export const collectorConfigSchema = z.object({
  eightxbet_page_url: z.string(),
  eightxbet_base_url: z.string(),
  eightxbet_inplay_page_url: z.string().default(""),
  jun88_base_url: z.string(),
  jun88_cmd_page_url: z.string(),
  collector_proxyxoay_token: z.string()
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;
