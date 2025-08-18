require("dotenv").config();

module.exports = {
  env: {
    PORT: process.env.PORT || 3000,
    API_KEY: process.env.API_KEY,
    DATABASE_PATH: process.env.DATABASE_PATH || "./data.db",
    TZ: process.env.TZ,
    DEFAULT_LINE_USER_ID: process.env.DEFAULT_LINE_USER_ID || null,
    DEFAULT_LINE_USER_NAME: process.env.DEFAULT_LINE_USER_NAME || null,
  },
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
};
