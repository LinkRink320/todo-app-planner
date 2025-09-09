require("dotenv").config();

module.exports = {
  env: {
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DATABASE_PATH: process.env.DATABASE_PATH || "./data.db",
    TZ: process.env.TZ,
    DEFAULT_LINE_USER_ID: process.env.DEFAULT_LINE_USER_ID || null,
    DEFAULT_LINE_USER_NAME: process.env.DEFAULT_LINE_USER_NAME || null,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || null,
    MORNING_SUMMARY_CRON: process.env.MORNING_SUMMARY_CRON,
    MORNING_DELETE_CONFIRM_CRON: process.env.MORNING_DELETE_CONFIRM_CRON,
    EVENING_PLAN_REMINDER_CRON: process.env.EVENING_PLAN_REMINDER_CRON,

    // AI Services
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
    AI_PROVIDER: process.env.AI_PROVIDER || "openai",
    AI_MODEL: process.env.AI_MODEL || "gpt-3.5-turbo",
  },
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
};
