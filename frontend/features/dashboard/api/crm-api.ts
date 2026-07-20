import {
  dashboardSnapshotSchema,
  matchedFixturesSnapshotSchema,
  opportunityBoardSchema
} from "@/features/dashboard/schemas/crm-schemas";
import { crmHttp } from "@/lib/http";

export async function fetchDashboardSnapshot() {
  const response = await crmHttp.get("/crm/dashboard");
  return dashboardSnapshotSchema.parse(response.data);
}

export async function fetchOpportunityBoard() {
  const response = await crmHttp.get("/crm/opportunity-board");
  return opportunityBoardSchema.parse(response.data);
}

export async function fetchMatchedFixtures() {
  const response = await crmHttp.get("/crm/matched-fixtures");
  return matchedFixturesSnapshotSchema.parse(response.data);
}
