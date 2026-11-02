import { describe, expect, it } from "vitest";
import { loginErrors, loginErrorText } from "../src/app/login-errors";

describe("what the sign-in page says for a refused sign-in", () => {
  it("tells a sign-in that overlapped another from one that hit the failure limit", () => {
    // The first is a matter of seconds, the second of 15 minutes; saying the second for the first sent people away for nothing.
    expect(loginErrorText("login_busy")).not.toContain("15 分钟");
    expect(loginErrorText("login_rate_limited")).toContain("15 分钟");
    expect(loginErrorText("login_busy")).not.toBe(loginErrorText("login_rate_limited"));
  });

  it("names every refusal the login route can give in Chinese, and never shows an unknown code bare", () => {
    for (const code of ["invalid_credentials", "login_rate_limited", "login_busy", "personal_login_unavailable", "origin_denied", "session_capacity", "invalid_login_request"])
      expect(loginErrors[code], code).toMatch(/[一-鿿]/);
    expect(loginErrorText("something_new")).toBe("登录失败（something_new），请检查服务连接。");
  });
});
