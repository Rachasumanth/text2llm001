export const resolveAuthLabel = async (
  provider: string,
  cfg: any,
  modelsPath: string,
  agentDir?: string,
  mode: any = "compact",
): Promise<{ label: string; source: string }> => {
  return { label: "test", source: "test" };
}

export const formatAuthLabel = (auth: { label: string; source: string }) => {
  if (!auth.source || auth.source === auth.label || auth.source === "missing") {
    return auth.label;
  }
  return `${auth.label} (${auth.source})`;
};

export const resolveProfileOverride = (params: any): { profileId?: string; error?: string } => {
  return {};
};
