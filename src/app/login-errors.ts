/** What the sign-in page says for each refusal the login route can answer with. */
export const loginErrors: Record<string, string> = {
  invalid_credentials: "用户名或凭据不正确。",
  // Two limits answer with this: too many refused credentials (for everyone), and too many sign-ins by this one account. A login
  // that merely overlapped another is `login_busy`, which is a matter of seconds.
  login_rate_limited: "登录过于频繁或失败次数过多，请 15 分钟后再试。",
  login_busy: "另一个登录正在处理，请几秒钟后再试。",
  personal_login_unavailable: "当前服务未开启个人登录，或访问地址与服务配置的来源不一致。",
  origin_denied: "访问地址与服务配置的来源不一致。",
  session_capacity: "会话数量已达上限，请稍后再试。",
  invalid_login_request: "登录请求格式不正确。",
};

export const loginErrorText = (code: string) => loginErrors[code] || `登录失败（${code}），请检查服务连接。`;
