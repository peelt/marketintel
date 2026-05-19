import { httpJson } from "./http";
import type { AdapterCapabilities } from "./types";

/**
 * Companies House (UK) adapter.
 *
 * Free with API key. Used sparingly — primarily to resolve UK issuer detail
 * (registered office, incorporation date, SIC codes) for new IPOs without
 * existing universe entries.
 *
 * The API key (free) is sent via HTTP Basic auth with the key as username.
 * Reference: https://developer-specs.company-information.service.gov.uk
 */

const BASE = "https://api.company-information.service.gov.uk";
const HOST_THROTTLE_MS = 500; // CH allows 600 req per 5 min; conservative.

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) throw new Error("COMPANIES_HOUSE_API_KEY is not set");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

interface CompanyProfile {
  company_number: string;
  company_name: string;
  date_of_creation?: string;
  type: string;
  sic_codes?: string[];
  registered_office_address?: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
}

export async function fetchCompanyProfile(companyNumber: string): Promise<CompanyProfile> {
  return httpJson<CompanyProfile>(`${BASE}/company/${encodeURIComponent(companyNumber)}`, {
    headers: { Authorization: authHeader() },
    hostThrottleMs: HOST_THROTTLE_MS,
  });
}

export const capabilities: AdapterCapabilities = {
  name: "companies_house",
  paid: false, // Free with registration
  readinessCheck: () =>
    process.env.COMPANIES_HOUSE_API_KEY ? null : "COMPANIES_HOUSE_API_KEY not set",
  provides: ["securities"],
};
