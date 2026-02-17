type StateDirEnvSnapshot = {
  TEXT2LLMStateDir: string | undefined;
  clawdbotStateDir: string | undefined;
};

export function snapshotStateDirEnv(): StateDirEnvSnapshot {
  return {
    TEXT2LLMStateDir: process.env.TEXT2LLM_STATE_DIR,
    clawdbotStateDir: process.env.CLAWDBOT_STATE_DIR,
  };
}

export function restoreStateDirEnv(snapshot: StateDirEnvSnapshot): void {
  if (snapshot.TEXT2LLMStateDir === undefined) {
    delete process.env.TEXT2LLM_STATE_DIR;
  } else {
    process.env.TEXT2LLM_STATE_DIR = snapshot.TEXT2LLMStateDir;
  }
  if (snapshot.clawdbotStateDir === undefined) {
    delete process.env.CLAWDBOT_STATE_DIR;
  } else {
    process.env.CLAWDBOT_STATE_DIR = snapshot.clawdbotStateDir;
  }
}

export function setStateDirEnv(stateDir: string): void {
  process.env.TEXT2LLM_STATE_DIR = stateDir;
  delete process.env.CLAWDBOT_STATE_DIR;
}
