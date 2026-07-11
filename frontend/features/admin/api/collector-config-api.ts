import { crmHttp } from "@/lib/http";
import {
  collectorConfigSchema,
  type CollectorConfig
} from "@/features/admin/schemas/collector-config-schemas";

export async function fetchCollectorConfig() {
  const response = await crmHttp.get("/admin/collector-config");
  return collectorConfigSchema.parse(response.data);
}

export async function updateCollectorConfig(input: CollectorConfig) {
  const response = await crmHttp.put("/admin/collector-config", input);
  return collectorConfigSchema.parse(response.data);
}
