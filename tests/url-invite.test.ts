import { describe, expect, it } from "vitest";
import {
  buildControlInviteUrl,
  extractUrlInviteToken,
  formatControlInviteCard,
  parsePastedControlInvite,
} from "../src/shared/url-invite";

describe("url-invite helpers", () => {
  it("extracts ?token= and ?invite= from search or hash while preserving safe parameters", () => {
    expect(
      extractUrlInviteToken({
        pathname: "/",
        search: "?token=yki_live_abc123456789012345&view=compact",
        hash: "#/drama",
      }),
    ).toEqual({
      token: "yki_live_abc123456789012345",
      cleanUrl: "/?view=compact#/drama",
    });

    expect(
      extractUrlInviteToken({
        pathname: "/",
        search: "",
        hash: "#/tasks?invite=yki_live_hash123456789012345&state=failed",
      }),
    ).toEqual({
      token: "yki_live_hash123456789012345",
      cleanUrl: "/#/tasks?state=failed",
    });

    expect(
      extractUrlInviteToken({
        pathname: "/",
        search: "",
        hash: "#token=yki_live_frag123456789012345",
      }),
    ).toEqual({
      token: "yki_live_frag123456789012345",
      cleanUrl: "/",
    });

    expect(extractUrlInviteToken({ pathname: "/", search: "?page=2", hash: "#/tasks" })).toBeNull();
  });

  it("parses one-time invite cards, URLs, and multi-line username + accessKey cards", () => {
    const token = "yki_live_" + "a".repeat(36);
    const key = "yk_live_" + "b".repeat(36);
    const url = buildControlInviteUrl("https://studio.internal:4443", token);
    const cardWithInvite = formatControlInviteCard({
      username: "lin.zhou",
      inviteUrl: url,
      inviteToken: token,
      accessKey: key,
    });

    expect(parsePastedControlInvite(url)).toEqual({
      kind: "invite_token",
      token,
      username: undefined,
    });
    expect(parsePastedControlInvite(cardWithInvite)).toEqual({
      kind: "invite_token",
      token,
      username: "lin.zhou",
    });

    const cardKeyOnly = `用户名：lin.zhou\n访问 Key：${key}\n请妥善保管`;
    expect(parsePastedControlInvite(cardKeyOnly)).toEqual({
      kind: "credentials",
      username: "lin.zhou",
      accessKey: key,
    });
  });
});
