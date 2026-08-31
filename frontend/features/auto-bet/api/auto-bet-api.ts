import {
  autoBetControlSnapshotSchema,
  type AutoBetControlSnapshot
} from "@/features/auto-bet/schemas/auto-bet-schemas";
import { crmHttp } from "@/lib/http";

export async function fetchAutoBetMonitorSnapshot() {
  const response = await crmHttp.get("/crm/auto-bet");
  return autoBetControlSnapshotSchema.parse(response.data);
}

export async function updateAutoBetControl(input: {
  enabled: boolean;
  total_stake_vnd: number;
}): Promise<AutoBetControlSnapshot> {
  const response = await crmHttp.put("/crm/auto-bet", input);
  return autoBetControlSnapshotSchema.parse(response.data);
}
