import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

describe("Nix integration (U3, U5, U9)", () => {
  describe("U3: isNixMode env var detection", () => {
    it("isNixMode is false when TEXT2LLM_NIX_MODE is not set", async () => {
      await withEnvOverride({ TEXT2LLM_NIX_MODE: undefined }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is false when TEXT2LLM_NIX_MODE is empty", async () => {
      await withEnvOverride({ TEXT2LLM_NIX_MODE: "" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is false when TEXT2LLM_NIX_MODE is not '1'", async () => {
      await withEnvOverride({ TEXT2LLM_NIX_MODE: "true" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is true when TEXT2LLM_NIX_MODE=1", async () => {
      await withEnvOverride({ TEXT2LLM_NIX_MODE: "1" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(true);
      });
    });
  });

  describe("U5: CONFIG_PATH and STATE_DIR env var overrides", () => {
    it("STATE_DIR defaults to ~/.text2llm when env not set", async () => {
      await withEnvOverride({ TEXT2LLM_STATE_DIR: undefined }, async () => {
        const { STATE_DIR } = await import("./config.js");
        expect(STATE_DIR).toMatch(/\.text2llm$/);
      });
    });

    it("STATE_DIR respects TEXT2LLM_STATE_DIR override", async () => {
      await withEnvOverride({ TEXT2LLM_STATE_DIR: "/custom/state/dir" }, async () => {
        const { STATE_DIR } = await import("./config.js");
        expect(STATE_DIR).toBe(path.resolve("/custom/state/dir"));
      });
    });

    it("STATE_DIR respects TEXT2LLM_HOME when state override is unset", async () => {
      const customHome = path.join(path.sep, "custom", "home");
      await withEnvOverride(
        { TEXT2LLM_HOME: customHome, TEXT2LLM_STATE_DIR: undefined },
        async () => {
          const { STATE_DIR } = await import("./config.js");
          expect(STATE_DIR).toBe(path.join(path.resolve(customHome), ".text2llm"));
        },
      );
    });

    it("CONFIG_PATH defaults to TEXT2LLM_HOME/.text2llm/text2llm.json", async () => {
      const customHome = path.join(path.sep, "custom", "home");
      await withEnvOverride(
        {
          TEXT2LLM_HOME: customHome,
          TEXT2LLM_CONFIG_PATH: undefined,
          TEXT2LLM_STATE_DIR: undefined,
        },
        async () => {
          const { CONFIG_PATH } = await import("./config.js");
          expect(CONFIG_PATH).toBe(
            path.join(path.resolve(customHome), ".text2llm", "text2llm.json"),
          );
        },
      );
    });

    it("CONFIG_PATH defaults to ~/.text2llm/text2llm.json when env not set", async () => {
      await withEnvOverride(
        { TEXT2LLM_CONFIG_PATH: undefined, TEXT2LLM_STATE_DIR: undefined },
        async () => {
          const { CONFIG_PATH } = await import("./config.js");
          expect(CONFIG_PATH).toMatch(/\.text2llm[\\/]text2llm\.json$/);
        },
      );
    });

    it("CONFIG_PATH respects TEXT2LLM_CONFIG_PATH override", async () => {
      await withEnvOverride({ TEXT2LLM_CONFIG_PATH: "/nix/store/abc/text2llm.json" }, async () => {
        const { CONFIG_PATH } = await import("./config.js");
        expect(CONFIG_PATH).toBe(path.resolve("/nix/store/abc/text2llm.json"));
      });
    });

    it("CONFIG_PATH expands ~ in TEXT2LLM_CONFIG_PATH override", async () => {
      await withTempHome(async (home) => {
        await withEnvOverride({ TEXT2LLM_CONFIG_PATH: "~/.text2llm/custom.json" }, async () => {
          const { CONFIG_PATH } = await import("./config.js");
          expect(CONFIG_PATH).toBe(path.join(home, ".text2llm", "custom.json"));
        });
      });
    });

    it("CONFIG_PATH uses STATE_DIR when only state dir is overridden", async () => {
      await withEnvOverride(
        {
          TEXT2LLM_CONFIG_PATH: undefined,
          TEXT2LLM_STATE_DIR: "/custom/state",
        },
        async () => {
          const { CONFIG_PATH } = await import("./config.js");
          expect(CONFIG_PATH).toBe(path.join(path.resolve("/custom/state"), "text2llm.json"));
        },
      );
    });
  });

  describe("U5b: tilde expansion for config paths", () => {
    it("expands ~ in common path-ish config fields", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".text2llm");
        await fs.mkdir(configDir, { recursive: true });
        const pluginDir = path.join(home, "plugins", "demo-plugin");
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.writeFile(
          path.join(pluginDir, "index.js"),
          'export default { id: "demo-plugin", register() {} };',
          "utf-8",
        );
        await fs.writeFile(
          path.join(pluginDir, "text2llm.plugin.json"),
          JSON.stringify(
            {
              id: "demo-plugin",
              configSchema: { type: "object", additionalProperties: false, properties: {} },
            },
            null,
            2,
          ),
          "utf-8",
        );
        await fs.writeFile(
          path.join(configDir, "text2llm.json"),
          JSON.stringify(
            {
              plugins: {
                load: {
                  paths: ["~/plugins/demo-plugin"],
                },
              },
              agents: {
                defaults: { workspace: "~/ws-default" },
                list: [
                  {
                    id: "main",
                    workspace: "~/ws-agent",
                    agentDir: "~/.text2llm/agents/main",
                    sandbox: { workspaceRoot: "~/sandbox-root" },
                  },
                ],
              },
              channels: {
                whatsapp: {
                  accounts: {
                    personal: {
                      authDir: "~/.text2llm/credentials/wa-personal",
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();

        expect(cfg.plugins?.load?.paths?.[0]).toBe(path.join(home, "plugins", "demo-plugin"));
        expect(cfg.agents?.defaults?.workspace).toBe(path.join(home, "ws-default"));
        expect(cfg.agents?.list?.[0]?.workspace).toBe(path.join(home, "ws-agent"));
        expect(cfg.agents?.list?.[0]?.agentDir).toBe(
          path.join(home, ".text2llm", "agents", "main"),
        );
        expect(cfg.agents?.list?.[0]?.sandbox?.workspaceRoot).toBe(path.join(home, "sandbox-root"));
        expect(cfg.channels?.whatsapp?.accounts?.personal?.authDir).toBe(
          path.join(home, ".text2llm", "credentials", "wa-personal"),
        );
      });
    });
  });

  describe("U6: gateway port resolution", () => {
    it("uses default when env and config are unset", async () => {
      await withEnvOverride({ TEXT2LLM_GATEWAY_PORT: undefined }, async () => {
        const { DEFAULT_GATEWAY_PORT, resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({})).toBe(DEFAULT_GATEWAY_PORT);
      });
    });

    it("prefers TEXT2LLM_GATEWAY_PORT over config", async () => {
      await withEnvOverride({ TEXT2LLM_GATEWAY_PORT: "19001" }, async () => {
        const { resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({ gateway: { port: 19002 } })).toBe(19001);
      });
    });

    it("falls back to config when env is invalid", async () => {
      await withEnvOverride({ TEXT2LLM_GATEWAY_PORT: "nope" }, async () => {
        const { resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({ gateway: { port: 19003 } })).toBe(19003);
      });
    });
  });

  describe("U9: telegram.tokenFile schema validation", () => {
    it("accepts config with only botToken", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".text2llm");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "text2llm.json"),
          JSON.stringify({
            channels: { telegram: { botToken: "123:ABC" } },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.botToken).toBe("123:ABC");
        expect(cfg.channels?.telegram?.tokenFile).toBeUndefined();
      });
    });

    it("accepts config with only tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".text2llm");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "text2llm.json"),
          JSON.stringify({
            channels: { telegram: { tokenFile: "/run/agenix/telegram-token" } },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
        expect(cfg.channels?.telegram?.botToken).toBeUndefined();
      });
    });

    it("accepts config with both botToken and tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".text2llm");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "text2llm.json"),
          JSON.stringify({
            channels: {
              telegram: {
                botToken: "fallback:token",
                tokenFile: "/run/agenix/telegram-token",
              },
            },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.botToken).toBe("fallback:token");
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
      });
    });
  });
});
