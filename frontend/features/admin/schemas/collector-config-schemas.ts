import { z } from "zod";

export const collectorConfigSchema = z.object({
  eightxbet_page_url: z.string(),
  eightxbet_base_url: z.string(),
  eightxbet_inplay_page_url: z.string().default(""),
  jun88_base_url: z.string(),
  jun88_bti_page_url: z.string(),
  jun88_saba_page_url: z.string(),
  jun88_cmd_page_url: z.string(),
  jun88_m9bet_page_url: z.string(),
  collector_proxy_enabled: z.boolean(),
  collector_proxy_protocol: z.string(),
  collector_proxy_server: z.string(),
  collector_proxy_bypass: z.string(),
  bti_proxy_enabled: z.boolean(),
  bti_proxy_protocol: z.string(),
  bti_proxy_server: z.string(),
  bti_proxy_bypass: z.string()
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;
