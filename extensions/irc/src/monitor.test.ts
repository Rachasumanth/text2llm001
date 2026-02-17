import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#text2llm",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#text2llm",
      rawTarget: "#text2llm",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "text2llm-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "text2llm-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "text2llm-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "text2llm-bot",
      rawTarget: "text2llm-bot",
    });
  });
});
