import { dbFor } from "@/lib/org/scoped-db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/crypto";
import {
  getEnvCredentials,
  type AzureCredentials,
} from "@/lib/azure/document-intelligence";

/** Hosts an admin may point a project at. The key is only ever sent there. */
const ALLOWED_HOST_SUFFIXES = [
  ".cognitiveservices.azure.com",
  ".api.cognitive.microsoft.com",
  ".cognitiveservices.azure.us",
  ".cognitiveservices.azure.cn",
];

export function validateAzureEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    throw new AppError("VALIDATION_001", "Azure endpoint must be a full https:// URL.");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    !ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    throw new AppError(
      "VALIDATION_001",
      "Azure endpoint must be an https URL on an Azure Cognitive Services host (e.g. https://<name>.cognitiveservices.azure.com/)."
    );
  }
  return `${url.protocol}//${url.host}/`;
}

/**
 * Credentials for a project: its own saved key if present, otherwise the
 * server-wide .env credentials. Throws a clear error if neither exists.
 */
export async function getProjectAzureCredentials(
  projectId: string,
  orgId: string
): Promise<AzureCredentials> {
  const project = await dbFor(orgId).project.findUnique({
    where: { id: projectId },
    select: { azureEndpoint: true, azureKeyEnc: true, name: true },
  });
  if (!project) throw new AppError("NOT_FOUND_001", "Project not found");

  if (project.azureEndpoint && project.azureKeyEnc) {
    return {
      endpoint: project.azureEndpoint,
      key: decryptSecret(project.azureKeyEnc),
    };
  }

  const fallback = getEnvCredentials();
  if (fallback) return fallback;

  throw new AppError(
    "CONFIG_001",
    `AI extraction is not set up for "${project.name}". Ask an admin to add the Azure endpoint and key in the project settings.`
  );
}
